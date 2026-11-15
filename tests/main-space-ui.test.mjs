import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CATALOG, catalogKey } from '../web/main-domain.js';
import { adaptWorld, childrenFor } from '../web/atlas-data.js';
import { cityData } from '../web/atlas-city-map.js';

// Execute production navigation, readonly-space routing, and stale-action guards.
// This fixture models form successful-controls and event wiring, not browser
// layout, browser constraint validation, WebGL, or real network authentication.
const decode = value => String(value).replace(/&(amp|lt|gt|quot|#39);/g, (_, code) => ({ amp:'&', lt:'<', gt:'>', quot:'"', '#39':"'" })[code]);
const voidTags = new Set(['input','br','hr','img','meta','link']);
class Node {
  constructor(tag = 'div', attrs = {}, parent = null) {
    this.tagName=tag;this.attrs=attrs;this.parent=parent;this.children=[];this.events={};
    this.dataset=Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));
    this.disabled=Object.hasOwn(attrs,'disabled');this.hidden=Object.hasOwn(attrs,'hidden');this.checked=Object.hasOwn(attrs,'checked');this.selected=Object.hasOwn(attrs,'selected');
    const classes=new Set((attrs.class||'').split(/\s+/).filter(Boolean));
    this.classList={toggle:(name,value)=>{const on=value??!classes.has(name);on?classes.add(name):classes.delete(name);},add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
  }
  get id(){return this.attrs.id||'';} get name(){return this.attrs.name||'';} get type(){return this.attrs.type||'text';}
  get multiple(){return Object.hasOwn(this.attrs,'multiple');}
  get options(){return this.querySelectorAll('option');}
  get elements(){const nodes=this.querySelectorAll('input,select,textarea,button');nodes.namedItem=name=>nodes.find(node=>node.name===name)||null;return nodes;}
  get value(){
    if(this.tagName==='select')return (this.options.find(option=>option.selected)||(!this.multiple?this.options[0]:null))?.value||'';
    if(this._value!==undefined)return this._value;
    return this.tagName==='textarea'?this.textContent:this.attrs.value||'';
  }
  set value(value){this._value=String(value);if(this.tagName==='select')for(const option of this.options)option.selected=option.value===this._value;}
  get textContent(){return this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
  set textContent(value){this.children=[String(value)];}
  get innerHTML(){return this._html||'';}
  set innerHTML(html){this._html=String(html);this.children=[];parseInto(this,this._html);}
  insertAdjacentHTML(where,html){const holder=new Node();holder.innerHTML=html;for(const child of holder.children)if(typeof child!=='string')child.parent=this;this.children=where==='afterbegin'?[...holder.children,...this.children]:[...this.children,...holder.children];}
  setAttribute(name,value){this.attrs[name]=String(value);}
  addEventListener(name,fn){(this.events[name]||=[]).push(fn);}
  async fire(name){const event={target:this,preventDefault(){}};await this['on'+name]?.(event);for(const fn of this.events[name]||[])await fn(event);}
  querySelectorAll(selector){const all=[];const visit=node=>{for(const child of node.children)if(typeof child!=='string'){all.push(child);visit(child);}};visit(this);return all.filter(node=>selector.split(',').some(part=>matchesPath(node,part.trim())));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parent)if(matchesPath(node,selector))return node;return null;}
  focus(){} setSelectionRange(){} showModal(){this.open=true;} close(){this.open=false;}
}
function matchesPath(node,selector) {
  const parts=selector.split(/\s+/),simple=parts.pop();
  if(!matchesSimple(node,simple))return false;
  if(!parts.length)return true;
  for(let parent=node.parent;parent;parent=parent.parent)if(matchesPath(parent,parts.join(' ')))return true;
  return false;
}
function matchesSimple(node,selector) {
  const tag=selector.match(/^[a-z][\w-]*/i)?.[0];if(tag&&node.tagName!==tag)return false;
  const id=selector.match(/#([\w-]+)/)?.[1];if(id&&node.id!==id)return false;
  for(const [,name] of selector.matchAll(/\.([\w-]+)/g))if(!node.classList.contains(name))return false;
  for(const [,name,,value] of selector.matchAll(/\[([^=\]]+)(?:=(["']?)(.*?)\2)?\]/g)) {
    if(!Object.hasOwn(node.attrs,name))return false;
    if(value!==undefined&&node.attrs[name]!==value)return false;
  }
  return true;
}
function parseInto(root,html) {
  const stack=[root];
  for(const match of html.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/gi)) {
    if(match[3]!==undefined){stack.at(-1).children.push(decode(match[3]));continue;}
    if(match[0].startsWith('</')){if(stack.length>1)stack.pop();continue;}
    const attrs={};
    for(const [,name,,quoted,bare] of match[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:(["'])(.*?)\2|([^\s]+)))?/g))attrs[name]=decode(quoted??bare??'');
    const node=new Node(match[1].toLowerCase(),attrs,stack.at(-1));stack.at(-1).children.push(node);
    if(!voidTags.has(node.tagName))stack.push(node);
  }
}
class Document extends Node {
  constructor(){super('document');this.innerHTML='<div id="app"></div><dialog id="dialog"></dialog><div id="toast"></div>';}
}
class FormDataFixture {
  constructor(form){
    this.values=[];
    for(const control of form.elements){
      if(!control.name||control.disabled||control.closest('fieldset')?.disabled||['button','submit'].includes(control.type))continue;
      if(['checkbox','radio'].includes(control.type)&&!control.checked)continue;
      if(control.tagName==='select'&&control.multiple){for(const option of control.options)if(option.selected)this.values.push([control.name,option.value]);}
      else this.values.push([control.name,control.value]);
    }
  }
  entries(){return this.values.values();} [Symbol.iterator](){return this.entries();}
  get(name){return this.values.find(([key])=>key===name)?.[1]??null;}
  getAll(name){return this.values.filter(([key])=>key===name).map(([,value])=>value);}
  has(name){return this.values.some(([key])=>key===name);}
}
function readyState(){
  const entities=[];
  for(const generation of CATALOG){
    const id='g'+generation.number;entities.push({id,kind:'generation',name:generation.name,data:{number:generation.number,catalog_key:catalogKey(generation.number)}});
    generation.titles.forEach((name,index)=>entities.push({id:`t${generation.number}-${index}`,kind:'title',name,sort_order:index,data:{generation_id:id,catalog_key:catalogKey(generation.number,name)}}));
  }
  entities.push({id:'planet',kind:'planet',name:'기존 출신 행성',data:{}});
  return {entities,relations:[],groups:[],memberships:[],states:[],documents:[],chapters:[],versions:[],meta:{}};
}
let importNumber=0;
async function application(run,{initial=readyState(),reconcileStatus=200,concurrentReady=true}={}){
  const keys=['document','window','localStorage','fetch','FormData','setTimeout','clearTimeout','__spaceAtlasMount'];
  const old=Object.fromEntries(keys.map(key=>[key,globalThis[key]])),doc=new Document(),storage=new Map(),requests=[],atlasMounts=[];
  let fixture=structuredClone(initial);
  globalThis.__spaceAtlasMount=(root,entities,relations,context)=>{const mount={root,entities,relations,context,disposed:false};atlasMounts.push(mount);root.innerHTML='<p>읽기 전용 Atlas</p>';return()=>{mount.disposed=true;};};
  globalThis.document=doc;globalThis.window={addEventListener(){}};
  globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))};
  globalThis.FormData=FormDataFixture;globalThis.setTimeout=()=>0;globalThis.clearTimeout=()=>{};
  globalThis.fetch=async(path,options={})=>{
    const method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined;requests.push({path,method,body});
    let status=200,result;
    if(path==='/api/state')result=structuredClone(fixture);
    else if(path==='/api/catalog/reconcile'){
      status=reconcileStatus;if(status<300||concurrentReady)fixture=readyState();
      result=status<300?{unchanged:false}:{detail:'동시에 등록되었습니다.'};
    }else if(path==='/api/entities'&&method==='POST'){
      result={id:'created-space-'+requests.filter(row=>row.path==='/api/entities'&&row.method==='POST').length,revision:1,...body};fixture.entities.push(result);
    }else if(path==='/api/characters'){
      const character={id:'created-person',revision:1,...body,kind:'character'};delete character.title_ids;delete character.title_settings;
      fixture.entities.push(character);result={character,appearances:[]};
    }else if(path.startsWith('/api/entities/')&&method==='PATCH'){
      const id=path.split('/').at(-1);result={...fixture.entities.find(row=>row.id===id),...body};fixture.entities=fixture.entities.map(row=>row.id===id?result:row);
    }else throw new Error(`Unexpected fixture request ${method} ${path}`);
    return {ok:status<300,status,json:async()=>structuredClone(result)};
  };
  try {
    let source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
    source=source.replace('"/atlas-view.js"',JSON.stringify('data:text/javascript,export const mountAtlas=(...args)=>globalThis.__spaceAtlasMount(...args);'))
      .replace('"/main-domain.js"',JSON.stringify(new URL('../web/main-domain.js',import.meta.url).href))
      .replace('"/main-view-model.js"',JSON.stringify(new URL('../web/main-view-model.js',import.meta.url).href))
      .replace('"/generation-characters.js"',JSON.stringify(new URL('../web/generation-characters.js',import.meta.url).href))
      .replace('"/title-synopsis.js"',JSON.stringify(new URL('../web/title-synopsis.js',import.meta.url).href));
    const boot=source.lastIndexOf('\ntry {\n  await refresh');assert.ok(boot>0,'Application bootstrap must be present');
    // Rendering has separate navigation coverage. Keep bootstrap and actual
    // dialogs untouched while suppressing layout work in this form fixture.
    source=source.slice(0,boot)+'\nconst renderActualSpace=render;render=()=>{};\n'+source.slice(boot)+`\nexport {newSpace,newEntity,entityFields,entityDetail,readEntity,bindForms,refresh,archive,shell,spaceTree,spatialReadOnlyDetail,renderActualSpace};export const context=value=>Object.assign(ui,value);export const runtime=()=>({db,ui,localDrafts});\n// spatial form test ${++importNumber}`;
    const app=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    await run({app,doc,requests,storage,atlasMounts,fixture:()=>fixture});
  }finally{for(const key of keys)if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key];}
}
const fragment=html=>{const root=new Node();root.innerHTML=html;return root;};
async function click(doc,node){assert.ok(node,'Missing action button');for(const handler of doc.events.click||[])await handler({target:node,preventDefault(){}});}
function legacyState(){
  const fixture=readyState();
  fixture.entities=fixture.entities.filter(row=>row.id!=='planet');
  fixture.entities.push(
    {id:'legacy-universe',kind:'space',name:'기존 최상위 기록',data:{subtype:'universe',extension:{keep:true}}},
    {id:'legacy-galaxy',kind:'space',name:'기존 은하',revision:3,data:{subtype:'은하',parent_id:'legacy-universe',extension:{keep:true}}},
    {id:'legacy-planet',kind:'planet',name:'기존 행성',data:{parent_id:'legacy-galaxy'}},
    {id:'legacy-city',kind:'space',name:'기존 도시',data:{subtype:'도시',parent_id:'legacy-planet'}},
  );
  return fixture;
}

test('space navigation enters the readonly Atlas directly with all global records and no intermediate editing screen',async()=>{
  const initial=legacyState(),before=structuredClone(initial);
  await application(async({app,doc,requests,atlasMounts})=>{
    app.context({view:'spaces',tab:'main',mainGeneration:'g2',mainTitle:'',includeCommon:false,query:'',kind:'',group:''});
    const shell=fragment(app.shell());
    assert.equal(shell.querySelector('[data-action="view"][data-id="spaces"]').textContent,'공간');
    assert.equal(app.shell().includes('우주 공간'),false);
    app.renderActualSpace();
    const page=doc.querySelector('#page');
    assert.ok(page.querySelector('#atlas-root'),'Space mounts the Atlas as its primary content');
    assert.equal(atlasMounts.length,1);
    const mounted=atlasMounts[0];
    assert.equal(mounted.root,page.querySelector('#atlas-root'));
    assert.deepEqual(mounted.entities,before.entities,'Space uses one global archive rather than generation copies');
    assert.deepEqual(mounted.relations,before.relations);
    assert.deepEqual(mounted.context.groups,before.groups);assert.deepEqual(mounted.context.memberships,before.memberships);
    assert.equal(page.querySelector('.split-view'),null,'there is no intermediate spatial archive editor');
    assert.equal(page.querySelector('form'),null);
    for(const action of ['new-space','new-entity','delete-entity','edit-entity']) assert.equal(page.querySelector(`[data-action="${action}"]`),null);
    app.context({view:'spaces',mainGeneration:'g3'});app.renderActualSpace();
    assert.equal(atlasMounts[0].disposed,true,'switching the outer workspace disposes the previous viewer');
    assert.equal(atlasMounts.length,2);assert.deepEqual(atlasMounts[1].entities,before.entities);
    assert.deepEqual(app.runtime().db.entities,before.entities);
    assert.equal(requests.some(row=>row.method!=='GET'),false,'opening and generation navigation cannot write space records');
  },{initial});
});

test('stale spatial creation calls and removed creation actions fail before any request or modal',async()=>{
  await application(async({app,doc,requests,fixture})=>{
    const before=structuredClone(fixture());
    app.context({view:'spaces',tab:'main'});
    for(const level of ['galaxy','planet','city']) assert.throws(()=>app.newSpace(level,'legacy-galaxy'),/읽기 전용|Site에서 편집|Work/);
    for(const kind of ['space','planet']) assert.throws(()=>app.newEntity(kind),/읽기 전용|Site에서 편집|Work/);
    const stale=fragment('<button data-action="new-space" data-id="galaxy|">옛 생성 버튼</button>').querySelector('button');
    const errors=[],report=console.error;
    try { console.error=error=>errors.push(error);await click(doc,stale); }
    finally { console.error=report; }
    assert.equal(errors.length,1);assert.match(errors[0].message,/Site에서 편집|Work/);
    assert.equal(doc.querySelector('#dialog-form'),null,'stale handlers do not open an editing form');
    assert.equal(requests.some(row=>row.method!=='GET'),false);
    assert.deepEqual(fixture(),before);
  },{initial:legacyState()});
});

test('space detail references remain readonly and preserve legacy universe parents and arbitrary saved facts',async()=>{
  const initial=legacyState(),before=structuredClone(initial.entities);
  await application(async({app,requests})=>{
    for(const record of app.runtime().db.entities.filter(row=>['space','planet'].includes(row.kind))){
      const detail=fragment(app.entityDetail(record));
      assert.match(detail.textContent,/READ ONLY|읽기 전용|Work/);
      assert.equal(detail.querySelector('form'),null);assert.equal(detail.querySelector('input'),null);assert.equal(detail.querySelector('textarea'),null);
      for(const action of ['new-space','new-entity','delete-entity','edit-entity','split','merge']) assert.equal(detail.querySelector(`[data-action="${action}"]`),null);
    }
    const galaxy=app.runtime().db.entities.find(row=>row.id==='legacy-galaxy'),html=app.entityDetail(galaxy);
    assert.ok(html.includes('legacy-universe'));assert.ok(html.includes('기존 최상위 기록'));assert.ok(html.includes('&quot;keep&quot;: true'));
    assert.deepEqual(app.runtime().db.entities,before);
    assert.equal(requests.some(row=>row.method!=='GET'),false);
  },{initial});
});

test('a newly authored galaxy/planet/city chain preserves references in Atlas and the city record map',()=>{
  const entities=[
    {id:'new-galaxy',kind:'space',name:'은하',data:{subtype:'galaxy',parent_id:null}},
    {id:'new-planet',kind:'planet',name:'행성',data:{parent_id:'new-galaxy'}},
    {id:'new-city',kind:'space',name:'도시',data:{subtype:'city',parent_id:'new-planet'}},
    {id:'new-event',kind:'event',name:'도시 사건',data:{}},
  ];
  const relations=[{id:'city-event',source_id:'new-event',target_id:'new-city',type:'located_at',data:{note:'기존 연결'}}];
  const before=structuredClone({entities,relations}),nodes=adaptWorld(entities),city=nodes.find(row=>row.id==='new-city');
  assert.deepEqual(nodes.map(row=>[row.id,row.type,row.parentId]),[['new-galaxy','galaxy',null],['new-planet','planet','new-galaxy'],['new-city','city','new-planet']]);
  const model=cityData(city,{mode:'archive',entities,relations});
  assert.equal(model.demo,false);assert.equal(model.related[0].id,'city-event');assert.equal(model.related[0].objectId,'new-event');
  assert.deepEqual(model.places,[]);assert.deepEqual({entities,relations},before);
});
