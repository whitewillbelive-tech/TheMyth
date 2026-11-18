import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../sites/api.js';
import { Store } from '../sites/store.js';
import { Fixture, collections } from './d1-test-helper.mjs';
import { COMMON_FIELDS, resolveWorkCharacter, workCharacters, mainCharacterCandidates } from '../web/work-characters-domain.js';
import { getWorkContext, getWorkCharacter, createWorkCharacter, updateWorkProfile, updateCommonCharacter, promoteWorkFields, previewIdentityLink, linkWorkIdentity, unlinkWorkIdentity } from '../sites/work-characters.js';

function scenario(name,run){test(name,async t=>{const f=new Fixture(handleApi);t.after(()=>f.close());await run(f);});}
const records=state=>Object.fromEntries(collections.map(table=>[table,state[table]]));
async function mutate(f,operation){const store=await Store.load(f.env),result=operation(store);await store.commit();return result;}
async function context(f,workId){return getWorkContext(await Store.load(f.env),workId);}
async function current(f,id,workId){return getWorkCharacter(await Store.load(f.env),id,workId);}
function token(projection){return {expected_write_revision:projection.expected_write_revision,revisions:projection.revisions};}
async function create(f,workId,common={},overrides={}) {return mutate(f,store=>createWorkCharacter(store,workId,{...getWorkContext(store,workId),common,overrides}));}
async function side(f,name='외전'){return f.create('documents',{kind:'story',name});}
async function main(f,name='본편 이름') {
  const generation=await f.create('entities',{kind:'generation',name:'본편 세대',data:{number:1}});
  const title=await f.create('entities',{kind:'title',name:'본편 작품',data:{generation_id:generation.id}});
  const character=await f.create('entities',{kind:'character',name,description:'공통 설명',data:{english_name:'Shared',aliases:['본편 별칭'],generation_model_version:1}});
  const generationAppearance=await f.relation(character,generation,'generation_appearance',{data:{generation_schema:1,affiliations:[],ideology_rank:'',narrative:''}});
  const appearance=await f.relation(character,title,'appearance',{data:{profile_schema:1,overrides:{description:'본편 작품의 별도 설명'},inherit_fields:[]}});
  return {generation,title,character,generationAppearance,appearance};
}
async function link(f,localId,workId,targetId,choice='common') {
  return mutate(f,store=>{const preview=previewIdentityLink(store,localId,workId,targetId);return linkWorkIdentity(store,localId,workId,{...preview,target_id:targetId,field_choices:Object.fromEntries(preview.conflicts.map(field=>[field.field,choice]))});});
}

scenario('side-story creation allows partial fields without main membership or same-name identity inference',async f=>{
  const work=await side(f),one=await create(f,work.id,{name:'나이트',english_name:'Knight'}),two=await create(f,work.id,{name:'나이트',english_name:'Night'}),unknown=await create(f,work.id);
  const state=await f.state();
  assert.notEqual(one.local.id,two.local.id);assert.equal(one.local.data.generation_model_version,1);
  assert.equal(unknown.local.name,'이름 미정');assert.deepEqual(unknown.values.time,{mode:'unknown'});
  assert.equal(workCharacters(state,work.id).length,3);assert.deepEqual(mainCharacterCandidates(state),[]);
  assert.equal(state.relations.filter(row=>row.type==='generation_appearance').length,0);
  assert.ok(!state.relations.some(row=>row.type==='identity_link'));
  const firstHonor=await f.create('entities',{kind:'custom',name:'A 칭호',data:{classification:'honor',honor_letter:'A',work_id:work.id}});
  const secondHonor=await f.create('entities',{kind:'custom',name:'B 칭호',data:{classification:'honor',honor_letter:'B',work_id:work.id}});
  const assignment=await f.relation(one.local,firstHonor,'honor_assignment',{data:{work_id:work.id,honor_letter:'A'}});
  assert.equal(resolveWorkCharacter(await f.state(),one.local.id,work.id).honors[0].letter,'A');
  await f.update('relations',assignment,{revision:assignment.revision,target_id:secondHonor.id});
  assert.equal(resolveWorkCharacter(await f.state(),one.local.id,work.id).honors[0].letter,'B','canonical honor target takes precedence over the old import hint after retargeting');
  f.reopen();assert.equal(workCharacters(await f.state(),work.id).length,3);
});

scenario('explicit identity comparison preserves local event references and propagates only common inherited values',async f=>{
  const m=await main(f),work=await side(f),local=await create(f,work.id,{name:'외전 이름',english_name:'Local',aliases:['외전 별칭'],description:'지역 설명'},{role:'주인공',condition:'당시 상태'});
  const event=await f.create('entities',{kind:'event',name:'기존 외전 사건',data:{work_id:work.id}});
  const participation=await f.relation(local.local,event,'participates',{data:{work_id:work.id,note:'원본 고유 ID 유지'}});
  const sourceBefore=await f.record('entities',local.local.id),mainTitleBefore=await f.record('relations',m.appearance.id);
  const preview=previewIdentityLink(await Store.load(f.env),local.local.id,work.id,m.character.id);
  assert.equal(preview.conflicts.length,4);assert.ok(preview.affectedWorks.some(row=>row.id===m.title.id));
  const before=records(await f.state());
  await assert.rejects(mutate(f,s=>linkWorkIdentity(s,local.local.id,work.id,{...preview,target_id:m.character.id,field_choices:{}})),error=>error.status===409);
  assert.deepEqual(records(await f.state()),before,'missing conflict choices cannot partially update common data');
  await link(f,local.local.id,work.id,m.character.id);
  let linked=await current(f,local.local.id,work.id);
  assert.equal(linked.common.id,m.character.id);assert.equal(linked.values.name,m.character.name);assert.equal(linked.values.role,'주인공');
  assert.deepEqual(await f.record('entities',local.local.id),sourceBefore);
  assert.deepEqual(await f.record('relations',participation.id),participation);
  assert.deepEqual(await f.record('relations',m.appearance.id),mainTitleBefore);
  await mutate(f,s=>updateCommonCharacter(s,local.local.id,work.id,{...token(getWorkCharacter(s,local.local.id,work.id)),fields:{name:'공통 이름 수정',description:'공통 설명 수정'}}));
  linked=await current(f,local.local.id,work.id);
  assert.equal(linked.values.name,'공통 이름 수정');assert.equal(linked.values.condition,'당시 상태');
  assert.deepEqual(await f.record('relations',m.appearance.id),mainTitleBefore,'main title override may not be erased by common edit');
});

scenario('work overrides survive common edits, can reset inheritance, and promote only selected common fields with history',async f=>{
  const m=await main(f),work=await side(f),local=await create(f,work.id,{name:'외전 인물'},{description:'작품별 설명',goals:'이 작품만의 목표'});
  await link(f,local.local.id,work.id,m.character.id);
  await mutate(f,s=>updateCommonCharacter(s,local.local.id,work.id,{...token(getWorkCharacter(s,local.local.id,work.id)),fields:{description:'공통 설명의 새 값'}}));
  let p=await current(f,local.local.id,work.id);assert.equal(p.values.description,'작품별 설명');assert.equal(p.sources.description,'override');
  await mutate(f,s=>updateWorkProfile(s,local.local.id,work.id,{...token(getWorkCharacter(s,local.local.id,work.id)),inherit_fields:['description']}));
  p=await current(f,local.local.id,work.id);assert.equal(p.values.description,'공통 설명의 새 값');assert.equal(p.values.goals,'이 작품만의 목표');
  await mutate(f,s=>updateWorkProfile(s,local.local.id,work.id,{...token(getWorkCharacter(s,local.local.id,work.id)),overrides:{description:'공통에 올릴 설명',name:'외전 호칭'},override_notes:{name:'이 시점의 호칭'}}));
  await mutate(f,s=>promoteWorkFields(s,local.local.id,work.id,{...token(getWorkCharacter(s,local.local.id,work.id)),fields:['description']}));
  p=await current(f,local.local.id,work.id);assert.equal(p.common.description,'공통에 올릴 설명');assert.equal(p.sources.description,'common');assert.equal(p.values.name,'외전 호칭');assert.equal(p.override_notes.name,'이 시점의 호칭');
  const history=(await f.state()).versions;assert.ok(history.some(row=>row.target_id===m.character.id&&row.snapshot.description==='공통 설명의 새 값'));
  assert.ok(history.some(row=>row.target_id===p.appearance.id&&row.snapshot.data.overrides.description==='공통에 올릴 설명'));
});

scenario('unlink freezes effective work information while both originals, other works, and all references remain intact through backup/reopen',async f=>{
  const m=await main(f),another=await main(f,'연결 대상'),work=await side(f),otherWork=await side(f,'다른 외전');
  let store=await Store.load(f.env),env={...getWorkContext(store,work.id),revisions:{[work.id]:work.revision,[m.character.id]:m.character.revision},character_id:m.character.id};
  await mutate(f,s=>createWorkCharacter(s,work.id,env));
  store=await Store.load(f.env);await mutate(f,s=>createWorkCharacter(s,otherWork.id,{...getWorkContext(s,otherWork.id),revisions:{[otherWork.id]:otherWork.revision,[m.character.id]:m.character.revision},character_id:m.character.id,overrides:{role:'다른 작품 역할'}}));
  const event=await f.create('entities',{kind:'event',name:'외전의 원래 사건',data:{work_id:work.id}}),relation=await f.relation(m.character,event,'participates',{data:{work_id:work.id}});
  await link(f,m.character.id,work.id,another.character.id);
  let p=await current(f,m.character.id,work.id);const effective=structuredClone(p.values),before=await f.state(),otherBefore=resolveWorkCharacter(before,m.character.id,otherWork.id),oldId=p.identity.id;
  await mutate(f,s=>unlinkWorkIdentity(s,m.character.id,work.id,getWorkCharacter(s,m.character.id,work.id)));
  p=await current(f,m.character.id,work.id);assert.equal(p.identity,null);assert.deepEqual(p.values,effective);
  assert.deepEqual(await f.record('entities',m.character.id),before.entities.find(row=>row.id===m.character.id));
  assert.deepEqual(await f.record('entities',another.character.id),before.entities.find(row=>row.id===another.character.id));
  const otherAfter=resolveWorkCharacter(await f.state(),m.character.id,otherWork.id);for(const key of ['local','common','appearance','identity','values','sources','overrides','override_notes'])assert.deepEqual(otherAfter[key],otherBefore[key]);
  assert.deepEqual(await f.record('relations',relation.id),relation);assert.ok((await f.record('relations',oldId)).deleted_at);
  const backup=await f.backup();await f.replace(backup);f.reopen();assert.deepEqual(records(await f.state()),records(backup));assert.deepEqual((await current(f,m.character.id,work.id)).values,effective);
});

scenario('stale global or record revisions stop edits, and concurrent SQL batches cannot partially replace the latest data',async f=>{
  const work=await side(f),local=await create(f,work.id,{name:'원본'}),snapshot=await current(f,local.local.id,work.id);
  await mutate(f,s=>updateWorkProfile(s,local.local.id,work.id,{...token(getWorkCharacter(s,local.local.id,work.id)),overrides:{notes:'다른 창의 최신 메모'}}));
  let before=records(await f.state());
  await assert.rejects(mutate(f,s=>updateCommonCharacter(s,local.local.id,work.id,{...snapshot,fields:{name:'오래된 화면'}})),error=>error.status===409);assert.deepEqual(records(await f.state()),before);
  const latest=await current(f,local.local.id,work.id),wrong={...latest,revisions:{...latest.revisions,[local.local.id]:999}};
  await assert.rejects(mutate(f,s=>updateWorkProfile(s,local.local.id,work.id,{...wrong,overrides:{notes:'잘못된 버전'}})),error=>error.status===409);assert.deepEqual(records(await f.state()),before);
  const a=await Store.load(f.env),b=await Store.load(f.env);
  updateCommonCharacter(a,local.local.id,work.id,{...token(getWorkCharacter(a,local.local.id,work.id)),fields:{name:'먼저 저장'}});
  updateWorkProfile(b,local.local.id,work.id,{...token(getWorkCharacter(b,local.local.id,work.id)),overrides:{goals:'오래된 동시 저장'}});
  await a.commit();before=records(await f.state());await assert.rejects(b.commit(),error=>error.status===409);assert.deepEqual(records(await f.state()),before);
});

scenario('generic APIs and backup validation reject malformed work profiles and duplicate identities without disturbing legacy title profiles',async f=>{
  const m=await main(f),work=await side(f),local=await create(f,work.id,{name:'외전'}),before=records(await f.state());
  const bad=[{type:'work_appearance',source_id:m.character.id,target_id:m.title.id,data:{profile_schema:1}},{type:'work_appearance',source_id:m.character.id,target_id:work.id,data:{profile_schema:1,overrides:{name:''}}},{type:'work_appearance',source_id:m.character.id,target_id:work.id,data:{profile_schema:1,overrides:{name:'동시'},inherit_fields:['name']}},{type:'identity_link',source_id:local.local.id,target_id:m.character.id,data:{work_id:m.title.id}}];
  for(const row of bad){await f.error('POST','/api/relations',row,422);assert.deepEqual(records(await f.state()),before);}
  await link(f,local.local.id,work.id,m.character.id);
  const after=records(await f.state());await f.error('POST','/api/relations',{type:'identity_link',source_id:local.local.id,target_id:m.character.id,data:{work_id:work.id}},409);assert.deepEqual(records(await f.state()),after);
  assert.deepEqual(await f.record('relations',m.appearance.id),m.appearance);
});

scenario('actual routed API persists create, compare/link, inherited/common edits and unlink across reconnect with visitor headers',async f=>{
  const owner={'oai-authenticated-user-id':'browser-owner'},m=await main(f),work=await side(f,'HTTP 외전');
  const base=`/api/works/${work.id}`;
  const start=await f.req('GET',base+'/context');
  const created=await f.req('POST',base+'/characters',{...token(start),common:{name:'HTTP 외전 인물',english_name:'Side'},overrides:{goals:'작품의 목표'}},owner);
  const endpoint=`/api/work-characters/${created.local.id}/${work.id}`;
  const preview=await f.req('GET',endpoint+'/identity-preview?target_id='+m.character.id);
  await f.req('POST',endpoint+'/identity-link',{...token(preview),target_id:m.character.id,field_choices:Object.fromEntries(preview.conflicts.map(conflict=>[conflict.field,'common']))},owner);
  let latest=await f.req('GET',endpoint);
  await f.req('PATCH',endpoint+'/common',{...token(latest),fields:{description:'HTTP 저장한 공통 설명'}},owner);
  await f.error('PATCH',endpoint+'/profile',{...token(latest),overrides:{goals:'오래된 화면으로 변경'}},409,owner);
  latest=await f.req('GET',endpoint);assert.equal(latest.values.description,'HTTP 저장한 공통 설명');assert.equal(latest.values.goals,'작품의 목표');
  await f.req('PATCH',endpoint+'/profile',{...token(latest),overrides:{description:'공통에 반영할 외전 설명'}},owner);
  latest=await f.req('GET',endpoint);await f.req('POST',endpoint+'/promote',{...token(latest),fields:['description']},owner);
  latest=await f.req('GET',endpoint);await f.req('POST',endpoint+'/identity-unlink',token(latest),owner);
  f.reopen();latest=await f.req('GET',endpoint);
  assert.equal(latest.identity,null);assert.equal(latest.values.description,'공통에 반영할 외전 설명');assert.equal(latest.values.goals,'작품의 목표');
  assert.equal((await f.record('entities',m.character.id)).description,'공통에 반영할 외전 설명');
  assert.equal(f.objects.size,0,'normal profile operations must not write R2');
});

scenario('HTTP creation and profile writes require both global and record revision envelopes before any side effects',async f=>{
  const work=await side(f),initial=records(await f.state()),base=`/api/works/${work.id}`;
  await f.error('POST',base+'/characters',{common:{name:'저장되면 안 되는 자료'}},422);assert.deepEqual(records(await f.state()),initial);
  const start=await f.req('GET',base+'/context');
  await f.error('POST',base+'/characters',{expected_write_revision:start.expected_write_revision,revisions:{},common:{name:'누락된 자료 버전'}},422);assert.deepEqual(records(await f.state()),initial);
  const created=await f.req('POST',base+'/characters',{...token(start),common:{name:'유효 인물'}}),endpoint=`/api/work-characters/${created.local.id}/${work.id}`;
  const latest=await f.req('GET',endpoint),before=records(await f.state());
  await f.error('PATCH',endpoint+'/profile',{expected_write_revision:latest.expected_write_revision,revisions:{[work.id]:work.revision},overrides:{notes:'누락된 인물 버전'}},422);
  await f.error('PATCH',endpoint+'/common',{...token(latest),revisions:{...latest.revisions,[created.local.id]:999},fields:{name:'충돌하는 이름'}},409);
  assert.deepEqual(records(await f.state()),before);
});

scenario('HTTP identity comparison cannot apply stale choices after another editor changes the shared main character',async f=>{
  const m=await main(f),work=await side(f),local=await create(f,work.id,{name:'외전 이름',description:'외전 기본 설명'}),endpoint=`/api/work-characters/${local.local.id}/${work.id}`;
  const preview=await f.req('GET',endpoint+'/identity-preview?target_id='+m.character.id);
  await f.update('entities',m.character,{revision:m.character.revision,description:'다른 편집자의 최신 설명'});
  const afterOtherEdit=records(await f.state());
  const detail=await f.error('POST',endpoint+'/identity-link',{...token(preview),target_id:m.character.id,field_choices:Object.fromEntries(preview.conflicts.map(conflict=>[conflict.field,'local']))},409);
  assert.match(detail,/최신값|다른 화면/);assert.deepEqual(records(await f.state()),afterOtherEdit);
  const latestPreview=await f.req('GET',endpoint+'/identity-preview?target_id='+m.character.id);
  assert.equal(latestPreview.common_values.description,'다른 편집자의 최신 설명');
  await f.req('POST',endpoint+'/identity-link',{...token(latestPreview),target_id:m.character.id,field_choices:Object.fromEntries(latestPreview.conflicts.map(conflict=>[conflict.field,conflict.field==='name'?'local':'common']))});
  const linked=await f.req('GET',endpoint);assert.equal(linked.values.name,'외전 이름');assert.equal(linked.values.description,'다른 편집자의 최신 설명');
  const history=(await f.state()).versions.filter(row=>row.target_id===m.character.id);assert.ok(history.some(row=>row.snapshot.name===m.character.name));
});
