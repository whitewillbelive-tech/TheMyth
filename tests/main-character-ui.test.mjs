import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CATALOG, catalogKey, catalogStatus } from '../web/main-domain.js';

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
    source=source.slice(0,boot)+'\nrender=()=>{};\n'+source.slice(boot)+`\nexport {newEntity,newCharacter,entityFields,readEntity,bindForms,refresh};export const context=value=>Object.assign(ui,value);export const runtime=()=>({db,ui,localDrafts});\n// form test ${++importNumber}`;
    const app=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    await run({app,doc,requests,storage,fixture:()=>fixture});
  }finally{for(const key of keys)if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key];}
}
const control=(form,name)=>{const item=form.elements.namedItem(name);assert.ok(item,`Missing ${name}`);return item;};
const titleCheckbox=(form,id)=>form.querySelectorAll('input[name="title_ids"]').find(item=>item.value===id);
const slot=(form,id)=>form.querySelector(`[data-new-character-slot="${id}"]`);
const panel=(form,id)=>form.querySelector(`[data-new-character-panel="${id}"]`);

test('initial missing catalog is registered once after a read, while later refreshes are read-only',async()=>{
  const initial=readyState();initial.entities=initial.entities.filter(row=>row.kind==='planet');
  await application(async({app,requests})=>{
    assert.deepEqual(requests.map(row=>[row.method,row.path]),[['GET','/api/state'],['POST','/api/catalog/reconcile'],['GET','/api/state']]);
    assert.equal(catalogStatus(app.runtime().db).initialized,true);
    await app.refresh(false);
    assert.equal(requests.filter(row=>row.method==='POST').length,1);
  },{initial});
});

test('ready catalog opens without writes and concurrent registration needs only one recovery read',async()=>{
  await application(async({requests})=>assert.deepEqual(requests.map(row=>[row.method,row.path]),[['GET','/api/state']]));
  const initial=readyState();initial.entities=[];
  await application(async({app,requests,doc})=>{
    assert.deepEqual(requests.map(row=>[row.method,row.path]),[['GET','/api/state'],['POST','/api/catalog/reconcile'],['GET','/api/state']]);
    assert.equal(catalogStatus(app.runtime().db).initialized,true);
    assert.equal(doc.querySelector('#toast').textContent,'');
  },{initial,reconcileStatus:409});
  await application(async({requests,doc})=>{
    assert.equal(requests.length,3,'a persistent conflict is not retried in a loop');
    assert.match(doc.querySelector('#toast').textContent,/자동 등록을 완료하지 못했습니다/);
  },{initial,reconcileStatus:409,concurrentReady:false});
});

test('new character uses its own optional form and submits an unfinished identity with no classification controls',async()=>{
  await application(async({app,doc,requests})=>{
    app.context({view:'character',mainTitle:''});app.newEntity();
    const form=doc.querySelector('#dialog-form');assert.ok(form);
    assert.equal(form.querySelector('select[name="kind"]'),null);
    assert.equal(control(form,'kind').type,'hidden');assert.equal(control(form,'kind').value,'character');
    for(const name of ['data_subtype','data_civilization_id','data_species'])assert.equal(form.elements.namedItem(name),null,name);
    assert.ok(form.elements.namedItem('data_origin_planet_id'));
    assert.equal(form.querySelectorAll('[required]').length,0);
    for(const item of form.elements)if(['input','textarea'].includes(item.tagName)&&item.type!=='hidden'&&item.type!=='checkbox'&&item.name!=='custom_data')item.value='';
    await form.fire('submit');
    const request=requests.find(row=>row.path==='/api/characters');assert.ok(request);
    assert.equal(request.body.name,'이름 미정');assert.equal(request.body.kind,'character');
    assert.deepEqual(request.body.title_ids,[]);assert.deepEqual(request.body.title_settings,{});
    assert.equal(request.body.description,'');assert.equal(request.body.data.role,'');assert.equal(request.body.data.notes,'');
    assert.deepEqual(request.body.data.aliases,[]);assert.equal(request.body.data.origin_planet_id,null);
    assert.equal(doc.querySelector('#dialog').open,false);
  });
});

test('creation title slots retain typed drafts across switches and submit sparse per-title values',async()=>{
  await application(async({app,doc,requests,storage})=>{
    app.context({view:'character',mainTitle:''});app.newCharacter();
    const form=doc.querySelector('#dialog-form'),a='t1-0',b='t2-0';
    titleCheckbox(form,a).checked=true;titleCheckbox(form,b).checked=true;await form.fire('change');
    assert.equal(slot(form,a).hidden,false);assert.equal(slot(form,b).hidden,false);
    assert.equal(form.querySelectorAll('input[name="title_ids"]').length,10);
    slot(form,a).onclick();assert.equal(panel(form,a).hidden,false);assert.equal(panel(form,'common').hidden,true);
    control(form,`newtitle_${a}_mode_role`).value='custom';control(form,`newtitle_${a}_mode_notes`).value='custom';await form.fire('change');
    control(form,`newtitle_${a}_profile_role`).value='Earth 역할';control(form,`newtitle_${a}_profile_notes`).value='';await form.fire('input');
    slot(form,b).onclick();control(form,`newtitle_${b}_mode_role`).value='custom';await form.fire('change');
    control(form,`newtitle_${b}_profile_role`).value='Universe 역할';await form.fire('input');
    slot(form,'common').onclick();control(form,'name').value='공통 인물';control(form,'data_role').value='공통 역할';await form.fire('input');
    slot(form,a).onclick();assert.equal(control(form,`newtitle_${a}_profile_role`).value,'Earth 역할');
    titleCheckbox(form,a).checked=false;await form.fire('change');assert.equal(panel(form,'common').hidden,false);
    titleCheckbox(form,a).checked=true;await form.fire('change');slot(form,a).onclick();
    assert.equal(control(form,`newtitle_${a}_profile_role`).value,'Earth 역할','temporarily unchecked slots retain content');
    assert.deepEqual(JSON.parse(storage.get('myth-drafts'))['new:character'].title_ids,[a,b]);
    await form.fire('submit');
    const body=requests.find(row=>row.path==='/api/characters').body;
    assert.equal(body.data.role,'공통 역할');assert.deepEqual(body.title_ids,[a,b]);
    assert.deepEqual(body.title_settings[a].overrides,{role:'Earth 역할',notes:''});
    assert.deepEqual(body.title_settings[b].overrides,{role:'Universe 역할'});
    assert.ok(body.title_settings[a].inherit_fields.includes('name'));
    assert.equal(Object.hasOwn(body.title_settings[a].overrides,'name'),false);
    assert.equal(storage.get('myth-drafts'),'{}','successful creation clears its local draft');
  });
});

test('each creation context fixes its record kind instead of exposing a generic classification picker',async()=>{
  await application(async({app,doc})=>{
    for(const [view,kind] of [['organization','organization'],['civilization','civilization'],['event','event'],['setting','setting'],['spaces','space']]){
      app.context({view});app.newEntity();const form=doc.querySelector('#dialog-form');
      assert.equal(control(form,'kind').value,kind,view);assert.equal(control(form,'kind').type,'hidden',view);
      assert.equal(form.querySelector('select[name="kind"]'),null,view);
    }
  });
});

test('editing the simplified character form preserves hidden legacy origin and subtype values',async()=>{
  const initial=readyState(),legacy={id:'legacy-person',kind:'character',name:'기존 인물',revision:7,data:{origin_planet_id:'planet',civilization_id:'legacy-civilization',species:'기존 종족',subtype:'기존 세부 분류',extension:{keep:true}}};
  initial.entities.push(legacy,{id:'legacy-civilization',kind:'civilization',name:'기존 문명',data:{}});
  await application(async({app,doc,requests})=>{
    doc.querySelector('#app').innerHTML=`<form id="entity-form" data-id="${legacy.id}">${app.entityFields(legacy)}</form>`;
    const form=doc.querySelector('#entity-form');
    for(const name of ['data_civilization_id','data_species','data_subtype'])assert.equal(form.elements.namedItem(name),null);
    control(form,'description').value='수정한 설명';app.bindForms();await form.fire('submit');
    const body=requests.find(row=>row.method==='PATCH').body;
    assert.equal(body.revision,7);assert.equal(body.data.origin_planet_id,'planet');
    assert.equal(body.data.civilization_id,'legacy-civilization');assert.equal(body.data.species,'기존 종족');assert.equal(body.data.subtype,'기존 세부 분류');
    assert.deepEqual(body.data.extension,{keep:true});assert.equal(body.description,'수정한 설명');
  },{initial});
});
