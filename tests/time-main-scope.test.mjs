import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesTitleScope } from '../web/main-domain.js';
import { timeline } from '../sites/api.js';
import { handleApi } from '../sites/api.js';
import { Fixture, collections } from './d1-test-helper.mjs';

function state() {
  return {entities:[
    {id:'g',kind:'generation',name:'본편 세대',data:{number:1}},
    {id:'t',kind:'title',name:'본편 작품',data:{generation_id:'g'}},
    {id:'main-a',kind:'character',name:'본편 A',data:{generation_model_version:1}},
    {id:'main-b',kind:'character',name:'본편 B',data:{generation_model_version:1}},
    {id:'side-person',kind:'character',name:'외전 인물',data:{generation_model_version:1}},
    {id:'side-rule',kind:'setting',name:'외전 규칙',data:{work_id:'side'}},
    {id:'common-rule',kind:'setting',name:'기존 공통 규칙',data:{}},
  ],documents:[{id:'side',kind:'story',name:'외전'}],relations:[
    {id:'main-a-g',type:'generation_appearance',source_id:'main-a',target_id:'g',data:{generation_schema:1}},
    {id:'main-b-g',type:'generation_appearance',source_id:'main-b',target_id:'g',data:{generation_schema:1}},
    {id:'main-title-appearance',type:'appearance',source_id:'main-a',target_id:'t',data:{}},
    {id:'side-rule-shared-person',type:'related',source_id:'side-rule',target_id:'main-a',data:{work_id:'side'}},
    {id:'side-appearance',type:'work_appearance',source_id:'side-person',target_id:'side',data:{profile_schema:1}},
    {id:'side-relation',type:'research_partner',source_id:'main-a',target_id:'main-b',data:{work_id:'side'}},
  ],groups:[],memberships:[],states:[],chapters:[],versions:[]};
}

test('story-only records stay out of main common lists even when common material is included or owner story is archived',()=>{
  const db=state(),scope={generationId:'g',titleId:'',includeCommon:true};
  for(const id of ['side-person','side-rule'])assert.equal(matchesTitleScope(db,db.entities.find(row=>row.id===id),scope),false);
  assert.equal(matchesTitleScope(db,db.entities.find(row=>row.id==='common-rule'),scope),true);
  assert.equal(matchesTitleScope(db,db.entities.find(row=>row.id==='main-a'),scope),true);
  db.documents[0].deleted_at='2026-11-18T00:00:00Z';
  assert.equal(matchesTitleScope(db,db.entities.find(row=>row.id==='side-rule'),scope),false);
  assert.equal(matchesTitleScope(db,db.entities.find(row=>row.id==='side-person'),{generationId:'',titleId:'',includeCommon:true}),true,'global list remains global');
});

test('a story-scoped relationship between two real main characters does not leak into main timeline',()=>{
  const result=timeline(state(),null,null,{generationId:'g',includeCommon:true});
  const relations=[...result.effective_relations,...result.uncertain.filter(item=>item.collection==='relations').map(item=>item.record)];
  assert.ok(!relations.some(row=>row.id==='side-relation'));
  assert.ok(relations.some(row=>row.id==='main-a-g'));
});

test('generic relationship controls cannot delete or restore an identity link without freezing the story profile',async t=>{
  const f=new Fixture(handleApi);t.after(()=>f.close());
  const generation=await f.entity('generation','본편',{number:1});
  const main=await f.entity('character','공통');
  await f.relation(main,generation,'generation_appearance',{data:{generation_schema:1,affiliations:[],ideology_rank:'',narrative:''}});
  const work=await f.create('documents',{kind:'story',name:'외전'});
  const ctx=await f.req('GET',`/api/works/${work.id}/context`);
  const local=await f.req('POST',`/api/works/${work.id}/characters`,{expected_write_revision:ctx.expected_write_revision,revisions:ctx.revisions,common:{name:'외전'}});
  const path=`/api/work-characters/${local.local.id}/${work.id}`;
  const preview=await f.req('GET',`${path}/identity-preview?target_id=${main.id}`);
  await f.req('POST',path+'/identity-link',{expected_write_revision:preview.expected_write_revision,revisions:preview.revisions,target_id:main.id,field_choices:Object.fromEntries(preview.conflicts.map(field=>[field.field,'common']))});
  const linked=await f.req('GET',path),before=await f.state();
  await f.error('DELETE',`/api/relations/${linked.identity.id}`,undefined,422);
  await f.error('PATCH',`/api/relations/${linked.identity.id}`,{revision:linked.identity.revision,data:{...linked.identity.data,note:'generic'}},422);
  const after=await f.state();for(const table of collections)assert.deepEqual(after[table],before[table]);
  await f.req('POST',path+'/identity-unlink',{expected_write_revision:linked.expected_write_revision,revisions:linked.revisions});
  await f.error('POST',`/api/relations/${linked.identity.id}/restore`,{},422);
  const current=await f.req('GET',path);assert.equal(current.values.name,main.name);assert.equal(current.identity,null);
});
