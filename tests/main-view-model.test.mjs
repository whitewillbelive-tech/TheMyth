import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_FIELDS } from '../web/main-domain.js';
import { mainSection, normalizeMainContext, contextForEntity, scopedEntities, withSpaceAncestors, detachedAppearances, hasAppearanceContent, captureFormFields, restoreFormFields, titleSettingsPayload, appearanceSelectionPayload, timelineParameters } from '../web/main-view-model.js';

const state = {
  entities:[
    {id:'g1',kind:'generation',name:'Earth',data:{number:1}},
    {id:'g2',kind:'generation',name:'Universe',data:{number:2}},
    {id:'g3',kind:'generation',name:'Heaven',data:{number:3}},
    {id:'t1',kind:'title',name:'위버멘쉬',sort_order:0,data:{generation_id:'g1'}},
    {id:'t2',kind:'title',name:'마몬',sort_order:1,data:{generation_id:'g1'}},
    {id:'t3',kind:'title',name:'올쳐',sort_order:0,data:{generation_id:'g2'}},
    {id:'person',kind:'character',name:'한 인물',revision:7,data:{origin_planet_id:'planet'}},
    {id:'e1',kind:'event',name:'첫 사건',data:{title_id:'t1'}},
    {id:'e2',kind:'event',name:'다른 작품 사건',data:{title_id:'t2'}},
    {id:'universe',kind:'space',name:'공통 우주',data:{}},
    {id:'planet',kind:'planet',name:'출신 행성',data:{parent_id:'universe'}},
  ],
  relations:[
    {id:'a1',type:'appearance',source_id:'person',target_id:'t1',revision:2,data:{overrides:{role:'주인공'}}},
    {id:'a3',type:'appearance',source_id:'t3',target_id:'person',revision:4,data:{note:'이전 집필 메모'}},
    {id:'archived',type:'appearance',source_id:'person',target_id:'t2',revision:9,deleted_at:'2026-01-01',data:{overrides:{notes:'보관된 설정'}}},
  ], groups:[], memberships:[],
};

test('three primary sections include a background container without a background data view', () => {
  assert.equal(mainSection('character'),'character');
  for(const view of ['organization','civilization','groups'])assert.equal(mainSection(view),'character');
  assert.equal(mainSection('event'),'event');
  for(const view of ['spaces','setting','timeline','atlas'])assert.equal(mainSection(view),'background');
});

test('common generation/title context survives serialization and is independent of view selection', () => {
  const chosen={generationId:'g2',titleId:'t3',includeCommon:false};
  const stored=JSON.parse(JSON.stringify(chosen));
  for(const view of ['character','event','spaces','timeline']) {
    assert.deepEqual(normalizeMainContext(state,stored),chosen,view);
  }
  assert.deepEqual(normalizeMainContext(state,{generationId:'g3',titleId:null}),{generationId:'g3',titleId:'',includeCommon:true});
  assert.equal(normalizeMainContext(state,{generationId:'g1',titleId:''}).titleId,'','all-title selection stays explicit');
});

test('cross-title event navigation changes context intentionally but character navigation does not', () => {
  const context={generationId:'g2',titleId:'t3',includeCommon:false};
  assert.deepEqual(contextForEntity(state,state.entities.find(e=>e.id==='e2'),context),{...context,generationId:'g1',titleId:'t2'});
  assert.deepEqual(contextForEntity(state,state.entities.find(e=>e.id==='person'),context),context);
});

test('one character remains the same global record in two selected titles', () => {
  const character=state.entities.find(e=>e.id==='person'),before=structuredClone(state);
  for(const [generationId,titleId] of [['g1','t1'],['g2','t3']]) {
    const visible=scopedEntities(state,[character],{generationId,titleId,includeCommon:false});
    assert.equal(visible.length,1);assert.equal(visible[0],character);assert.equal(visible[0].id,'person');
  }
  assert.deepEqual(state,before);
});

test('space filtering preserves original ancestor IDs and handles cyclic source safely', () => {
  const spaces=state.entities.filter(e=>['space','planet'].includes(e.kind));
  assert.deepEqual(withSpaceAncestors(spaces,[spaces.find(e=>e.id==='planet')]).map(e=>e.id),['universe','planet']);
  const cyclic=[{id:'a',data:{parent_id:'b'}},{id:'b',data:{parent_id:'a'}}];
  assert.equal(withSpaceAncestors(cyclic,[cyclic[0]]).length,2);
});

test('detaching an appearance exposes the preserved content and never deletes source records', () => {
  const before=structuredClone(state);
  const removed=detachedAppearances(state,'person',['t3']);
  assert.deepEqual(removed.map(r=>r.id),['a1']);
  assert.equal(hasAppearanceContent(removed[0]),true);
  assert.equal(hasAppearanceContent(state.relations.find(r=>r.id==='a3')),true);
  assert.deepEqual(state,before);
});

test('checkbox request keeps the original character revision and all active/archived relation revisions', () => {
  const character=state.entities.find(e=>e.id==='person');
  const fresh=appearanceSelectionPayload(state,character,['t1','t3'],null,false);
  assert.deepEqual(fresh.appearance_revisions,{a1:2,a3:4,archived:9});
  const originalDraft={base_revision:4,appearance_revisions:{a1:1,a3:3,archived:8}};
  const request=appearanceSelectionPayload(state,character,['t3'],originalDraft,true);
  assert.equal(request.revision,4,'stale draft remains guarded until explicit comparison/confirmation');
  assert.deepEqual(request.appearance_revisions,originalDraft.appearance_revisions);
  assert.equal(request.confirm_detach,true);
});

test('title form saves sparse overrides and explicit inheritance without copying common values', () => {
  const request=titleSettingsPayload([
    ['mode_name','common'],['profile_name','must not be copied'],
    ['mode_role','custom'],['profile_role','별도 역할'],
    ['mode_aliases','custom'],['profile_aliases','첫 이름, 두 이름'],
    ['mode_organization_ids','custom'],['profile_organization_ids','org-a'],['profile_organization_ids','org-b'],
    ['mode_time','custom'],['profile_time_mode','unknown'],['profile_time_label','전쟁 이후, 연도 미정'],
  ],PROFILE_FIELDS,12);
  assert.equal(request.revision,12);
  assert.equal(Object.hasOwn(request.overrides,'name'),false);
  assert.ok(request.inherit_fields.includes('name'));
  assert.deepEqual(request.overrides.aliases,['첫 이름','두 이름']);
  assert.deepEqual(request.overrides.organization_ids,['org-a','org-b']);
  assert.equal(request.overrides.time.mode,'unknown');assert.equal(request.overrides.time.year,null);
  assert.equal(request.overrides.time.label,'전쟁 이후, 연도 미정');
});

test('individual empty values are retained and switching back to common emits an inheritance reset', () => {
  const empty=titleSettingsPayload([['mode_notes','custom'],['profile_notes','']],PROFILE_FIELDS,1);
  assert.equal(empty.overrides.notes,'');
  const inherited=titleSettingsPayload([['mode_notes','common'],['profile_notes','old individual text']],PROFILE_FIELDS,2);
  assert.ok(inherited.inherit_fields.includes('notes'));assert.equal(Object.hasOwn(inherited.overrides,'notes'),false);
});

test('slot draft capture/restore retains disabled individual text and multiselect values across rerender', () => {
  const controls=[{name:'mode_notes',value:'common'},{name:'profile_notes',value:'미저장 개별 초안',disabled:true},{name:'profile_organization_ids',multiple:true,disabled:true,options:[{value:'org-a',selected:true},{value:'org-b',selected:false}]}];
  controls.namedItem=name=>controls.find(e=>e.name===name);
  const raw=captureFormFields({elements:controls});
  const restored=[{name:'mode_notes',value:'custom'},{name:'profile_notes',value:'server'},{name:'profile_organization_ids',multiple:true,options:[{value:'org-a',selected:false},{value:'org-b',selected:true}]}];
  restored.namedItem=name=>restored.find(e=>e.name===name);
  restoreFormFields({elements:restored},JSON.parse(JSON.stringify(raw)));
  assert.equal(restored[0].value,'common');assert.equal(restored[1].value,'미저장 개별 초안');
  assert.equal(restored[2].options[0].selected,true);assert.equal(restored[2].options[1].selected,false);
});

test('timeline time lookup carries the common selection, including year zero and unknown time', () => {
  const context={generationId:'g1',titleId:'t2',includeCommon:false},before=structuredClone(context);
  assert.deepEqual(timelineParameters(context,0),{generation_id:'g1',title_id:'t2',include_common:'0',year:'0'});
  assert.deepEqual(timelineParameters(context,''),{generation_id:'g1',title_id:'t2',include_common:'0'});
  assert.deepEqual(context,before);
});

// Execute the actual application entrypoint with a small DOM/network fixture.
// This verifies navigation wiring; it is not a browser, layout or GPU test.
test('application navigation keeps the shared title, expands background without a dashboard, and retains the Atlas entry', async () => {
  const {readFile}=await import('node:fs/promises');
  const requests=[],atlasCalls=[];
  class Element {
    constructor(doc,id='') {this.doc=doc;this.id=id;this._html='';this.value='';this.checked=false;this.hidden=false;this.dataset={};this.events={};this.classList={toggle(){},add(){},remove(){}};}
    get innerHTML(){return this._html;}
    set innerHTML(value){this._html=String(value);this.doc.controls.clear();if(this.id==='app')this.doc.page._html='';}
    insertAdjacentHTML(where,value){this._html=where==='afterbegin'?String(value)+this._html:this._html+String(value);this.doc.controls.clear();}
    setAttribute(name,value){this[name]=value;}
    querySelector(selector){if(selector==='.nav-chevron')return this.arrow ||= new Element(this.doc);return null;}
    querySelectorAll(){return [];}
    addEventListener(name,fn){this.events[name]=fn;}
    focus(){}
    setSelectionRange(){}
  }
  class Document {
    constructor(){this.controls=new Map();this.page=new Element(this,'page');this.app=new Element(this,'app');this.toast=new Element(this,'toast');this.dialog=new Element(this,'dialog');this.listeners={};}
    html(){return this.app.innerHTML+this.page.innerHTML;}
    querySelector(selector){
      if(selector==='#app')return this.app;if(selector==='#page')return this.page;if(selector==='#toast')return this.toast;if(selector==='#dialog')return this.dialog;
      if(this.controls.has(selector))return this.controls.get(selector);
      if(selector==='.save-state'){const el=new Element(this);this.controls.set(selector,el);return el;}
      if(!selector.startsWith('#'))return null;
      const id=selector.slice(1),html=this.html();
      const found=html.match(new RegExp('<([a-z]+)\\b([^>]*\\bid="'+id+'"[^>]*)>','i'));if(!found)return null;
      const el=new Element(this,id),attributes=found[2];
      el.value=attributes.match(/\bvalue="([^"]*)"/)?.[1]||'';el.checked=/\bchecked\b/.test(attributes);el.hidden=/\bhidden\b/.test(attributes);
      if(found[1]==='select'){
        const body=html.slice(found.index+found[0].length).split('</select>')[0];
        const options=[...body.matchAll(/<option\b([^>]*)>/g)];
        const selected=options.find(o=>/\bselected\b/.test(o[1]))||options[0];el.value=selected?.[1].match(/\bvalue="([^"]*)"/)?.[1]||'';
      }
      this.controls.set(selector,el);return el;
    }
    querySelectorAll(){return [];}
    addEventListener(name,fn){this.listeners[name]=fn;}
  }
  const doc=new Document(),storage=new Map([['myth-ui',JSON.stringify({tab:'main',view:'character',mainGeneration:'g1',mainTitle:'t1'})]]);
  const old=Object.fromEntries(['document','window','localStorage','fetch','__mainNavigationAtlas'].map(k=>[k,globalThis[k]]));
  globalThis.document=doc;globalThis.window={addEventListener(){}};
  globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))};
  const fixture={...structuredClone(state),states:[],documents:[],chapters:[],versions:[],meta:{}};
  globalThis.fetch=async(path,options={})=>{requests.push({path,method:options.method||'GET'});return {ok:true,status:200,json:async()=>String(path).startsWith('/api/timeline')?{events:[],titles:[],states:[],relations:[],uncertain:[],conflicts:[]}:structuredClone(fixture)};};
  globalThis.__mainNavigationAtlas=(...args)=>{atlasCalls.push(args);return ()=>{};};
  try {
    let source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
    source=source.replace('"/atlas-view.js"',JSON.stringify('data:text/javascript;base64,'+Buffer.from('export const mountAtlas=(...args)=>globalThis.__mainNavigationAtlas(...args);').toString('base64')))
      .replace('"/main-domain.js"',JSON.stringify(new URL('../web/main-domain.js',import.meta.url).href))
      .replace('"/main-view-model.js"',JSON.stringify(new URL('../web/main-view-model.js',import.meta.url).href));
    await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const nav=doc.app.innerHTML.match(/<nav class="side-nav"[^>]*>([\s\S]*?)<\/nav>/)[1].replace(/<div id="background-navigation"[\s\S]*?<\/div>/,'');
    assert.equal((nav.match(/<button\b/g)||[]).length,3);
    assert.ok(doc.app.innerHTML.includes('<h1>The Myth</h1>'));
    assert.equal(requests.some(r=>r.method!=='GET'),false,'opening the UI never performs catalog or data writes');
    const click=async(action,id='')=>{
      const button=new Element(doc);button.dataset={action,id};button.closest=selector=>selector==='[data-action]'?button:null;
      await doc.listeners.click({target:button,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));return button;
    };
    await click('view','event');
    assert.equal(JSON.parse(storage.get('myth-ui')).mainTitle,'t1');
    const before=doc.page.innerHTML;
    const background=await click('toggle-background');
    assert.equal(doc.page.innerHTML,before,'background only expands navigation');
    assert.equal(background['aria-expanded'],'true');
    await click('view','timeline');
    assert.equal(doc.querySelector('#timeline-title'),null,'the main timeline has only the shared title selector');
    doc.querySelector('#timeline-year').value='2040';
    await click('load-timeline');
    const query=new URL(requests.filter(r=>r.path.startsWith('/api/timeline')).at(-1).path,'http://fixture').searchParams;
    assert.equal(query.get('title_id'),'t1');assert.equal(query.get('generation_id'),'g1');assert.equal(query.get('year'),'2040');
    assert.equal(JSON.parse(storage.get('myth-ui')).mainTitle,'t1');
    await click('tab','writing');await click('tab','main');
    assert.equal(JSON.parse(storage.get('myth-ui')).mainTitle,'t1','writing round trip does not reset main context');
    await click('view','spaces');assert.ok(doc.page.innerHTML.includes('data-id="atlas"'));
    await click('view','atlas');assert.equal(atlasCalls.length,1);assert.equal(atlasCalls[0][0].id,'atlas-root');
  } finally {
    for(const [key,value] of Object.entries(old))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
});
