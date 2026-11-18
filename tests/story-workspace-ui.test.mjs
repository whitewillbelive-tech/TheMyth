import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountStoryWorkspace, searchStoryCharacters, renderWorkProfile, profileFormValues, storyMaterials, fieldComparison } from '../web/story-workspace.js';
import { handleApi } from '../sites/api.js';
import { Fixture } from './d1-test-helper.mjs';

// Parsed DOM fixture for the real production event handlers. Layout, WebGL and
// authentication are deliberately outside this test's claims.
const decode=s=>String(s).replace(/&(amp|lt|gt|quot|#39);/g,(_,c)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[c]);
class Element {
  constructor(tag='div',attrs={},parent=null){this.tagName=tag;this.attrs=attrs;this.parent=parent;this.children=[];this.disabled='disabled'in attrs;this.checked='checked'in attrs;this.selected='selected'in attrs;this.dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));}
  get name(){return this.attrs.name||'';}get type(){return this.attrs.type||'text';}get id(){return this.attrs.id||'';}
  get textContent(){return this.children.map(c=>typeof c==='string'?c:c.textContent).join('');}set textContent(v){this.children=[String(v)];}
  get value(){if(this.tagName==='select')return(this.querySelectorAll('option').find(c=>c.selected)||this.querySelector('option'))?.value||'';return this._value??(this.tagName==='textarea'?this.textContent:this.attrs.value||'');}
  set value(v){this._value=String(v);if(this.tagName==='select')for(const c of this.querySelectorAll('option'))c.selected=c.value===this._value;}
  get elements(){const all=this.querySelectorAll('input,select,textarea,button');all.namedItem=name=>all.find(c=>c.name===name);return all;}
  set innerHTML(html){this.html=html;this.children=[];const stack=[this];for(const m of html.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/gi)){if(m[3]!==undefined){stack.at(-1).children.push(decode(m[3]));continue;}if(m[0].startsWith('</')){if(stack.length>1)stack.pop();continue;}const attrs={};for(const [,name,,quoted,bare]of m[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:(["'])(.*?)\2|([^\s]+)))?/g))attrs[name]=decode(quoted??bare??'');const child=new Element(m[1],attrs,stack.at(-1));stack.at(-1).children.push(child);if(!['input','br','hr','img'].includes(m[1]))stack.push(child);}}
  get innerHTML(){return this.html||'';}
  contains(node){for(let n=node;n;n=n.parent)if(n===this)return true;return false;}
  closest(selector){for(let n=this;n;n=n.parent)if(match(n,selector))return n;return null;}
  querySelectorAll(selector){const all=[];const visit=node=>{for(const c of node.children)if(typeof c!=='string'){all.push(c);visit(c);}};visit(this);return all.filter(n=>selector.split(',').some(s=>match(n,s.trim())));}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}focus(){}setSelectionRange(){}scrollIntoView(){}
}
function match(node,selector){const parts=selector.split(/\s+/),simple=parts.pop();if(!simpleMatch(node,simple))return false;if(!parts.length)return true;for(let p=node.parent;p;p=p.parent)if(match(p,parts.join(' ')))return true;return false;}
function simpleMatch(node,s){const tag=s.match(/^[a-z][\w-]*/i)?.[0];if(tag&&tag!==node.tagName)return false;const id=s.match(/#([\w-]+)/)?.[1];if(id&&node.id!==id)return false;for(const[,c]of s.matchAll(/\.([\w-]+)/g))if(!(node.attrs.class||'').split(/\s+/).includes(c))return false;for(const[,key,op,,value]of s.matchAll(/\[([^=\]^]+)(?:(\^?=)(["']?)(.*?)\3)?\]/g)){if(!(key in node.attrs))return false;if(op==='='&&node.attrs[key]!==value)return false;if(op==='^='&&!node.attrs[key].startsWith(value))return false;}return true;}
class FormDataFixture {
  constructor(form){this.list=[];for(const c of form.elements){if(!c.name||c.disabled||['submit','button'].includes(c.type)||['checkbox','radio'].includes(c.type)&&!c.checked)continue;this.list.push([c.name,c.value]);}}
  entries(){return this.list.values();}get(name){return this.list.find(([k])=>k===name)?.[1]??null;}getAll(name){return this.list.filter(([k])=>k===name).map(([,v])=>v);}
}
const control=(form,name)=>{const c=form.elements.namedItem(name);assert.ok(c,`Missing ${name}`);return c;};
async function click(root,action,id=null){const b=root.querySelectorAll('[data-story-action]').find(b=>b.dataset.storyAction===action&&(id===null||b.dataset.storyId===id));assert.ok(b,`Missing ${action} ${id}`);let prevented=false;await root.onclick({type:'click',target:b,preventDefault(){prevented=true;}});return prevented;}
async function submit(form){let prevented=false;await form.onsubmit({type:'submit',target:form,preventDefault(){prevented=true;}});assert.ok(prevented);}
function input(form,name,value){const c=control(form,name);c.value=value;form.oninput?.({target:c,type:'input'});return c;}
async function scenario(run){const f=new Fixture(handleApi),previous=globalThis.FormData;globalThis.FormData=FormDataFixture;try{await run(f);}finally{f.close();globalThis.FormData=previous;}}
async function transport(f,path,method='GET',body){const r=await f.response(method,'/api'+path,body),d=await r.json();if(!r.ok)throw Object.assign(Error(typeof d.detail==='string'?d.detail:JSON.stringify(d.detail)),{status:r.status});return d;}
async function workspace(f,{drafts={},work=null}={}){work ||= await f.create('documents',{kind:'story',name:'시간',data:{provisional_title:true,story_workspace:true,overview:'원본 개요'}});let state=await f.state();const root=new Element(),errors=[],ctx={document:work,getState:()=>state,api:(...a)=>transport(f,...a),drafts,persistDrafts(){},onChanged:async()=>{state=await f.state();},onError:e=>errors.push(e),onStatus(){},confirm:()=>true};return{root,work,drafts,errors,ctx,mount:()=>mountStoryWorkspace(root,ctx),reload:async()=>{state=await f.state();}};}

test('work-local search distinguishes Knight/Night and Ternos/Tera while matching honor, English, aliases and occupation',()=>{
  const make=(id,name,english,occupation)=>({id,kind:'character',name,data:{english_name:english,aliases:id==='k'?['검술의 나이트']:[],occupation,generation_model_version:1}});
  const entities=[make('k','나이트','Knight','검술 계승자'),make('n','나이트','Night','살인 청부업자'),make('t1','테르노스','Ternos','진리 사상가'),make('t2','테라','Tera','차원 사상가'),make('main-only','본편 전용','Only','')];
  for(const letter of ['K','N','T'])entities.push({id:'honor-'+letter,kind:'custom',name:letter,data:{classification:'honor',honor_letter:letter}});
  const letters={k:'K',n:'N',t1:'T',t2:'T'};
  const relations=Object.entries(letters).flatMap(([id,letter])=>[{id:'appearance-'+id,type:'work_appearance',source_id:id,target_id:'work',data:{overrides:{}}},{id:'honor-assignment-'+id,type:'honor_assignment',source_id:id,target_id:'honor-'+letter,data:{work_id:'work'}}]);
  const state={entities,relations,documents:[{id:'work',kind:'story',name:'시간'}]};
  assert.equal(searchStoryCharacters(state,'work').length,4);
  assert.deepEqual(searchStoryCharacters(state,'work','나이트').map(p=>p.local.id),['k','n']);
  assert.deepEqual(searchStoryCharacters(state,'work','Knight').map(p=>p.local.id),['k']);
  assert.deepEqual(searchStoryCharacters(state,'work','검술의 나이트').map(p=>p.local.id),['k']);
  assert.deepEqual(searchStoryCharacters(state,'work','청부업자').map(p=>p.local.id),['n']);
  assert.equal(searchStoryCharacters(state,'work','T').filter(p=>p.letters.includes('T')).length,2);
});

test('profile controls preserve an explicit empty override, inherited fields, notes and unknown time without fabricating values',()=>{
  const old=globalThis.FormData;globalThis.FormData=FormDataFixture;
  try{const root=new Element();root.innerHTML=renderWorkProfile({values:{name:'공통 이름',description:'기본 설명',time:{mode:'unknown'}},common:{name:'공통 이름'},overrides:{description:''},override_notes:{description:'해당 작품에서는 비움'}});const form=root.querySelector('form');
    control(form,'mode_time').value='override';control(form,'time_mode').value='unknown';
    const payload=profileFormValues(form);assert.equal(payload.overrides.description,'');assert.equal(payload.override_notes.description,'해당 작품에서는 비움');assert.deepEqual(payload.overrides.time,{mode:'unknown'});assert.ok(payload.inherit_fields.includes('name'));assert.ok(!Object.hasOwn(payload.overrides,'name'));
    control(form,'mode_description').value='common';const reset=profileFormValues(form);assert.ok(reset.inherit_fields.includes('description'));assert.ok(!Object.hasOwn(reset.overrides,'description'));
  }finally{globalThis.FormData=old;}
});

test('overview drafts retain their original revision across remount, block stale overwrite and explicitly compare before reapply',()=>scenario(async f=>{
  const ui=await workspace(f),first=ui.mount(),form=ui.root.querySelector('[data-story-form="overview"]');input(form,'overview','내 보관 초안');
  assert.equal(ui.drafts[`story-workspace:${ui.work.id}:overview:overview`].bases.overview.revision,ui.work.revision);
  await f.update('documents',ui.work,{revision:ui.work.revision,data:{...ui.work.data,overview:'다른 화면의 최신 내용'}});await ui.reload();first.dispose();ui.mount();
  assert.match(ui.root.textContent,/다른 화면의 최신 내용/);assert.match(ui.root.textContent,/내 보관 초안/);
  await submit(ui.root.querySelector('[data-story-form="overview"]'));
  assert.equal((await f.record('documents',ui.work.id)).data.overview,'다른 화면의 최신 내용');assert.ok(ui.errors.length>0);
  ui.root.querySelector('[data-story-confirm]').checked=true;await click(ui.root,'reapply');
  assert.equal((await f.record('documents',ui.work.id)).data.overview,'내 보관 초안');assert.ok(!Object.keys(ui.drafts).length);
}));

test('character common drafts retain the edit envelope across refresh and do not silently replace newer common values',()=>scenario(async f=>{
  const ui=await workspace(f),context=await transport(f,`/works/${ui.work.id}/context`),p=await transport(f,`/works/${ui.work.id}/characters`,'POST',{expected_write_revision:context.expected_write_revision,revisions:context.revisions,common:{name:'원래 이름'}});await ui.reload();let mount=ui.mount();await click(ui.root,'section','characters');await click(ui.root,'character',p.local.id);
  const form=ui.root.querySelector('[data-story-form="common"]');input(form,'name','내 초안 이름');
  const latest=await transport(f,`/work-characters/${p.local.id}/${ui.work.id}`);await transport(f,`/work-characters/${p.local.id}/${ui.work.id}/common`,'PATCH',{expected_write_revision:latest.expected_write_revision,revisions:latest.revisions,fields:{name:'다른 화면 이름'}});
  await ui.reload();mount.dispose();mount=ui.mount();await click(ui.root,'section','characters');await click(ui.root,'character',p.local.id);
  assert.match(ui.root.textContent,/다른 화면 이름/);assert.match(ui.root.textContent,/내 초안 이름/);await submit(ui.root.querySelector('[data-story-form="common"]'));
  assert.equal((await f.record('entities',p.local.id)).name,'다른 화면 이름');
  ui.root.querySelector('[data-story-confirm]').checked=true;await click(ui.root,'reapply');assert.equal((await f.record('entities',p.local.id)).name,'내 초안 이름');
}));

test('material scope includes only this work and comparisons escape prose safely',()=>{
  const state={entities:[{id:'a',kind:'thought',name:'확정 사상',data:{work_id:'one',section:'ideas'}},{id:'b',kind:'custom',name:'참고 담론',data:{work_id:'one',section:'research'}},{id:'c',kind:'thought',name:'다른 작품',data:{work_id:'two',section:'ideas'}},{id:'d',kind:'thought',name:'삭제한 연구',deleted_at:'deleted',data:{work_id:'one',section:'research'}}]};
  assert.deepEqual(new Set(storyMaterials(state,'one','ideas').map(r=>r.id)),new Set(['a','b']));
  const html=fieldComparison([{key:'description',label:'설명'}],{description:'<script>unsafe</script>'},{description:'확인된 한국어'});assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/확인된 한국어/);
});


test('stale promotion compares current common and work values then reapplies the originally selected fields only',()=>scenario(async f=>{
  const ui=await workspace(f),context=await transport(f,`/works/${ui.work.id}/context`),p=await transport(f,`/works/${ui.work.id}/characters`,'POST',{expected_write_revision:context.expected_write_revision,revisions:context.revisions,common:{name:'원래 공통 이름',description:'보존할 공통 설명'},overrides:{name:'외전의 이름',description:'공통으로 올리지 않을 작품 설명'}});
  const event=await f.create('entities',{kind:'event',name:'연결 사건',data:{work_id:ui.work.id,section:'events'}});await f.relation(p.local,event,'participates',{data:{work_id:ui.work.id,label:'등장'}});
  await ui.reload();ui.mount();await click(ui.root,'section','characters');await click(ui.root,'character',p.local.id);
  assert.match(ui.root.querySelector('.story-relation').textContent,/외전의 이름/,'relation labels use the resolved work name');
  const promote=ui.root.querySelector('[data-story-form="promote"]');const chosen=promote.querySelectorAll('input[name="promote_fields"]').find(c=>c.value==='name');chosen.checked=true;await submit(promote);
  const latest=await transport(f,`/work-characters/${p.local.id}/${ui.work.id}`);await transport(f,`/work-characters/${p.local.id}/${ui.work.id}/common`,'PATCH',{expected_write_revision:latest.expected_write_revision,revisions:latest.revisions,fields:{name:'다른 화면의 공통 이름',description:'다른 화면의 공통 설명'}});
  ui.root.querySelector('[data-story-confirm]').checked=true;await click(ui.root,'apply-promote');
  assert.match(ui.root.querySelector('.story-conflict').textContent,/다른 화면의 공통 이름/);assert.match(ui.root.querySelector('.story-conflict').textContent,/외전의 이름/);
  assert.equal((await f.record('entities',p.local.id)).name,'다른 화면의 공통 이름','stale promotion made no write');
  await click(ui.root,'reapply');assert.equal((await f.record('entities',p.local.id)).name,'다른 화면의 공통 이름','unchecked comparison cannot reapply');
  ui.root.querySelector('[data-story-confirm]').checked=true;await click(ui.root,'reapply');
  const saved=await transport(f,`/work-characters/${p.local.id}/${ui.work.id}`);assert.equal(saved.common.name,'외전의 이름');assert.equal(saved.common.description,'다른 화면의 공통 설명','unselected fields preserve the newest common edit');assert.equal(saved.overrides.name,undefined);assert.equal(saved.values.description,'공통으로 올리지 않을 작품 설명');assert.ok(!ui.root.querySelector('.story-conflict'));
}));

test('opening a linked main character from another generation selects the global character view instead of an unrelated last-used filter',async()=>{
  const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8'),start=source.indexOf('openEntity:async id=>{'),end=source.indexOf('},openStory:async id=>',start);assert.ok(start>0&&end>start,'real story openEntity callback must be available');
  const body=source.slice(start+'openEntity:async id=>{'.length,end),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const ui={tab:'writing',view:'story',selected:'work',mainGeneration:'earth',mainTitle:'earth-title'},target={id:'universe-character',kind:'character',name:'다른 세대 인물'},calls=[];
  await new AsyncFunction('id','deps',`const {ui,db,lookup,flushBeforeNavigation,setMainContext,contextForEntity,mainContext,render}=deps;${body}`)(target.id,{ui,db:{},lookup:()=>target,flushBeforeNavigation:async()=>{},setMainContext:()=>{},contextForEntity:()=>({generationId:'earth'}),mainContext:()=>({generationId:'earth'}),render:()=>calls.push('render')});
  assert.equal(ui.tab,'main');assert.equal(ui.view,'all-characters');assert.equal(ui.selected,target.id);assert.deepEqual(calls,['render']);
});
