import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../sites/api.js';
import { Fixture, collections } from './d1-test-helper.mjs';
import { initializeAuthorizedTimeProject } from '../web/time-initialization.js';

const records = state => Object.fromEntries(collections.map(table => [table,state[table]]));
const revision = f => f.DB.db.prepare("SELECT value FROM metadata WHERE key='sites_write_revision'").get()?.value;
const importedWork = state => state.documents.find(row => row.data?.import_key === 'time:work:v1');
function client(f, calls, before = null) {
  return async (path, method='GET', payload) => {
    calls.push({path,method,payload});
    await before?.(path,method,payload);
    const response=await f.response(method,'/api'+path,payload,{'oai-authenticated-user-id':'owner'});
    const value=await response.json();
    if(!response.ok)throw Object.assign(new Error(typeof value.detail==='string'?value.detail:JSON.stringify(value.detail)),{status:response.status});
    return value;
  };
}
function scenario(name,run){test(name,async t=>{const f=new Fixture(handleApi);t.after(()=>f.close());let r2=0;f.env.BUCKET.put=async()=>{r2++;throw Error('Initialization must not change R2');};f.env.BUCKET.get=async()=>{throw Error('Initialization must not read R2');};await run(f);assert.equal(r2,0);});}

scenario('authenticated Site initialization persists the approved dataset once while preserving existing main and archived manuscript records',async f=>{
  const generation=await f.entity('generation','기존 본편 세대',{number:1});
  const title=await f.entity('title','기존 본편 작품',{generation_id:generation.id});
  const character=await f.entity('character','기존 본편 인물',{generation_model_version:1});
  await f.relation(character,title,'appearance');
  const manuscript=await f.create('documents',{kind:'story',name:'삭제한 검증 원고',body:'복원하지 않을 원문'});
  await f.req('DELETE','/api/documents/'+manuscript.id);
  const before=await f.state(),calls=[];
  const result=await initializeAuthorizedTimeProject(before,client(f,calls));
  assert.equal(result.status,'registered');assert.equal(result.changed,true);
  assert.deepEqual(calls.map(row=>[row.method,row.path]),[['GET','/works/time'],['POST','/works/time/import'],['GET','/state']]);
  const after=await f.state(),work=importedWork(after);assert.ok(work);assert.equal(work.name,'시간');assert.equal(work.data.generation_id,null);
  for(const table of collections)for(const original of before[table])assert.deepEqual(after[table].find(row=>row.id===original.id),original);
  const status=await f.req('GET','/api/works/time');
  assert.deepEqual([status.counts.characters,status.counts.honors,status.counts.honor_assignments,status.counts.events,status.counts.core_relationships,status.counts.research_discourses],[27,26,27,8,6,0]);
  assert.deepEqual(records(result.state),records(after));
  f.reopen();const reopened=await f.state();assert.deepEqual(records(reopened),records(after));
});

scenario('a later Site opening never reapplies initial values over edited imported records or creates another history entry',async f=>{
  const first=await initializeAuthorizedTimeProject(await f.state(),client(f,[]));
  const work=importedWork(first.state);
  await f.update('documents',work,{revision:work.revision,name:'정식 제목으로 변경',data:{...work.data,overview:'작가의 최신 수정'}});
  const before=await f.state(),beforeRevision=revision(f),calls=[];
  const result=await initializeAuthorizedTimeProject(before,client(f,calls));
  assert.equal(result.status,'already_registered');assert.equal(result.changed,false);assert.equal(calls.length,0);
  assert.deepEqual(records(await f.state()),records(before));assert.equal(revision(f),beforeRevision);
});

scenario('an archived imported work is not restored or replaced during Site initialization',async f=>{
  await initializeAuthorizedTimeProject(await f.state(),client(f,[]));const work=importedWork(await f.state());
  await f.req('DELETE','/api/documents/'+work.id);
  const before=await f.state(),calls=[];
  const result=await initializeAuthorizedTimeProject(before,client(f,calls));
  assert.equal(result.status,'already_registered');assert.equal(calls.length,0);
  assert.deepEqual(records(await f.state()),records(before));assert.ok(importedWork(await f.state()).deleted_at);
});

scenario('an existing unmarked time story found after the initial snapshot is preserved for explicit owner review',async f=>{
  const stale=await f.state();
  const work=await f.create('documents',{kind:'story',name:'시간',body:'기존 원고',data:{overview:'이미 직접 수정한 개요'}});
  const before=await f.state(),calls=[];
  const result=await initializeAuthorizedTimeProject(stale,client(f,calls));
  assert.equal(result.status,'existing_work');assert.equal(result.changed,false);
  assert.deepEqual(calls.map(row=>[row.method,row.path]),[['GET','/works/time']]);
  assert.deepEqual(records(await f.state()),records(before));assert.equal((await f.record('documents',work.id)).body,'기존 원고');
});

scenario('ambiguous or archived named time works stop before any initial-data mutation',async f=>{
  await f.create('documents',{kind:'story',name:'시간'});await f.create('documents',{kind:'story',name:'時間'});
  const before=await f.state(),calls=[];
  const result=await initializeAuthorizedTimeProject(before,client(f,calls));
  assert.equal(result.status,'unavailable');assert.equal(result.error_status,409);assert.ok(result.warning);
  assert.deepEqual(calls.map(row=>[row.method,row.path]),[['GET','/works/time']]);assert.deepEqual(records(await f.state()),records(before));
  const other=new Fixture(handleApi);try{
    const work=await other.create('documents',{kind:'story',name:'시간'});await other.req('DELETE','/api/documents/'+work.id);
    const prior=await other.state(),requests=[],stopped=await initializeAuthorizedTimeProject(prior,client(other,requests));
    assert.equal(stopped.error_status,409);assert.equal(requests.length,1);assert.deepEqual(records(await other.state()),records(prior));
  }finally{other.close();}
});

scenario('a stale import revision causes one recovery read and no retry or overwrite of the concurrent editor',async f=>{
  const original=await f.entity('setting','기존 설정');let changed=false;
  const api=client(f,[],async(path,method)=>{
    if(path==='/works/time/import'&&method==='POST'&&!changed){changed=true;await f.update('entities',original,{revision:original.revision,description:'다른 화면의 최신 변경'});}
  });
  const calls=[];const tracked=async(...args)=>{calls.push([args[1]||'GET',args[0]]);return api(...args);};
  const result=await initializeAuthorizedTimeProject(await f.state(),tracked);
  assert.equal(result.status,'conflict');assert.equal(result.changed,false);assert.equal(result.error_status,409);
  assert.deepEqual(calls,[['GET','/works/time'],['POST','/works/time/import'],['GET','/state']]);
  assert.equal((await f.state()).entities.length,1);assert.equal((await f.record('entities',original.id)).description,'다른 화면의 최신 변경');assert.equal((await f.state()).documents.length,0);
});

scenario('a concurrent successful registration is recovered by reading the saved state without another POST',async f=>{
  let raced=false;const calls=[];
  const result=await initializeAuthorizedTimeProject(await f.state(),client(f,calls,async(path,method,payload)=>{
    if(path==='/works/time/import'&&method==='POST'&&!raced){raced=true;await f.req('POST','/api/works/time/import',payload);}
  }));
  assert.equal(result.status,'registered_elsewhere');assert.equal(result.changed,false);assert.equal(result.warning,'');
  assert.equal(calls.filter(row=>row.method==='POST').length,1);assert.ok(importedWork(result.state));
  const status=await f.req('GET','/api/works/time');assert.equal(status.counts.characters,27);assert.equal(status.counts.honors,26);
});

scenario('a failed post-save refresh retains the persisted dataset and reports the verification limit without another write',async f=>{
  const calls=[],transport=client(f,calls),before=await f.state();
  const result=await initializeAuthorizedTimeProject(before,async(path,method='GET',payload)=>{
    if(path==='/state'){calls.push({path,method});throw Object.assign(new Error('Read temporarily unavailable'),{status:503});}
    return transport(path,method,payload);
  });
  assert.equal(result.status,'saved_refresh_unavailable');assert.equal(result.changed,true);assert.ok(result.warning);assert.equal(result.error_status,503);
  assert.deepEqual(calls.map(row=>[row.method,row.path]),[['GET','/works/time'],['POST','/works/time/import'],['GET','/state']]);
  const actual=await f.state();assert.ok(importedWork(actual));assert.equal(actual.entities.filter(row=>row.kind==='character').length,27);
  const reopenCalls=[];const reopened=await initializeAuthorizedTimeProject(actual,client(f,reopenCalls));assert.equal(reopened.status,'already_registered');assert.equal(reopenCalls.length,0);
});

test('an unavailable or malformed status cannot trigger a mutation or make the main workspace initialization throw',async()=>{
  for(const response of [null,{}, {work:null}, {work:null,expected_write_revision:42}]){
    const calls=[];const result=await initializeAuthorizedTimeProject({documents:[]},async(path,method='GET')=>{calls.push([method,path]);return response;});
    assert.equal(result.status,'unavailable');assert.equal(result.changed,false);assert.ok(result.warning);assert.deepEqual(calls,[['GET','/works/time']]);
  }
});
