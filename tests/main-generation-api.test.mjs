import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../sites/api.js';
import { Fixture, collections } from './d1-test-helper.mjs';
import { CATALOG, catalogKey, catalogStatus, generationAppearanceFor, generationAppearancesFor, generationIdsForCharacter, workspaceUpgradeStatus, matchesTitleScope } from '../web/main-domain.js';

function scenario(name,run){test(name,async t=>{const f=new Fixture(handleApi);t.after(()=>f.close());let r2=0;f.env.BUCKET.put=async()=>{r2++;throw Error('No R2 writes are allowed in this suite');};f.env.BUCKET.delete=async()=>{r2++;throw Error('No R2 deletes are allowed');};await run(f);assert.equal(r2,0);});}
const copyRecords=state=>Object.fromEntries(collections.map(key=>[key,state[key]]));
async function catalog(f){return f.req('POST','/api/catalog/reconcile',{});}
async function upgrade(f){return f.req('POST','/api/workspace/upgrade-generation-model',{});}
async function genSync(f,id,generation_ids,extra={}){const state=await f.state(),character=state.entities.find(x=>x.id===id);return f.req('POST',`/api/characters/${id}/generations`,{revision:character.revision,generation_ids,generation_revisions:Object.fromEntries(generationAppearancesFor(state,id,{includeArchived:true}).map(r=>[r.id,r.revision])),...extra});}
async function patchGen(f,id,gid,patch){const relation=generationAppearanceFor(await f.state(),id,gid);return f.req('PATCH',`/api/characters/${id}/generation-settings/${gid}`,{revision:relation.revision,...patch});}
async function legacy(f){
  const generations=[];
  for(const [index,name] of ['Earth','Universe','Heaven'].entries())generations.push(await f.create('entities',{id:`old-generation-${index+1}`,kind:'generation',name,sort_order:index,data:{number:index+1,catalog_key:catalogKey(index+1)}}));
  const title=await f.create('entities',{id:'original-chera',kind:'title',name:'체라',description:'원본 작품 설명',data:{generation_id:generations[1].id,catalog_key:catalogKey(2,'체라'),overview:'기존 개요',synopsis:{ki:'기존 기',extension:'원본 확장'},extension:{retain:true}}});
  const character=await f.create('entities',{id:'original-character',kind:'character',name:'같은 인물',data:{aliases:['원래 별칭'],origin_planet_id:null,values:'기존 사상 원문'}});
  const appearance=await f.create('relations',{id:'original-title-profile',source_id:character.id,target_id:title.id,type:'appearance',data:{profile_schema:1,overrides:{role:'기존 개별 역할',notes:'기존 작품 메모'},inherit_fields:[]}});
  return {generations,title,character,appearance};
}

scenario('generation upgrade moves Chera in place and preserves legacy profiles, manuscripts, IDs and historical snapshots',async f=>{
  const {generations,title,character,appearance}=await legacy(f);
  const event=await f.create('entities',{kind:'event',name:'체라 사건',data:{title_id:title.id,generation_id:generations[1].id,time:{mode:'unknown'}}});
  const document=await f.create('documents',{kind:'story',name:'이전 원고',body:'원문 그대로',data:{title_id:title.id,generation_id:generations[1].id}});
  await f.update('entities',character,{name:'수정 이력이 있는 인물'});
  const before=await f.state(),oldIds=new Set(before.entities.map(x=>x.id)),oldVersions=structuredClone(before.versions);
  const result=await upgrade(f),after=await f.state();
  assert.equal(result.catalog.titles.filter(t=>t.name==='체라').length,1);
  const moved=after.entities.find(x=>x.id===title.id);
  assert.equal(moved.data.generation_id,generations[2].id);assert.equal(moved.data.catalog_key,catalogKey(2,'체라'));assert.equal(moved.data.catalog_key_v2,catalogKey(3,'체라'));
  assert.equal(moved.description,title.description);assert.deepEqual(moved.data.extension,title.data.extension);assert.deepEqual(moved.data.synopsis,title.data.synopsis);
  assert.deepEqual(after.relations.find(x=>x.id===appearance.id),appearance,'title-specific data must remain byte-for-byte intact');
  assert.equal(after.entities.find(x=>x.id===event.id).data.generation_id,generations[2].id);
  const savedDocument=after.documents.find(x=>x.id===document.id);assert.equal(savedDocument.body,document.body);assert.equal(savedDocument.data.generation_id,generations[2].id);
  for(const id of oldIds)assert.ok(after.entities.some(x=>x.id===id));
  for(const old of oldVersions)assert.deepEqual(after.versions.find(x=>x.id===old.id),old,'past snapshots may not be migrated');
  const relation=generationAppearanceFor(after,character.id,generations[2].id);assert.ok(relation);assert.equal(relation.data.narrative,'');
  assert.deepEqual(generationIdsForCharacter(after,character.id),[generations[2].id]);
  assert.equal(workspaceUpgradeStatus(after).needsUpgrade,false);
  const first=copyRecords(after);await upgrade(f);assert.deepEqual(copyRecords(await f.state()),first,'reopening cannot write another migration');
  f.reopen();assert.deepEqual(copyRecords(await f.state()),first);
});

scenario('generation information is independent, detach preserves content and restores the same relation without legacy resurrection',async f=>{
  const {generations}=await catalog(f),a=generations[0],b=generations[1];
  const team=await f.entity('organization','세대 소속'),group=await f.create('groups',{name:'사용자 그룹'});
  const created=await f.req('POST','/api/characters',{name:'공통 인물',data:{ideology:'공통 사상',primary_power:'미정',character_narrative:'공통 서사',mbti:{ei:70,sn:null,tf:50}},generation_ids:[a.id,b.id],generation_settings:{[a.id]:{affiliations:[{collection:'entities',id:team.id}],ideology_rank:'자유 등급',narrative:'첫 세대 서사'},[b.id]:{affiliations:[{collection:'groups',id:group.id}],narrative:'두 번째 서사'}}});
  const id=created.character.id,state=await f.state(),originalA=generationAppearanceFor(state,id,a.id),originalB=generationAppearanceFor(state,id,b.id);
  const changed=await patchGen(f,id,a.id,{narrative:'첫 세대만 수정'});
  assert.equal(changed.data.narrative,'첫 세대만 수정');assert.deepEqual(generationAppearanceFor(await f.state(),id,b.id),originalB);
  const character=await f.record('entities',id);await f.update('entities',character,{revision:character.revision,data:{...character.data,character_narrative:'공통 서사 수정'}});
  assert.equal(generationAppearanceFor(await f.state(),id,a.id).data.narrative,'첫 세대만 수정');
  const before=copyRecords(await f.state());await f.error('PATCH',`/api/characters/${id}/generation-settings/${a.id}`,{revision:originalA.revision,narrative:'오래된 창'},409);assert.deepEqual(copyRecords(await f.state()),before);
  const current=await f.record('entities',id);await f.error('POST',`/api/characters/${id}/generations`,{revision:current.revision,generation_ids:[b.id],generation_revisions:Object.fromEntries(generationAppearancesFor(await f.state(),id,{includeArchived:true}).map(x=>[x.id,x.revision]))},409);
  await genSync(f,id,[b.id],{confirm_detach:true});
  let detached=generationAppearanceFor(await f.state(),id,a.id,{includeArchived:true});assert.equal(detached.id,originalA.id);assert.ok(detached.deleted_at);assert.equal(detached.data.narrative,'첫 세대만 수정');
  await upgrade(f);assert.deepEqual(generationIdsForCharacter(await f.state(),id),[b.id]);
  await genSync(f,id,[a.id,b.id]);assert.equal(generationAppearanceFor(await f.state(),id,a.id).id,originalA.id);
  const affiliationTarget=await f.record('entities',team.id);await f.req('DELETE',`/api/entities/${affiliationTarget.id}`);
  await patchGen(f,id,a.id,{narrative:'보관된 소속은 유지하며 수정'});
  assert.deepEqual(generationAppearanceFor(await f.state(),id,a.id).data.affiliations,[{collection:'entities',id:team.id}]);
});

scenario('optional MBTI axes and generation fields accept unknown values without fabricating ratios or coupling generations',async f=>{
  const {generations,titles}=await catalog(f),g=generations[0];
  const created=await f.req('POST','/api/characters',{data:{mbti:{ei:null},ideology:null,primary_power:'',character_narrative:''},generation_ids:[g.id],generation_settings:{[g.id]:{affiliations:null,ideology_rank:null,narrative:''}}}, {'oai-authenticated-user-id':'browser-owner'});
  assert.deepEqual(created.character.data.mbti,{ei:null});assert.equal(created.character.name,'이름 미정');assert.equal(created.generation_appearances.length,1);
  assert.deepEqual(created.generation_appearances[0].data.affiliations,[]);assert.equal(Object.hasOwn(created.character.data.mbti,'sn'),false);
  const legacy=await f.req('POST','/api/characters',{title_ids:[titles[0].id]});assert.deepEqual(generationIdsForCharacter(await f.state(),legacy.character.id),[g.id]);
  const explicit=await f.req('POST','/api/characters',{title_ids:[titles[0].id],generation_ids:[]});assert.deepEqual(generationIdsForCharacter(await f.state(),explicit.character.id),[]);
  const before=copyRecords(await f.state());
  for(const mbti of [{ei:-1},{ei:101},{tf:true},{unknown:50},'INTJ']){await f.error('POST','/api/characters',{data:{mbti},generation_ids:[g.id]},422);assert.deepEqual(copyRecords(await f.state()),before);}
  for(const patch of [{generation_ids:[g.id,g.id]},{generation_ids:['missing']},{generation_ids:[g.id],generation_settings:{[g.id]:{affiliations:[{collection:'entities',id:titles[0].id}]}}},{generation_ids:[g.id],generation_settings:{[g.id]:{ideology_rank:1}}}]){await f.error('POST','/api/characters',patch,422);assert.deepEqual(copyRecords(await f.state()),before);}
});

scenario('title overview and synopsis patches are isolated per title, revision guarded and versioned without losing legacy text',async f=>{
  const {titles}=await catalog(f),a=titles[0],b=titles[1];
  let current=await f.update('entities',a,{revision:a.revision,description:'보존할 기존 설명',data:{...a.data,synopsis:{extension:'이전 확장'}}});
  const first=await f.req('PATCH',`/api/titles/${a.id}/story`,{revision:current.revision,overview:'첫 작품 개요',synopsis:{ki:'기 내용'}},{'oai-authenticated-user-id':'browser-owner'});
  const second=await f.req('PATCH',`/api/titles/${a.id}/story`,{revision:first.revision,synopsis:{jeon:'전 내용',gyeol:''}});
  assert.deepEqual(second.data.synopsis,{extension:'이전 확장',ki:'기 내용',jeon:'전 내용',gyeol:''});assert.equal(second.description,'보존할 기존 설명');assert.equal(second.data.overview,'첫 작품 개요');
  assert.deepEqual(await f.record('entities',b.id),b);
  const before=copyRecords(await f.state());await f.error('PATCH',`/api/titles/${a.id}/story`,{revision:first.revision,overview:'충돌'},409);assert.deepEqual(copyRecords(await f.state()),before);
  await f.error('PATCH',`/api/titles/${a.id}/story`,{revision:second.revision,synopsis:{unknown:'내용'}},422);assert.deepEqual(copyRecords(await f.state()),before);
  const history=(await f.state()).versions.filter(x=>x.target_id===a.id);assert.ok(history.some(x=>x.snapshot.data.overview==='첫 작품 개요'&&x.snapshot.data.synopsis.ki==='기 내용'));
  const legacy=await f.update('entities',b,{data:{...b.data,synopsis:'원래 한 덩어리 시놉시스',synopsis_legacy:'사용자의 기존 확장값'}});
  const converted=await f.req('PATCH',`/api/titles/${b.id}/story`,{revision:legacy.revision,synopsis:{ki:'새 기'}});
  assert.equal(converted.data.synopsis_legacy,'사용자의 기존 확장값');
  assert.ok((await f.state()).versions.some(x=>x.target_id===b.id&&x.snapshot.data.synopsis==='원래 한 덩어리 시놉시스'));
  f.reopen();assert.deepEqual(await f.record('entities',a.id),second);
});

scenario('ambiguous Chera titles or mixed generation references stop the whole migration without partial catalog or profile writes',async f=>{
  const {title,generations}=await legacy(f);
  const other=await f.create('entities',{kind:'title',name:'함께 연결된 다른 작품',data:{generation_id:generations[1].id}});
  const document=await f.create('documents',{name:'혼합 참조',kind:'story',data:{title_ids:[title.id,other.id],generation_id:generations[1].id}});
  let before=copyRecords(await f.state());await f.error('POST','/api/workspace/upgrade-generation-model',{},409);assert.deepEqual(copyRecords(await f.state()),before);
  await f.update('documents',document,{data:{...document.data,title_ids:[title.id]}});
  await f.create('entities',{kind:'title',name:'체라',data:{generation_id:generations[2].id,catalog_key:catalogKey(3,'체라')}});
  before=copyRecords(await f.state());await f.error('POST','/api/workspace/upgrade-generation-model',{},409);assert.deepEqual(copyRecords(await f.state()),before);
});

scenario('ordinary reads never migrate and generation membership controls character scope after explicit detach',async f=>{
  const {generations,character}=await legacy(f),before=copyRecords(await f.state());
  assert.equal(workspaceUpgradeStatus(await f.state()).needsUpgrade,true);await f.req('GET','/api/state');assert.deepEqual(copyRecords(await f.state()),before);
  await upgrade(f);let state=await f.state();const person=state.entities.find(x=>x.id===character.id);
  assert.equal(matchesTitleScope(state,person,{generationId:generations[2].id,includeCommon:false}),true);
  assert.equal(matchesTitleScope(state,person,{generationId:generations[1].id,includeCommon:false}),false);
  await genSync(f,character.id,[],{confirm_detach:true});state=await f.state();
  assert.deepEqual(generationIdsForCharacter(state,character.id),[]);await upgrade(f);assert.deepEqual(generationIdsForCharacter(await f.state(),character.id),[]);
  const moved=(await f.state()).entities.find(x=>x.name==='체라');await f.req('DELETE',`/api/entities/${moved.id}`);await upgrade(f);
  assert.ok((await f.record('entities',moved.id)).deleted_at,'intentional archive action is never reversed by migration');
});

scenario('generation affiliation references participate in existing merge impact and retain restorable history',async f=>{
  const {generations}=await catalog(f),generation=generations[0];
  const source=await f.entity('organization','병합 원본'),target=await f.entity('organization','병합 대상');
  const created=await f.req('POST','/api/characters',{generation_ids:[generation.id],generation_settings:{[generation.id]:{affiliations:[{collection:'entities',id:source.id},{collection:'entities',id:target.id}],narrative:'소속이 있는 서사'}}});
  const relation=generationAppearanceFor(await f.state(),created.character.id,generation.id);
  const preview=await f.req('GET',`/api/entities/${target.id}/merge-preview?source_id=${source.id}`);
  assert.ok(preview.impact.references.some(ref=>ref.collection==='relations'&&ref.record.id===relation.id));
  await f.req('POST',`/api/entities/${target.id}/merge`,{source_id:source.id,field_choices:Object.fromEntries(preview.conflicts.map(field=>[field.field,'target']))});
  const after=generationAppearanceFor(await f.state(),created.character.id,generation.id);
  assert.deepEqual(after.data.affiliations,[{collection:'entities',id:target.id}]);assert.equal(after.data.narrative,'소속이 있는 서사');
  assert.ok((await f.state()).versions.some(version=>version.target_id===relation.id&&version.snapshot.data.affiliations.some(ref=>ref.id===source.id)));
});

// v8 treats catalog markers independently of a title's actual generation. The
// canonical v2 marker must coexist with that old key so an old client neither
// reseeds Chera nor silently moves it back while the version is rolled back.
const legacyV8CatalogInitialized=state=>[
  ...[1,2,3].map(number=>({kind:'generation',key:catalogKey(number)})),
  ...['위버멘쉬','마몬','아나키','랑데부'].map(name=>({kind:'title',key:catalogKey(1,name)})),
  ...['올쳐','브이젯','흑과 백의 서신','영웅과 용사의 길','체라','월계 전쟁'].map(name=>({kind:'title',key:catalogKey(2,name)})),
].every(spec=>state.entities.some(row=>row.kind===spec.kind&&row.data?.catalog_key===spec.key));

scenario('migrated and fresh Chera remain initialized for v8 readers while canonical generation and markers repair in place',async f=>{
  const original=await legacy(f);await upgrade(f);let state=await f.state();
  assert.equal(legacyV8CatalogInitialized(state),true);assert.equal(catalogStatus(state).initialized,true);
  const moved=state.entities.find(row=>row.id===original.title.id);
  assert.equal(moved.data.catalog_key,catalogKey(2,'체라'));assert.equal(moved.data.catalog_key_v2,catalogKey(3,'체라'));
  let partial=await f.update('entities',moved,{data:{...moved.data,catalog_key:catalogKey(3,'체라')}});
  assert.equal(workspaceUpgradeStatus(await f.state()).needsUpgrade,true,'missing legacy marker requires rollback-safe repair');
  await upgrade(f);state=await f.state();assert.equal(legacyV8CatalogInitialized(state),true);assert.equal(state.entities.filter(row=>row.name==='체라').length,1);
  partial=await f.record('entities',original.title.id);
  await f.update('entities',partial,{data:{...partial.data,generation_id:original.generations[1].id}});
  assert.equal(workspaceUpgradeStatus(await f.state()).needsUpgrade,true,'canonical marker with wrong physical generation is not initialized');
  await upgrade(f);const restored=await f.record('entities',original.title.id);
  assert.equal(restored.data.generation_id,original.generations[2].id);assert.equal(restored.id,original.title.id);
  const fresh=new Fixture(handleApi);
  try{await catalog(fresh);const freshState=await fresh.state();assert.equal(legacyV8CatalogInitialized(freshState),true);assert.equal(catalogStatus(freshState).initialized,true);const chera=freshState.entities.find(row=>row.name==='체라');assert.equal(chera.data.catalog_key,catalogKey(2,'체라'));assert.equal(chera.data.catalog_key_v2,catalogKey(3,'체라'));}finally{fresh.close();}
});

scenario('an existing custom canonical-marker field is never overwritten by the Chera upgrade',async f=>{
  const {title}=await legacy(f);
  await f.update('entities',title,{data:{...title.data,catalog_key_v2:'사용자가 미리 저장한 다른 값'}});
  const before=copyRecords(await f.state());
  await f.error('POST','/api/workspace/upgrade-generation-model',{},409);
  assert.deepEqual(copyRecords(await f.state()),before);
  assert.equal((await f.record('entities',title.id)).data.catalog_key_v2,'사용자가 미리 저장한 다른 값');
});
