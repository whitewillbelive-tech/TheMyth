import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CATALOG, catalogKey } from '../web/main-domain.js';
import { adaptWorld, childrenFor } from '../web/atlas-data.js';
import { cityData } from '../web/atlas-city-map.js';

// Execute the production modal/read/submit handlers with parsed form controls.
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
  const keys=['document','window','localStorage','fetch','FormData','setTimeout','clearTimeout'];
  const old=Object.fromEntries(keys.map(key=>[key,globalThis[key]])),doc=new Document(),storage=new Map(),requests=[];
  let fixture=structuredClone(initial);
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
    source=source.replace('"/atlas-view.js"',JSON.stringify('data:text/javascript,export const mountAtlas=()=>()=>{};'))
      .replace('"/main-domain.js"',JSON.stringify(new URL('../web/main-domain.js',import.meta.url).href))
      .replace('"/main-view-model.js"',JSON.stringify(new URL('../web/main-view-model.js',import.meta.url).href));
    const boot=source.lastIndexOf('\ntry {\n  await refresh');assert.ok(boot>0,'Application bootstrap must be present');
    // Rendering has separate navigation coverage. Keep bootstrap and actual
    // dialogs untouched while suppressing layout work in this form fixture.
    source=source.slice(0,boot)+'\nrender=()=>{};\n'+source.slice(boot)+`\nexport {newSpace,newEntity,entityFields,readEntity,bindForms,refresh,archive,shell,spaceTree,baseEntityDetail};export const context=value=>Object.assign(ui,value);export const runtime=()=>({db,ui,localDrafts});\n// spatial form test ${++importNumber}`;
    const app=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    await run({app,doc,requests,storage,fixture:()=>fixture});
  }finally{for(const key of keys)if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key];}
}
const control=(form,name)=>{const item=form.elements.namedItem(name);assert.ok(item,`Missing ${name}`);return item;};
const fragment=html=>{const root=new Node();root.innerHTML=html;return root;};
async function click(doc,node){assert.ok(node,'Missing action button');for(const handler of doc.events.click||[])await handler({target:node,preventDefault(){}});}
const action=(html,id)=>fragment(html).querySelector(`[data-action="new-space"][data-id="${id}"]`);
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

test('space navigation exposes the galaxy hierarchy and hides only the legacy universe container without rewriting it',async()=>{
  const initial=legacyState(),before=structuredClone(initial);
  await application(async({app,requests})=>{
    app.context({view:'spaces',tab:'main',mainTitle:'',includeCommon:true,query:'',kind:'',group:''});
    const shell=fragment(app.shell());
    assert.ok(shell.querySelector('[data-action="view"][data-id="spaces"]'));
    assert.equal(shell.querySelector('[data-action="view"][data-id="spaces"]').textContent,'공간');
    assert.equal(app.shell().includes('우주 공간'),false);
    const html=app.archive();
    const tree=fragment(html);
    assert.equal(tree.querySelector('[data-action="select"][data-id="legacy-universe"]'),null);
    for(const id of ['legacy-galaxy','legacy-planet','legacy-city'])assert.ok(tree.querySelector(`[data-action="select"][data-id="${id}"]`));
    assert.equal(tree.querySelector('[data-action="select"][data-id="legacy-galaxy"]').attrs.style,'padding-left:20px');
    assert.equal(tree.querySelector('[data-action="select"][data-id="legacy-city"]').attrs.style,'padding-left:52px');
    assert.ok(action(html,'planet|legacy-galaxy'));assert.ok(action(html,'city|legacy-planet'));
    assert.ok(action(app.archive(),'galaxy|'));
    assert.ok(action(app.baseEntityDetail(app.runtime().db.entities.find(row=>row.id==='legacy-galaxy')),'planet|legacy-galaxy'));
    assert.ok(action(app.baseEntityDetail(app.runtime().db.entities.find(row=>row.id==='legacy-planet')),'city|legacy-planet'));
    assert.deepEqual(app.runtime().db.entities,before.entities);
    assert.equal(requests.some(row=>row.method!=='GET'),false,'projecting the spatial hierarchy cannot modify records');
  },{initial});
});

test('actual contextual create actions persist one galaxy, its planet and its city with Atlas-compatible identities',async()=>{
  const initial=legacyState(),before=structuredClone(initial.entities);
  await application(async({app,doc,requests,fixture})=>{
    app.context({view:'spaces',tab:'main',mainTitle:'',includeCommon:true,query:'',kind:'',group:''});
    await click(doc,action(app.archive(),'galaxy|'));
    let form=doc.querySelector('#dialog-form');
    assert.match(form.textContent,/새 은하/);control(form,'name').value='새 은하';
    assert.equal(form.querySelector('select[name="kind"]'),null);
    await form.fire('submit');
    const galaxy=fixture().entities.find(row=>row.name==='새 은하');assert.ok(galaxy);
    assert.equal(galaxy.kind,'space');assert.equal(galaxy.data.subtype,'galaxy');assert.equal(galaxy.data.parent_id,null);
    await click(doc,action(app.spaceTree(app.runtime().db.entities.filter(row=>['space','planet'].includes(row.kind))),`planet|${galaxy.id}`));
    form=doc.querySelector('#dialog-form');assert.match(form.textContent,/새 행성/);
    const parent=control(form,'data_parent_id');
    assert.equal(parent.value,galaxy.id);assert.ok(parent.options.some(row=>row.value==='legacy-galaxy'));
    assert.equal(parent.options.some(row=>['legacy-universe','legacy-planet','legacy-city'].includes(row.value)),false);
    control(form,'name').value='새 행성';await form.fire('submit');
    const planet=fixture().entities.find(row=>row.name==='새 행성');assert.ok(planet);
    assert.equal(planet.kind,'planet');assert.equal(planet.data.parent_id,galaxy.id);
    await click(doc,action(app.baseEntityDetail(planet),`city|${planet.id}`));
    form=doc.querySelector('#dialog-form');assert.match(form.textContent,/새 도시/);
    assert.equal(control(form,'data_parent_id').value,planet.id);
    assert.equal(control(form,'data_parent_id').options.some(row=>['legacy-universe','legacy-galaxy','legacy-city',galaxy.id].includes(row.value)),false);
    control(form,'name').value='새 도시';await form.fire('submit');
    const city=fixture().entities.find(row=>row.name==='새 도시');assert.ok(city);
    assert.equal(city.kind,'space');assert.equal(city.data.subtype,'city');assert.equal(city.data.parent_id,planet.id);
    const writes=requests.filter(row=>row.path==='/api/entities'&&row.method==='POST');assert.equal(writes.length,3);
    assert.equal(writes.some(row=>row.body.data.subtype==='universe'),false);
    for(const old of before)assert.deepEqual(fixture().entities.find(row=>row.id===old.id),old);
    const snapshot=structuredClone(fixture().entities),nodes=adaptWorld(fixture().entities);
    assert.equal(nodes.find(row=>row.id===galaxy.id).type,'galaxy');
    assert.equal(childrenFor(nodes,galaxy.id).find(row=>row.id===planet.id).type,'planet');
    assert.equal(childrenFor(nodes,planet.id).find(row=>row.id===city.id).type,'city');
    assert.deepEqual(fixture().entities,snapshot);
    assert.ok(nodes.every(row=>row.coords===null),'creation must not invent map coordinates');
  },{initial});
});

test('legacy universe-parented galaxies retain their stored parent when edited through the simplified form',async()=>{
  const initial=legacyState(),galaxy=initial.entities.find(row=>row.id==='legacy-galaxy');
  await application(async({app,doc,requests})=>{
    doc.querySelector('#app').innerHTML=`<form id="entity-form" data-id="${galaxy.id}">${app.entityFields(galaxy)}</form>`;
    const form=doc.querySelector('#entity-form');
    assert.equal(form.querySelector('select[name="kind"]'),null);
    if(form.elements.namedItem('data_parent_id'))assert.equal(control(form,'data_parent_id').value,'legacy-universe');
    control(form,'description').value='은하 설명만 수정';app.bindForms();await form.fire('submit');
    const body=requests.find(row=>row.method==='PATCH').body;
    assert.equal(body.data.parent_id,'legacy-universe');assert.equal(body.data.subtype,'은하');
    assert.deepEqual(body.data.extension,{keep:true});assert.equal(body.description,'은하 설명만 수정');
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
