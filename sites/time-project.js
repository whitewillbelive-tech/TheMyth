import { TIME_SOURCE, TIME_LIBRARY_SOURCES, TIME_OVERVIEW, TIME_CHARACTERS, TIME_WORLD, TIME_EVENTS, TIME_RELATIONSHIPS, TIME_IDEAS, TIME_REVIEWS } from './time-canon.js';

const KEY = 'time:work:v1';
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a,b) => a===b || Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i])) || object(a)&&object(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
const fail = (detail,status=422) => { throw Object.assign(new Error(typeof detail==='string'?detail:JSON.stringify(detail)),{detail,status}); };
const active = record => record && !record.deleted_at;
const empty = value => value===undefined || value===null || value==='' || Array.isArray(value)&&!value.length;
const get = (value,path) => path.reduce((part,key)=>part?.[key],value);
const set = (value,path,next) => {let node=value;for(const key of path.slice(0,-1)){if(!object(node[key]))node[key]={};node=node[key];}node[path.at(-1)]=clone(next);};
function leaves(value,path=[],result=[]) {
  if(object(value)&&Object.keys(value).length) for(const [key,part] of Object.entries(value)) leaves(part,[...path,key],result);
  else result.push({path,value:clone(value)});
  return result;
}
function keyRecords(store,collection,key) { return store.all(collection).filter(row=>row.data?.import_key===key); }
function locateWork(store) {
  const keyed=keyRecords(store,'documents',KEY);
  if(keyed.length>1)fail('《시간》의 입력 식별자가 중복되어 있습니다. 기존 기록을 보존하고 수동 확인이 필요합니다.',409);
  if(keyed.length) {
    if(keyed[0].kind!=='story')fail('《시간》 입력 식별자가 다른 종류의 자료에 사용되고 있습니다.',409);
    if(keyed[0].deleted_at)fail('기존 《시간》 외전이 휴지통에 있습니다. 자동 복원하거나 새 기록을 만들지 않습니다.',409);
    return keyed[0];
  }
  const named=store.all('documents').filter(row=>row.kind==='story'&&['시간','時間'].includes(String(row.name??'').normalize('NFC').trim()));
  if(named.length>1)fail('동일한 제목의 외전이 여러 개 있습니다. 어느 기록을 사용할지 확인해야 합니다.',409);
  if(named.length&&named[0].deleted_at)fail('동일한 제목의 기존 외전이 휴지통에 있습니다. 자동 복원하지 않습니다.',409);
  return named[0]??null;
}
function canonicalData(workId,section,extra={}) {
  return {work_id:workId,section,certainty:'user_confirmed',disclosure:'public',source:clone(TIME_SOURCE),...extra};
}
function summary(store,work) {
  if(!work)return {characters:0,honors:0,honor_assignments:0,events:0,core_relationships:0,event_participations:0,ideas:0,world_rules:0,review:0,research_discourses:0};
  const owned=store.all('entities').filter(row=>active(row)&&row.data?.work_id===work.id);
  const relations=store.all('relations').filter(row=>active(row)&&row.data?.work_id===work.id);
  const localIds=new Set(store.all('relations').filter(row=>active(row)&&row.type==='work_appearance'&&row.target_id===work.id).map(row=>row.source_id));
  return {characters:store.all('entities').filter(row=>active(row)&&row.kind==='character'&&localIds.has(row.id)).length,
    honors:owned.filter(row=>row.data?.classification==='honor').length,
    honor_assignments:relations.filter(row=>row.type==='honor_assignment').length,
    events:owned.filter(row=>row.kind==='event'&&row.data?.section==='events').length,
    core_relationships:relations.filter(row=>row.data?.core_relationship===true).length,
    event_participations:relations.filter(row=>row.type==='participates'&&row.data?.section==='events').length,
    ideas:owned.filter(row=>row.kind==='thought'&&row.data?.section==='ideas').length,
    world_rules:owned.filter(row=>row.data?.section==='world').length,
    review:owned.filter(row=>row.data?.section==='review').length,
    research_discourses:owned.filter(row=>row.data?.section==='research'&&row.data?.discourse_number!=null).length};
}
export function timeProjectStatus(store) {
  const work=locateWork(store);
  return {work,counts:summary(store,work),expected_write_revision:store.revision,write_revision:store.revision,
    source_gaps:clone(TIME_LIBRARY_SOURCES),research_expected:{categories:14,items:120,verified_items:0,status:'unverified_source_unavailable'}};
}

/** Explicit, in-memory additive import. The HTTP caller commits exactly once. */
export function importTimeProject(store,payload={}) {
  if(typeof payload.expected_write_revision!=='string')fail('최신 저장 상태를 확인한 뒤 입력하세요. 저장 revision이 필요합니다.');
  if(payload.expected_write_revision!==store.revision)fail('다른 창에서 변경되었습니다. 최신 내용을 확인한 뒤 다시 입력하세요.',409);
  const priorWork=locateWork(store);
  const report={created:{documents:0,entities:0,relations:0},reused:{documents:0,entities:0,relations:0},updated:{documents:0,entities:0,relations:0},conflicts:[],skipped_deleted:[],source_gaps:clone(TIME_LIBRARY_SOURCES),character_reuse:{existing_reused:0,newly_created:0},write_revision:store.revision};
  function upsert(collection,key,desired,{adopt=null}={}) {
    const matches=keyRecords(store,collection,key);
    if(matches.length>1)fail({message:'입력 식별자가 중복되어 있습니다. 변경을 저장하지 않습니다.',collection,key},409);
    const existing=matches[0]??adopt;
    if(existing?.deleted_at) {
      report.skipped_deleted.push({collection,id:existing.id,name:existing.name??'',key});
      return existing;
    }
    const wanted={...clone(desired),data:{...clone(desired.data??{}),import_key:key}};
    const paths=leaves(wanted);
    if(!existing) {
      wanted.data.import_baseline=paths;
      wanted.data.import_batch='time:user:2026-11-18';
      const record=store.create(collection,wanted);report.created[collection]++;
      return record;
    }
    if(existing.kind&&wanted.kind&&existing.kind!==wanted.kind)fail('입력 자료의 기존 종류가 다릅니다. 기존 기록을 보존합니다.',409);
    report.reused[collection]++;
    const next=clone(existing),baseline=Array.isArray(existing.data?.import_baseline)?clone(existing.data.import_baseline):[];
    const history=new Map(baseline.filter(entry=>Array.isArray(entry.path)).map(entry=>[JSON.stringify(entry.path),entry]));
    for(const entry of paths) {
      const token=JSON.stringify(entry.path),previous=history.get(token),current=get(existing,entry.path);
      if(equal(current,entry.value)) { history.set(token,entry);continue; }
      const mayFill=previous?equal(current,previous.value):empty(current);
      if(mayFill) {set(next,entry.path,entry.value);history.set(token,entry);}
      else {
        // A user-edited field stays untouched. Its previous import baseline
        // remains available for a future explicit conflict resolution.
        report.conflicts.push({collection,id:existing.id,name:existing.name??'',field:entry.path.join('.'),current:clone(current),proposed:clone(entry.value),resolution:'preserved_user_value'});
        if(!previous)history.set(token,entry);
      }
    }
    next.data??={};next.data.import_key=key;next.data.import_baseline=[...history.values()];
    next.data.import_batch??='time:user:2026-11-18';
    if(!equal(next,existing)) {const saved=store.update(collection,existing.id,{...next,revision:existing.revision},'《시간》 확정 설정 갱신 전');report.updated[collection]++;return saved;}
    return existing;
  }
  const work=upsert('documents',KEY,{kind:'story',name:'시간',description:'《The Myth》 외전 단편 · 가제',data:{story_workspace:true,provisional_title:true,form:'외전 단편',project_name:'The Myth',overview:TIME_OVERVIEW,generation_id:null,time:{mode:'unknown'},region:'미정',certainty:'user_confirmed',disclosure:'public',source:clone(TIME_SOURCE)}},{adopt:priorWork});
  const people=new Map(),honors=new Map();
  for(const [index,person] of TIME_CHARACTERS.entries()) {
    const key='time:character:'+person.en.toLowerCase(),existing=keyRecords(store,'entities',key)[0];
    const character=upsert('entities',key,{kind:'character',name:person.ko,description:'',sort_order:index,data:{english_name:person.en,aliases:[],generation_model_version:1,source:clone(TIME_SOURCE)}});
    people.set(person.en,character);
    if(active(character)) { if(existing)report.character_reuse.existing_reused++;else report.character_reuse.newly_created++; }
    if(!active(character))continue;
    const overrides={role:person.role??'',occupation:person.occupation,goals:person.goals??'',activities:person.activities??'',condition:person.condition??'',ideology:person.ideology??'',notes:person.notes??'',time:{mode:'unknown'}};
    if(person.description)overrides.description=person.description;
    upsert('relations','time:appearance:'+person.en.toLowerCase(),{source_id:character.id,target_id:work.id,type:'work_appearance',data:{...canonicalData(work.id,'characters'),profile_schema:1,overrides,inherit_fields:[],override_notes:{}}});
  }
  for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const honor=upsert('entities','time:honor:'+letter,{kind:'custom',name:letter+' · 알파벳 칭호',description:letter+' 알파벳 칭호. 인물의 정체성이나 고정된 직업 분류와 별개로 관리한다. 시점과 구체적인 수여 업적은 미정이다.',sort_order:letter.charCodeAt(0)-65,data:{...canonicalData(work.id,'honors'),classification:'honor',honor_letter:letter,time:{mode:'unknown'}}});
    honors.set(letter,honor);
  }
  for(const person of TIME_CHARACTERS) {
    const character=people.get(person.en),honor=honors.get(person.letter);
    if(!active(character)||!active(honor))continue;
    upsert('relations','time:honor-assignment:'+person.en.toLowerCase(),{source_id:character.id,target_id:honor.id,type:'honor_assignment',data:{...canonicalData(work.id,'honors'),honor_letter:person.letter,status:person.honorStatus??'placement_confirmed',time:{mode:'unknown'},note:person.en==='Tera'?'T와 연결되지만 칭호 취득 시점·과정과 작품 시작 시점의 보유 여부는 미정이다.':'명단상 칭호 연결은 확정이며 구체적인 보유 시점·수여 업적은 미정이다.'}});
  }
  for(const [index,rule] of TIME_WORLD.entries()) upsert('entities','time:world:'+rule.key,{kind:'setting',name:rule.name,description:rule.text,sort_order:index,data:canonicalData(work.id,'world')});
  const events=new Map();
  for(const [index,event] of TIME_EVENTS.entries()) {
    const record=upsert('entities','time:event:'+event.key,{kind:'event',name:event.name,description:event.text,sort_order:index,data:canonicalData(work.id,'events',{phase:event.phase,time:{mode:'unknown'},disclosure:event.disclosure??'public',knowledge_scope:'author_truth',sequence_is_canonical:false})});
    events.set(event.key,record);
    if(!active(record))continue;
    for(const name of event.people) {
      const character=people.get(name);if(!active(character))continue;
      upsert('relations','time:event-person:'+event.key+':'+name.toLowerCase(),{source_id:character.id,target_id:record.id,type:'participates',data:canonicalData(work.id,'events',{label:'사건 관련 인물',knowledge_scope:'author_truth'})});
    }
  }
  for(const relationship of TIME_RELATIONSHIPS) {
    const source=people.get(relationship.from),target=people.get(relationship.to);
    if(!active(source)||!active(target))continue;
    upsert('relations','time:relationship:'+relationship.key,{source_id:source.id,target_id:target.id,type:relationship.type,data:canonicalData(work.id,'events',{core_relationship:true,label:relationship.label,note:relationship.text,knowledge_scope:'author_truth',time:{mode:'unknown'}})});
  }
  for(const [index,idea] of TIME_IDEAS.entries()) {
    const record=upsert('entities','time:idea:'+idea.key,{kind:'thought',name:idea.name,description:idea.text,sort_order:index,data:canonicalData(work.id,'ideas',{is_manuscript:false})});
    const character=people.get(idea.person);
    if(active(record)&&active(character))upsert('relations','time:idea-person:'+idea.key,{source_id:character.id,target_id:record.id,type:'holds_idea',data:canonicalData(work.id,'ideas',{label:'사상 설정',is_manuscript:false})});
  }
  for(const [index,review] of TIME_REVIEWS.entries()) upsert('entities','time:review:'+review.key,{kind:'custom',name:review.name,description:review.text,sort_order:index,data:canonicalData(work.id,'review',{certainty:review.certainty,disclosure:review.disclosure??'public',...(review.library_sources?{library_sources:clone(review.library_sources)}:{})})});
  return {...report,work:store.get('documents',work.id),counts:summary(store,work),research_expected:{categories:14,items:120,verified_items:0,status:'unverified_source_unavailable'}};
}
