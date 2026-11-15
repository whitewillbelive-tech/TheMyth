import test from 'node:test';
import assert from 'node:assert/strict';
import { mbtiSummary, readMbti, readCommonCharacter, readGenerationProfile, characterGenerationIds, generationProfile } from '../web/generation-character-domain.js';
import { renderGenerationCharacter, bindGenerationCharacter, newGenerationCharacter } from '../web/generation-characters.js';

const state = () => ({ entities:[
  {id:'g1',kind:'generation',name:'Earth',data:{number:1}},
  {id:'g2',kind:'generation',name:'Universe',data:{number:2}},
  {id:'g3',kind:'generation',name:'Heaven',data:{number:3}},
  {id:'t1',kind:'title',name:'기존 작품',data:{generation_id:'g1'}},
  {id:'planet',kind:'planet',name:'실제 출신 행성',data:{}},
  {id:'demo:planet',kind:'planet',name:'가상 데모 행성',data:{demo:true}},
  {id:'org',kind:'organization',name:'원본 집단',data:{}},
  {id:'person',kind:'character',name:'동일 인물',revision:7,description:'이전 설명',data:{generation_model_version:1,origin_planet_id:'planet',species:'이전 종족',aliases:['이전 별칭'],extension:{keep:true},ideology:'공통 사상',character_narrative:'공통 서사'}},
],relations:[
  {id:'r1',source_id:'person',target_id:'g1',type:'generation_appearance',revision:3,data:{generation_schema:1,affiliations:[{collection:'entities',id:'org'}],ideology_rank:'자유 등급',narrative:'첫 세대 서사'}},
  {id:'r2',source_id:'g2',target_id:'person',type:'generation_appearance',revision:4,data:{generation_schema:1,affiliations:[],ideology_rank:'',narrative:'둘째 세대 서사'}},
  {id:'old-title',source_id:'person',target_id:'t1',type:'appearance',revision:2,data:{overrides:{notes:'타이틀별 원문'}}},
],groups:[{id:'group:home',name:'그룹 원본'}] });

test('MBTI leaves missing and tied axes unknown, preserves exact complements, and rejects invalid percentages',()=>{
  assert.equal(mbtiSummary().type,'미정');
  assert.ok(mbtiSummary().axes.every(axis=>axis.value===null&&axis.opposite===null));
  const result=mbtiSummary({ei:70,sn:30,tf:100,jp:0});
  assert.equal(result.type,'ENTP');
  assert.ok(result.axes.every(axis=>axis.value+axis.opposite===100));
  assert.equal(mbtiSummary({ei:50,sn:30,tf:100,jp:0}).type,'미정');
  assert.deepEqual(readMbti([['mbti_ei',''],['mbti_sn','0'],['mbti_tf','100'],['mbti_jp','50']]),{ei:null,sn:0,tf:100,jp:50});
  for(const value of ['-1','101','NaN','Infinity'])assert.throws(()=>readMbti([['mbti_ei',value]]));
});

test('common profile changes preserve the original identity and hidden legacy data, without copying a demo planet',()=>{
  const db=state(),person=db.entities.find(row=>row.id==='person'),before=structuredClone(person);
  person.data.mbti={ei:80,sn:20};
  const payload=readCommonCharacter([['name',''],['origin_planet_id','planet'],['ideology','대표 신념'],['primary_power','미정인 체계'],['character_narrative','긴 공통 서사\n두 번째 줄'],['mbti_ei','']],person,db);
  assert.equal(payload.name,'이름 미정');assert.equal(payload.data.origin_planet_id,'planet');
  assert.equal(payload.data.species,before.data.species);assert.deepEqual(payload.data.extension,{keep:true});
  assert.equal(payload.data.mbti.ei,null);assert.equal(payload.data.mbti.sn,20,'an absent input cannot erase another MBTI axis');
  assert.throws(()=>readCommonCharacter([['origin_planet_id','demo:planet']],person,db));
  assert.throws(()=>readCommonCharacter([['origin_planet_id','unknown']],person,db));
});

test('generation detachment does not infer an old title link back into the generation list',()=>{
  const db=state(),person=db.entities.find(row=>row.id==='person');
  assert.deepEqual(characterGenerationIds(db,person),['g1','g2']);
  db.relations.find(row=>row.id==='r1').deleted_at='2026-11-15';
  assert.deepEqual(characterGenerationIds(db,person),['g2']);
  const archived=generationProfile(db,person.id,'g1');
  assert.equal(archived.archived,true);assert.equal(archived.narrative,'첫 세대 서사');
  assert.deepEqual(db.relations.find(row=>row.id==='old-title').data,{overrides:{notes:'타이틀별 원문'}});
  assert.deepEqual(readGenerationProfile([['affiliations','groups:group:home'],['affiliations','entities:org'],['ideology_rank','서열 없는 텍스트'],['narrative','별도 서사']]),{affiliations:[{collection:'groups',id:'group:home'},{collection:'entities',id:'org'}],ideology_rank:'서열 없는 텍스트',narrative:'별도 서사'});
});

test('character rendering exposes common MBTI, checked-generation panels, legacy profiles and conflict recovery controls',()=>{
  const db=state(),person=db.entities.find(row=>row.id==='person');
  const html=renderGenerationCharacter(person,{db,localDrafts:{}});
  assert.ok(html.includes('name="ideology"'));assert.ok(html.includes('name="primary_power"'));
  assert.ok(html.includes('name="character_narrative" rows="12"'));
  for(const key of ['ei','sn','tf','jp'])assert.ok(html.includes('name="mbti_'+key+'" value=""'));
  assert.match(html,/data-generation-panel="g1" >/);assert.match(html,/data-generation-panel="g3" hidden/);
  assert.ok(html.includes('data-generation-action="review-draft"'));
  assert.ok(html.includes('타이틀별 원문'));assert.equal(html.includes('가상 데모 행성'),false);
  const unsafe={...person,name:'<img src=x onerror=alert(1)>'};
  assert.equal(renderGenerationCharacter(unsafe,{db,localDrafts:{}}).includes('<img src=x'),false);
});

// Small successful-control form fixture. Tests below exercise the production
// handlers and asynchronous persistence, rather than browser layout or WebGL.
class Control {
  constructor(name,value='',attrs={}){this.name=name;this.value=value;this.attrs=attrs;this.type=attrs.type||'text';this.multiple=!!attrs.multiple;this.checked=!!attrs.checked;this.disabled=false;this.style={};this.events={};this.dataset={};}
  addEventListener(event,fn){(this.events[event]||=[]).push(fn);}
  async fire(event){for(const fn of this.events[event]||[])await fn({target:this,preventDefault(){}});await this['on'+event]?.({target:this,preventDefault(){}});}
}
class Form {
  constructor(controls=[],dataset={}){this.controls=controls;this.dataset=dataset;this.events={};this.notice={textContent:'',classList:{toggle(){}}};}
  get elements(){return this.controls;}
  addEventListener(event,fn){(this.events[event]||=[]).push(fn);}
  async fire(event){for(const fn of this.events[event]||[])await fn({target:this,preventDefault(){}});await this['on'+event]?.({target:this,preventDefault(){}});}
  querySelector(selector){if(selector==='.generation-save-notice')return this.notice;const match=selector.match(/^\[data-mbti-(number|slider)="([a-z]+)"\]$/);if(match)return this.controls.find(control=>control.attrs['data-mbti-'+match[1]]===match[2])||null;return null;}
  querySelectorAll(selector){return selector==='textarea[data-autogrow]'?this.controls.filter(control=>control.attrs.textarea):[];}
  closest(){return {hidden:false};}
}
class FormDataFixture {
  constructor(form){this.values=form.controls.filter(control=>control.name&&!control.disabled&&(control.type!=='checkbox'||control.checked)).flatMap(control=>(control.multiple?control.value:[control.value]).map(value=>[control.name,value]));}
  entries(){return this.values[Symbol.iterator]();}
  getAll(key){return this.values.filter(([name])=>name===key).map(([,value])=>value);}
  get(key){return this.values.find(([name])=>name===key)?.[1]??null;}
}
const commonControls=()=>[new Control('name','동일 인물'),new Control('origin_planet_id','planet'),new Control('ideology','수정 사상'),new Control('primary_power','아직 자유로운 설명'),new Control('character_narrative','새 공통 서사',{textarea:true}),...['ei','sn','tf','jp'].map(key=>new Control('mbti_'+key,''))];
const rootFixture=(common,selection,profiles=[])=>({querySelector:selector=>selector==='#gen-common-form'?common:selector==='#gen-appearance-form'?selection:null,querySelectorAll:selector=>selector==='[data-generation-profile]'?profiles:[]});
async function withFormData(fn){const old=globalThis.FormData;globalThis.FormData=FormDataFixture;try{await fn();}finally{globalThis.FormData=old;}}

test('actual common and per-generation save handlers keep the other generation and old title profile unchanged',async()=>withFormData(async()=>{
  const db=state(),person=db.entities.find(row=>row.id==='person'),before=structuredClone(db),requests=[],drafts={};
  const common=new Form(commonControls(),{revision:'7'}),selection=new Form([new Control('generation_ids','g1',{type:'checkbox',checked:true}),new Control('generation_ids','g2',{type:'checkbox',checked:true})]);
  const profile=new Form([new Control('affiliations',['groups:group:home'],{multiple:true}),new Control('ideology_rank','확정하지 않은 등급'),new Control('narrative','새 1세대 서사',{textarea:true})],{generationProfile:'g1',revision:'3'});
  const ctx={getState:()=>db,localDrafts:drafts,draftsPersist(){},refresh:async()=>{},render(){},api:async(path,method,payload)=>{
    requests.push({path,method,payload});
    if(path==='/entities/person'){const result={...person,...payload,revision:8};db.entities=db.entities.map(row=>row.id==='person'?result:row);return result;}
    const result={...db.relations[0],revision:4,data:{...db.relations[0].data,...payload}};delete result.data.revision;db.relations[0]=result;return result;
  }};
  const cleanup=bindGenerationCharacter(rootFixture(common,selection,[profile]),person,ctx);
  await common.fire('submit');await profile.fire('submit');cleanup();
  assert.equal(requests[0].payload.revision,7);assert.equal(requests[1].payload.revision,3);
  assert.equal(db.entities.find(row=>row.id==='person').data.character_narrative,'새 공통 서사');
  assert.equal(db.relations[0].data.narrative,'새 1세대 서사');
  assert.deepEqual(db.relations[1],before.relations[1]);assert.deepEqual(db.relations[2],before.relations[2]);
  assert.deepEqual(drafts,{});
}));

test('an autosave conflict retains its draft and cannot silently overwrite newer server content',async()=>withFormData(async()=>{
  const db=state(),person=db.entities.find(row=>row.id==='person'),common=new Form(commonControls(),{revision:'7'}),selection=new Form([]),drafts={};
  let calls=0;const cleanup=bindGenerationCharacter(rootFixture(common,selection),person,{db,localDrafts:drafts,draftsPersist(){},refresh:async()=>{},render(){},api:async()=>{calls++;throw Object.assign(new Error('다른 창에서 변경됨'),{status:409});}});
  await common.fire('input');await cleanup.flush();
  assert.equal(calls,1);assert.equal(drafts['generation-common:person'].raw.character_narrative,'새 공통 서사');
  await common.fire('submit');assert.equal(calls,1,'a conflict requires explicit comparison before rebasing');cleanup();
}));

function parseForm(html){
  const controls=[];
  const attrs=text=>Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match=>[match[1],match[2]??true]));
  for(const match of html.matchAll(/<input\b([^>]*)>/g)){const a=attrs(match[1]);controls.push(new Control(a.name||'',a.value||'',a));}
  for(const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)){const a=attrs(match[1]);controls.push(new Control(a.name,match[2],{...a,textarea:true}));}
  for(const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){
    const a=attrs(match[1]),options=[...match[2].matchAll(/<option\b([^>]*)>/g)].map(option=>attrs(option[1]));
    const chosen=options.filter(option=>option.selected).map(option=>option.value||'');
    controls.push(new Control(a.name,a.multiple?chosen:chosen[0]??options[0]?.value??'',a));
  }
  return new Form(controls);
}

test('the real creation dialog submits optional common fields and two independent generation panels atomically',async()=>withFormData(async()=>{
  const db=state(),drafts={};let form,submit,html,body,created;
  const ctx={db,localDrafts:drafts,draftsPersist(){},document:{querySelector:()=>form},generationId:'g1',openDialog:(_,markup,handler)=>{html=markup;form=parseForm(markup);submit=handler;},api:async(path,method,payload)=>{assert.equal(path,'/characters');body=payload;return {character:{id:'new',...payload}};},refresh:async()=>{},render(){},onCreated:record=>created=record};
  newGenerationCharacter(ctx);
  assert.equal(html.includes('select name="kind"'),false);assert.equal(html.includes('data-new-generation-panel="g3" hidden'),true);
  form.controls.find(control=>control.name==='name').value='';
  form.controls.find(control=>control.name==='generation_ids'&&control.value==='g2').checked=true;
  form.controls.find(control=>control.name==='generation_g1_narrative').value='第一世代独立内容';
  form.controls.find(control=>control.name==='generation_g2_narrative').value='第二世代独立内容';
  await form.fire('input');await submit(new FormDataFixture(form),form);
  assert.equal(body.name,'이름 미정');assert.deepEqual(body.generation_ids,['g1','g2']);
  assert.equal(body.generation_settings.g1.narrative,'第一世代独立内容');assert.equal(body.generation_settings.g2.narrative,'第二世代独立内容');
  assert.deepEqual(body.data.mbti,{ei:null,sn:null,tf:null,jp:null});assert.equal(body.data.origin_planet_id,null);
  assert.equal(created.id,'new');assert.deepEqual(drafts,{});
}));
