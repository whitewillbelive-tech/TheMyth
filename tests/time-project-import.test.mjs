import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../sites/api.js';
import { Store } from '../sites/store.js';
import { Fixture, collections } from './d1-test-helper.mjs';
import { importTimeProject, timeProjectStatus } from '../sites/time-project.js';
import { TIME_CHARACTERS, TIME_EVENTS, TIME_RELATIONSHIPS } from '../sites/time-canon.js';

function scenario(name,run){test(name,async t=>{const f=new Fixture(handleApi);t.after(()=>f.close());f.env.BUCKET.put=async()=>{throw Error('Importer must never touch R2');};await run(f);});}
async function runImport(f,payload={}){const store=await Store.load(f.env);const result=importTimeProject(store,{expected_write_revision:store.revision,...payload});await store.commit();return result;}
const records=state=>Object.fromEntries(collections.map(table=>[table,state[table]]));
const keyed=(state,key,collection='entities')=>state[collection].find(row=>row.data?.import_key===key);

scenario('explicit time import persists one side story, 27 separate people, 26 honors, eight situations and six core relations',async f=>{
  const result=await runImport(f);f.reopen();const state=await f.state();
  assert.equal(result.work.name,'시간');assert.equal(result.work.kind,'story');assert.equal(result.work.body,'');
  assert.equal(result.work.data.provisional_title,true);assert.equal(result.work.data.generation_id,null);assert.deepEqual(result.work.data.time,{mode:'unknown'});
  assert.deepEqual(result.counts,{characters:27,honors:26,honor_assignments:27,events:8,core_relationships:6,event_participations:11,ideas:4,world_rules:5,review:12,research_discourses:0});
  assert.deepEqual(result.character_reuse,{existing_reused:0,newly_created:27});
  assert.equal(state.entities.filter(row=>row.kind==='title').length,0,'honors are not main titles');
  assert.equal(state.relations.filter(row=>['appearance','generation_appearance'].includes(row.type)).length,0,'side-only people do not appear in main generation lists');
  const people=state.entities.filter(row=>row.kind==='character');assert.equal(new Set(people.map(row=>row.id)).size,27);
  for(const person of TIME_CHARACTERS){const row=keyed(state,'time:character:'+person.en.toLowerCase());assert.ok(row);assert.equal(row.name,person.ko);assert.equal(row.data.english_name,person.en);assert.equal(row.data.generation_model_version,1);}
  for(const [one,two] of [['knight','night'],['ternos','tera']])assert.notEqual(keyed(state,'time:character:'+one).id,keyed(state,'time:character:'+two).id);
  const assignments=state.relations.filter(row=>row.type==='honor_assignment'&&row.data.honor_letter==='T');assert.equal(assignments.length,2);
  const tera=keyed(state,'time:character:tera'),ternos=keyed(state,'time:character:ternos');
  assert.equal(assignments.find(row=>row.source_id===tera.id).data.status,'aspirant_undetermined');assert.equal(assignments.find(row=>row.source_id===ternos.id).data.status,'placement_confirmed');
  assert.ok(state.entities.every(row=>!row.data?.generation_id),'no undecided-as-third-generation confusion');
  assert.equal(TIME_EVENTS.length,8);assert.equal(TIME_RELATIONSHIPS.length,6);
  for(const event of state.entities.filter(row=>row.kind==='event')){assert.deepEqual(event.data.time,{mode:'unknown'});assert.equal(event.data.sequence_is_canonical,false);}
  const goal=keyed(state,'time:event:tera-goal');assert.equal(goal.data.phase,'goal');
  const current=keyed(state,'time:event:lye-target');assert.equal(current.data.phase,'current');
});

scenario('safe rerun is a no-op and preserves every existing original ID, revision, manuscript, spatial row and deleted item',async f=>{
  const planet=await f.create('entities',{kind:'planet',name:'원본 행성',data:{subtype:'행성'}});
  const original=await f.create('entities',{kind:'character',name:'나이트',description:'동일성 미확인 원본',data:{english_name:'Knight'}});
  const document=await f.create('documents',{kind:'story',name:'다른 외전',body:'기존 원고 원문'});
  const deleted=await f.create('documents',{kind:'story',name:'검증 자료',body:'휴지통 보존'});await f.req('DELETE','/api/documents/'+deleted.id);
  const originals=records(await f.state());
  const first=await runImport(f),firstState=records(await f.state()),firstMeta=(await Store.load(f.env)).revision;
  const second=await runImport(f),secondStore=await Store.load(f.env);
  assert.deepEqual(records(await f.state()),firstState);assert.equal(secondStore.revision,firstMeta,'idempotent import must not write a fresh global revision');
  assert.deepEqual(second.created,{documents:0,entities:0,relations:0});assert.deepEqual(second.updated,{documents:0,entities:0,relations:0});
  assert.equal(second.work.id,first.work.id);assert.equal(second.character_reuse.existing_reused,27);
  for(const table of collections)for(const old of originals[table])assert.deepEqual((await f.state())[table].find(row=>row.id===old.id),old);
  assert.notEqual(keyed(await f.state(),'time:character:knight').id,original.id,'name and English spelling are not a confirmed identity');
  assert.equal((await f.record('documents',document.id)).body,'기존 원고 원문');assert.ok((await f.record('documents',deleted.id)).deleted_at);assert.equal((await f.record('entities',planet.id)).name,'원본 행성');
});

scenario('user edits and explicit deletion survive import while baseline-only canonical repairs fill safe gaps',async f=>{
  const first=await runImport(f);let state=await f.state();
  const tera=keyed(state,'time:character:tera'),profile=keyed(state,'time:appearance:tera','relations');
  await f.update('entities',tera,{revision:tera.revision,name:'작가가 새로 정한 이름'});
  await f.update('relations',profile,{revision:profile.revision,data:{...profile.data,overrides:{...profile.data.overrides,goals:'작가의 최신 목표'}}});
  const rule=keyed(await f.state(),'time:world:post-ai');await f.req('DELETE','/api/entities/'+rule.id);
  const latest=await f.record('documents',first.work.id);await f.update('documents',latest,{revision:latest.revision,name:'변경된 정식 제목',body:'직접 집필한 본문',data:{...latest.data,provisional_title:false}});
  const imported=await runImport(f);state=await f.state();
  assert.equal(keyed(state,'time:character:tera').name,'작가가 새로 정한 이름');assert.equal(keyed(state,'time:appearance:tera','relations').data.overrides.goals,'작가의 최신 목표');
  const renamed=state.documents.find(row=>row.id===first.work.id);assert.equal(renamed.name,'변경된 정식 제목');assert.equal(renamed.body,'직접 집필한 본문');assert.equal(renamed.data.provisional_title,false);
  assert.equal(imported.counts.world_rules,4);assert.ok(keyed(state,'time:world:post-ai').deleted_at);assert.ok(imported.skipped_deleted.some(row=>row.id===rule.id));
  assert.ok(imported.conflicts.some(row=>row.id===tera.id&&row.field==='name'));assert.ok(imported.conflicts.some(row=>row.id===profile.id&&row.field==='data.overrides.goals'));
  assert.equal(state.documents.filter(row=>row.data?.import_key==='time:work:v1').length,1);
  const after=records(state);await runImport(f);assert.deepEqual(records(await f.state()),after,'conflict reports must not themselves produce repeating history writes');
});

scenario('existing active 時間 story is adopted without replacing prose or newer editorial fields',async f=>{
  const work=await f.create('documents',{kind:'story',name:'時間',description:'작가 최신 개요',body:'이미 있는 외전 원문',data:{overview:'최신 상세 개요',region:'작가가 확정한 지역',extension:'보존'}});
  const result=await runImport(f),saved=await f.record('documents',work.id);
  assert.equal(result.work.id,work.id);assert.equal(result.created.documents,0);assert.equal(saved.name,'時間');assert.equal(saved.description,'작가 최신 개요');assert.equal(saved.body,'이미 있는 외전 원문');assert.equal(saved.data.overview,'최신 상세 개요');assert.equal(saved.data.region,'작가가 확정한 지역');assert.equal(saved.data.extension,'보존');
  assert.equal(saved.data.form,'외전 단편');assert.equal(saved.data.import_key,'time:work:v1');assert.ok(result.conflicts.some(row=>row.field==='data.overview'));
});

scenario('ambiguous or deleted time stories and stale import revision cause no partial persistent writes',async f=>{
  const before=records(await f.state());
  let store=await Store.load(f.env);assert.throws(()=>importTimeProject(store,{}),error=>error.status===422);assert.throws(()=>importTimeProject(store,{expected_write_revision:'stale'}),error=>error.status===409);assert.deepEqual(records(await f.state()),before);
  const one=await f.create('documents',{kind:'story',name:'시간'});await f.create('documents',{kind:'story',name:'時間'});
  store=await Store.load(f.env);assert.throws(()=>importTimeProject(store,{expected_write_revision:store.revision}),error=>error.status===409);assert.equal((await f.state()).entities.length,0);
  const f2=new Fixture(handleApi);try{const work=await f2.create('documents',{kind:'story',name:'시간'});await f2.req('DELETE','/api/documents/'+work.id);const deletedStore=await Store.load(f2.env);assert.throws(()=>importTimeProject(deletedStore,{expected_write_revision:deletedStore.revision}),error=>error.status===409);assert.equal((await f2.state()).entities.length,0);}finally{f2.close();}
  assert.equal((await f.record('documents',one.id)).name,'시간');
});

scenario('private divine proof, undefined abilities and inaccessible discourse provenance are represented without fabricated mechanisms or manuscript books',async f=>{
  await runImport(f);const state=await f.state(),status=timeProjectStatus(await Store.load(f.env));
  assert.equal(status.research_expected.verified_items,0);assert.equal(status.counts.research_discourses,0);assert.equal(status.source_gaps.length,2);
  const proof=keyed(state,'time:review:private-proof');assert.equal(proof.data.certainty,'user_confirmed');assert.equal(proof.data.disclosure,'private');assert.match(proof.description,/비공개·상세 미제공/);
  const divine=keyed(state,'time:world:ideological-power');assert.equal(divine.data.certainty,'user_confirmed');assert.match(divine.description,/신이 인간에게만/);assert.match(divine.description,/일괄 배정하지 않는다/);
  const sourceGap=keyed(state,'time:review:source-gap');assert.equal(sourceGap.data.certainty,'research');assert.equal(sourceGap.data.library_sources.length,2);assert.match(sourceGap.description,/14개 범주·120개/);
  assert.equal(state.documents.filter(row=>row.kind==='book').length,0);assert.equal(state.chapters.length,0);
  for(const profile of state.relations.filter(row=>row.type==='work_appearance'))assert.equal(Object.hasOwn(profile.data.overrides,'abilities'),false);
  assert.equal(keyed(state,'time:character:yuitos').data.english_name,'Yuitos');
});

scenario('backup roundtrip retains every work appearance, honor, scoped relation, provenance baseline and user manuscript',async f=>{
  const imported=await runImport(f);const doc=await f.record('documents',imported.work.id);await f.update('documents',doc,{revision:doc.revision,body:'사용자가 쓴 원고'});
  const backup=await f.backup(),before=records(await f.state());
  const restored=new Fixture(handleApi);try{await restored.req('POST','/api/backup/restore',{backup,mode:'merge'});assert.deepEqual(records(await restored.state()),before);restored.reopen();assert.deepEqual(records(await restored.state()),before);assert.equal(timeProjectStatus(await Store.load(restored.env)).counts.characters,27);}finally{restored.close();}
});

scenario('an import planned on an older live snapshot cannot commit any new records after another window saves',async f=>{
  const staleStore=await Store.load(f.env);
  importTimeProject(staleStore,{expected_write_revision:staleStore.revision});
  const latest=await f.create('documents',{kind:'story',name:'같은 시각에 작성한 외전',body:'동시 수정 보존'});
  await assert.rejects(()=>staleStore.commit(),error=>error.status===409);
  const state=await f.state();assert.equal(state.documents.length,1);assert.equal(state.documents[0].id,latest.id);assert.equal(state.documents[0].body,'동시 수정 보존');assert.equal(state.entities.length,0);assert.equal(state.relations.length,0);
});

scenario('new canon replaces only the last imported baseline and leaves a user-edited neighboring field intact',async f=>{
  await runImport(f);const state=await f.state(),original=keyed(state,'time:world:post-ai');
  const old='이전 입력 당시의 확정 설명';
  const baseline=structuredClone(original.data.import_baseline);
  const description=baseline.find(entry=>JSON.stringify(entry.path)==='["description"]');assert.ok(description);description.value=old;
  await f.update('entities',original,{revision:original.revision,name:'사용자가 고친 표시 제목',description:old,data:{...original.data,import_baseline:baseline,custom_note:'사용자의 추가 정보'}});
  const result=await runImport(f),saved=await f.record('entities',original.id);
  assert.notEqual(saved.description,old);assert.match(saved.description,/포스트 AI/);assert.equal(saved.name,'사용자가 고친 표시 제목');assert.equal(saved.data.custom_note,'사용자의 추가 정보');assert.ok(result.conflicts.some(conflict=>conflict.id===original.id&&conflict.field==='name'));
  const before=records(await f.state());await runImport(f);assert.deepEqual(records(await f.state()),before);
});
