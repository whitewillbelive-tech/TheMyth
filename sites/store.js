// D1 adapter for the original myth/store.py domain model.
// Reads are one snapshot; every multi-record change commits as one guarded batch.
export const COLLECTIONS = ['entities','relations','groups','memberships','states','documents','chapters','versions'];
export const WRITABLE = COLLECTIONS.slice(0,-1);
const KINDS = new Set(['generation','title','character','organization','event','space','planet','civilization','setting','thought','thinker','custom']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
export function fail(detail, status=422) { throw Object.assign(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)), {detail,status}); }
// JSON equality is structural, matching Python dict equality regardless of key order.
export function equal(a,b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length===b.length && a.every((v,i)=>equal(v,b[i]));
  if (object(a) && object(b)) { const keys=Object.keys(a); return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k])); }
  return false;
}
function references(value,target) {
  if (Array.isArray(value)) return value.some(v=>references(v,target));
  if (object(value)) return Object.entries(value).some(([k,v])=>(k.endsWith('_id')&&v===target)||(k.endsWith('_ids')&&Array.isArray(v)&&v.includes(target))||references(v,target));
  return false;
}
function redirect(value,source,target) {
  if (Array.isArray(value)) return value.map(v=>redirect(v,source,target));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,
    k.endsWith('_id')&&v===source ? target : k.endsWith('_ids')&&Array.isArray(v)&&v.every(x=>typeof x==='string') ? [...new Set(v.map(x=>x===source?target:x))] : redirect(v,source,target)]));
  return value;
}
function numeric(time,end=false) {
  if (!time || ['unknown','before','after'].includes(time.mode)) return null;
  return time.mode==='absolute' ? time.year ?? null : time.mode==='range' ? time[end?'end':'start'] ?? null : null;
}

export class Store {
  constructor(env, records, revision, initialized=false) {
    this.env=env; this.revision=revision;
    this.original=Object.fromEntries(COLLECTIONS.map(t=>[t,new Map(records[t].map(r=>[r.id,clone(r)]))]));
    this.records=Object.fromEntries(COLLECTIONS.map(t=>[t,new Map(records[t].map(r=>[r.id,clone(r)]))]));
    this.imported=false; this.replacing=false; this.initialized=initialized;
  }
  static async load(env) {
    if (!env.DB) fail('영속 저장소가 연결되지 않았습니다.',503);
    const results=await env.DB.batch([
      ...COLLECTIONS.map(t=>env.DB.prepare(`SELECT record FROM ${t} ORDER BY rowid`)),
      env.DB.prepare("SELECT value FROM metadata WHERE key='sites_write_revision'"),
      env.DB.prepare("SELECT value FROM metadata WHERE key='initialized'")
    ]);
    const records=Object.fromEntries(COLLECTIONS.map((t,i)=>[t,results[i].results.map(r=>JSON.parse(r.record))]));
    return new Store(env,records,results[COLLECTIONS.length].results[0]?.value ?? '0',results[COLLECTIONS.length+1].results[0]?.value==='1');
  }
  all(table) { return [...this.records[table].values()].map(clone); }
  get(table,id,required=true) {
    const record=this.records[table].get(id);
    if (!record && required) fail('대상을 찾을 수 없습니다.',404);
    return record ? clone(record) : null;
  }
  put(table,record) { this.records[table].set(record.id,clone(record)); }
  state() { return {...Object.fromEntries(COLLECTIONS.map(t=>[t,this.all(t)])),meta:{schema_version:1,exported_at:now(),application:'THE MYTH',storage:'cloudflare-d1',migration_status:this.initialized||this.imported?'backup_imported':'backup_missing'}}; }
  backup() { return {...this.state(),format:'the-myth-backup',format_version:1}; }
  async commit() {
    const statements=[];
    for (const table of COLLECTIONS) {
      if(this.replacing) statements.push(this.env.DB.prepare(`DELETE FROM ${table}`));
      else for (const [id,old] of this.original[table]) if (!this.records[table].has(id)) statements.push(this.env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id));
      for (const [id,record] of this.records[table]) {
        if (!this.replacing&&equal(this.original[table].get(id),record)) continue;
        const json=JSON.stringify(record);
        // D1 has a 2 MB string/row limit. Reject before touching any record.
        if (new TextEncoder().encode(json).length > 1_900_000) fail('레코드 또는 중첩 원고 이력이 저장소의 단일 레코드 크기 제한을 초과했습니다. 기존 자료는 변경되지 않았습니다.',413);
        statements.push(this.env.DB.prepare(`INSERT INTO ${table}(id,record) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record`).bind(id,json));
      }
    }
    if (!statements.length && !this.imported) return;
    const guard=this.env.DB.prepare("INSERT INTO metadata(key,value) SELECT 'sites_write_revision',NULL WHERE COALESCE((SELECT value FROM metadata WHERE key='sites_write_revision'),'0') != ?").bind(this.revision);
    const revision=this.env.DB.prepare("INSERT INTO metadata(key,value) VALUES('sites_write_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(newId());
    if (this.imported) statements.push(this.env.DB.prepare("INSERT INTO metadata(key,value) VALUES('initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value"));
    try { await this.env.DB.batch([guard,...statements,revision]); }
    catch(error) {
      if (/NOT NULL constraint failed: metadata\.value|UNIQUE constraint failed: metadata\.key/.test(String(error))) fail('다른 창에서 변경되었습니다. 최신 내용을 다시 불러온 뒤 편집하세요.',409);
      throw error;
    }
  }
  existsReference(id,tables=['entities'],kinds=null) {
    if (!id) return;
    if (typeof id!=='string') fail('연결 대상 ID는 문자열이어야 합니다.');
    for (const table of tables) { const found=this.get(table,id,false); if(found&&(!kinds||kinds.includes(found.kind))) return found; }
    fail(`존재하지 않거나 유형이 맞지 않는 연결: ${id}`);
  }
  time(value) {
    if (value==null) return;
    if (!object(value)) fail('시간은 표현 방식이 있는 객체여야 합니다.');
    const mode=Object.hasOwn(value,'mode')?value.mode:'unknown';
    if (!['unknown','absolute','before','after','range'].includes(mode)) fail('지원하지 않는 시간 표현입니다.');
    for (const key of ['year','start','end']) if(value[key]!=null&&(typeof value[key]!=='number'||!Number.isFinite(value[key]))) fail('절대 연도는 숫자 또는 미확정(null)이어야 합니다.');
    if (mode==='unknown'&&['year','start','end'].some(k=>value[k]!=null)) fail('미확정 시점에는 숫자 연도를 지정할 수 없습니다.');
    if (mode==='absolute'&&value.year==null) fail('확정 연도를 입력하세요.');
    if (mode==='range'&&value.start!=null&&value.end!=null&&value.start>value.end) fail('기간의 시작은 종료보다 늦을 수 없습니다.');
    if (['before','after'].includes(mode)) { this.existsReference(value.event_id,['entities'],['event']); if(!value.event_id) fail('선후 관계의 기준 사건을 선택하세요.'); }
  }
  hierarchy(table,record,field='parent_id',data=false) {
    let parent=data?record.data?.[field]:record[field];
    if(parent!=null&&typeof parent!=='string') fail('상위 항목 ID는 문자열 또는 미정(null)이어야 합니다.');
    const seen=new Set([record.id]);
    while(parent) {
      if(seen.has(parent)) fail('상위·하위 구조에 순환을 만들 수 없습니다.'); seen.add(parent);
      const item=this.get(table,parent,false); if(!item) fail('상위 항목을 찾을 수 없습니다.');
      if(table==='chapters'&&item.document_id!==record.document_id) fail('장·절의 상위 항목은 같은 서적에 속해야 합니다.');
      parent=data?item.data?.[field]:item[field];
    }
  }
  validateData(data) {
    if(!object(data)) fail('확장 정보(data)는 객체여야 합니다.');
    for(const [key,value] of Object.entries(data)) {
      if(['time','start','end'].includes(key)&&object(value)&&Object.hasOwn(value,'mode')) this.time(value);
      else if(key.endsWith('_id')&&value!=null) { if(typeof value!=='string') fail('연결 ID는 문자열 또는 미정(null)이어야 합니다.'); this.existsReference(value); }
      else if(key.endsWith('_ids')&&value!=null) {
        if(!Array.isArray(value)) fail('연결 ID 목록은 배열이어야 합니다.');
        for(const id of value) { if(typeof id!=='string'||!id) fail('연결 목록에는 유효한 ID만 입력하세요.'); this.existsReference(id,['entities','documents']); }
      } else if(object(value)) this.validateData(value);
    }
  }
  validate(table,r) {
    if(!validId(r.id)) fail('유효한 고유 ID가 필요합니다.');
    if(['entities','groups','documents','chapters'].includes(table)&&(typeof r.name!=='string'||!r.name.trim())) fail('이름 또는 제목을 입력하세요.');
    for(const field of ['name','description','body']) if(Object.hasOwn(r,field)&&typeof r[field]!=='string') fail(`${field}는 텍스트여야 합니다.`);
    if(Object.hasOwn(r,'sort_order')&&(typeof r.sort_order!=='number'||!Number.isFinite(r.sort_order))) fail('정렬 순서는 숫자여야 합니다.');
    this.validateData(Object.hasOwn(r,'data')?r.data:{});
    if(table==='entities') {
      if(!KINDS.has(r.kind)) fail('지원하지 않는 객체 유형입니다.'); this.hierarchy(table,r,'parent_id',true);
      if(r.data?.generation_id) this.existsReference(r.data.generation_id,['entities'],['generation']);
      if(r.data?.origin_planet_id) this.existsReference(r.data.origin_planet_id,['entities'],['planet']);
      if(['space','planet'].includes(r.kind)&&r.data?.parent_id) this.existsReference(r.data.parent_id,['entities'],['space','planet']);
      if(r.data?.civilization_id) this.existsReference(r.data.civilization_id,['entities'],['civilization']);
    } else if(table==='groups') this.hierarchy(table,r);
    else if(table==='memberships') {
      this.existsReference(r.group_id,['groups']); this.existsReference(r.entity_id);
      if(!r.group_id||!r.entity_id) fail('그룹과 객체를 선택하세요.');
      if(this.all(table).some(o=>o.id!==r.id&&o.group_id===r.group_id&&o.entity_id===r.entity_id)) fail('이미 이 그룹에 속한 객체입니다.',409);
    } else if(table==='relations') {
      for(const field of ['source_id','target_id']) { if(!r[field]) fail('관계의 양쪽 대상을 선택하세요.'); this.existsReference(r[field],['entities','documents']); }
      if(r.source_id===r.target_id&&!(r.deleted_at&&r.data?.merge_self_reference)) fail('동일 객체를 자신에게 연결할 수 없습니다.');
      if(typeof r.type!=='string'||!r.type.trim()) fail('관계 유형을 입력하세요.'); this.time(r.start); this.time(r.end);
    } else if(table==='states') {
      if(!r.entity_id) fail('상태의 대상을 선택하세요.'); this.existsReference(r.entity_id);
      if(typeof r.attribute!=='string'||!r.attribute.trim()||typeof r.value!=='string') fail('속성과 상태 값을 입력하세요.'); this.time(r.start); this.time(r.end);
    } else if(table==='documents') {
      if(!['story','book'].includes(r.kind)) fail('문서는 외전(story) 또는 사상집(book)이어야 합니다.');
      if(r.author_id) this.existsReference(r.author_id,['entities'],['character','thinker']);
      if(!['draft','confirmed','noncanon','undecided'].includes(r.canon_status)) fail('설정 상태를 선택하세요.');
    } else if(table==='chapters') {
      if(!r.document_id) fail('장·절이 속할 원고를 선택하세요.'); this.existsReference(r.document_id,['documents']); this.hierarchy(table,r);
    }
    if(['relations','states'].includes(table)) { const start=numeric(r.start),end=numeric(r.end,true); if(start!=null&&end!=null&&start>end) fail('관계·상태의 시작은 종료보다 늦을 수 없습니다.'); }
  }
  create(table,values) {
    const r={id:values.id||newId(),revision:1,created_at:now(),updated_at:now(),deleted_at:null};
    if(['entities','groups','documents','chapters'].includes(table)) Object.assign(r,{name:'',description:'',sort_order:0});
    if(['entities','relations','states','documents'].includes(table)) r.data={};
    if(table==='entities') r.kind='custom';
    if(table==='groups') r.parent_id=null;
    if(['relations','states'].includes(table)) Object.assign(r,{start:null,end:null});
    if(table==='documents') Object.assign(r,{kind:'story',body:'',author_id:null,status:'구상',canon_status:'draft'});
    if(table==='chapters') Object.assign(r,{body:'',parent_id:null});
    Object.assign(r,Object.fromEntries(Object.entries(values).filter(([k])=>!['revision','created_at','updated_at','deleted_at'].includes(k))));
    if(this.get(table,r.id,false)) fail('이미 존재하는 ID입니다.',409);
    for(const other of COLLECTIONS) if(other!==table&&this.get(other,r.id,false)) fail('다른 종류의 항목이 같은 ID를 사용합니다.',409);
    this.validate(table,r); this.put(table,r); return r;
  }
  version(table,record,label='자동 저장 전 버전') {
    if(table==='memberships') return;
    const snapshot=clone(record);
    if(table==='documents') snapshot._chapters=this.all('chapters').filter(c=>c.document_id===record.id);
    this.put('versions',{id:newId(),target_type:table,target_id:record.id,created_at:now(),label,snapshot});
  }
  update(table,id,values,label='자동 저장 전 버전') {
    const current=this.get(table,id);
    if(['entities','documents'].includes(table)&&(values.kind??current.kind)!==current.kind) fail('연결의 무결성을 위해 기본 유형은 생성 후 변경할 수 없습니다. 세부 분류를 편집하거나 새 객체를 생성하세요.');
    if(table==='chapters'&&(values.document_id??current.document_id)!==current.document_id) fail('장·절은 원래 서적 안에서 이동할 수 있습니다. 다른 서적으로 옮기려면 내용을 복사하세요.');
    if(values.revision!=null&&values.revision!==current.revision) fail('다른 창에서 변경되었습니다. 최신 내용을 다시 불러온 뒤 편집하세요.',409);
    if(Object.hasOwn(values,'id')&&values.id!==id) fail('고유 ID는 수정할 수 없습니다.');
    const r={...current,...Object.fromEntries(Object.entries(values).filter(([k])=>!['id','revision','created_at','updated_at','deleted_at'].includes(k)))};
    this.validate(table,r); if(equal(r,current)) return current;
    this.version(table,current,label); Object.assign(r,{revision:r.revision+1,updated_at:now()}); this.put(table,r); return r;
  }
  delete(table,id,restore=false) {
    const current=this.get(table,id);
    if(table==='memberships') {this.records[table].delete(id); return {id,removed:true};}
    this.version(table,current,restore?'복원 전':'삭제 전'); Object.assign(current,{deleted_at:restore?null:now(),revision:current.revision+1,updated_at:now()});
    if(restore) this.validate(table,current); this.put(table,current); return current;
  }
  impact(id) {
    this.get('entities',id); const affected=[];
    for(const table of WRITABLE) for(const record of this.all(table)) if(record.id!==id&&references(record,id)) affected.push({collection:table,record});
    return {entity_id:id,references:affected,count:affected.length,policy:'참조를 유지한 채 휴지통으로 이동합니다. 연결된 자료는 삭제되지 않습니다.'};
  }
  mergePreview(targetId,sourceId) {
    const target=this.get('entities',targetId),source=this.get('entities',sourceId);
    if(targetId===sourceId||target.deleted_at||source.deleted_at) fail('서로 다른 활성 객체를 선택하세요.');
    if(target.kind!==source.kind) fail('같은 유형의 객체만 병합할 수 있습니다.');
    const conflicts=[];
    for(const key of ['name','description','sort_order']) if(!equal(target[key],source[key])&&source[key]!=null&&source[key]!==''&&!equal(source[key],[])) conflicts.push({field:key,target:target[key]??null,source:source[key]});
    for(const [key,value] of Object.entries(source.data??{})) if(Object.hasOwn(target.data??{},key)&&!equal(target.data[key],value)) conflicts.push({field:`data.${key}`,target:target.data[key],source:value});
    return {target,source,conflicts,impact:this.impact(sourceId)};
  }
  merge(targetId,sourceId,choices) {
    const preview=this.mergePreview(targetId,sourceId); if(!object(choices)) fail('충돌 필드 선택은 객체여야 합니다.');
    const {target,source}=preview;
    const unresolved=preview.conflicts.filter(c=>!['target','source'].includes(choices[c.field])).map(c=>c.field);
    if(unresolved.length) fail({message:'충돌하는 필드마다 유지할 값을 선택하세요.',fields:unresolved},409);
    let merged={...target,data:{...source.data,...target.data}};
    for(const [field,choice] of Object.entries(choices)) if(choice==='source') {
      if(field.startsWith('data.')) merged.data[field.slice(5)]=source.data?.[field.slice(5)]??null;
      else if(['name','description','sort_order'].includes(field)) merged[field]=source[field]??null;
    }
    if(!merged.description) merged.description=source.description??'';
    this.version('entities',target,'병합 전 대상'); this.version('entities',source,'병합 전 원본');
    for(const table of WRITABLE) for(const record of this.all(table)) {
      if(table==='entities'&&[targetId,sourceId].includes(record.id)) continue;
      const updated=redirect(record,sourceId,targetId);
      if(!equal(updated,record)) {
        this.version(table,record,'병합 참조 변경 전'); Object.assign(updated,{revision:record.revision+1,updated_at:now()});
        if(table==='relations'&&updated.source_id===updated.target_id) {updated.deleted_at=now(); (updated.data??={}).merge_self_reference=true;}
        this.put(table,updated);
      }
    }
    const seen=new Set(); for(const membership of this.all('memberships')) {const key=JSON.stringify([membership.group_id,membership.entity_id]); if(seen.has(key)) this.records.memberships.delete(membership.id); seen.add(key);}
    merged=redirect(merged,sourceId,targetId); if(merged.data.parent_id===targetId) merged.data.parent_id=null;
    this.validate('entities',merged); Object.assign(merged,{revision:target.revision+1,updated_at:now()}); this.put('entities',merged);
    Object.assign(source,{deleted_at:now(),revision:source.revision+1,updated_at:now(),data:{...source.data,merged_into_id:targetId}}); this.put('entities',source);
    for(const entity of this.all('entities')) if(!entity.deleted_at) this.hierarchy('entities',entity,'parent_id',true);
    return {entity:merged,source,redirected_references:preview.impact.count};
  }
  split(id,values) {
    const original=this.get('entities',id),keys=values.fields??[],selected=values.relation_ids??[];
    if(!Array.isArray(keys)||keys.some(k=>typeof k!=='string')) fail('복사할 확장 필드를 선택하세요.');
    if(!Array.isArray(selected)) fail('복사할 연결 목록이 필요합니다.');
    const records=selected.map(relId=>{const rel=this.get('relations',relId); if(![rel.source_id,rel.target_id].includes(id)) fail('분할 대상과 연결된 관계만 복사할 수 있습니다.'); return rel;});
    const entity=this.create('entities',{kind:original.kind,name:values.name??'',description:values.description??'',data:Object.fromEntries(keys.filter(k=>Object.hasOwn(original.data,k)).map(k=>[k,original.data[k]]))});
    for(const rel of records) this.create('relations',redirect(Object.fromEntries(Object.entries(rel).filter(([k])=>!['id','revision','created_at','updated_at','deleted_at'].includes(k))),id,entity.id));
    this.version('entities',original,`분할: ${entity.name} 생성 (원본과 연결 유지)`);
    return {entity,copied_relations:records.length,policy:'선택한 필드와 관계를 복사했습니다. 원본 및 기존 참조는 보존됩니다.'};
  }
  validateVersion(version) {
    if(!object(version)||!validId(version.id)) fail('잘못된 버전 ID입니다.');
    const table=version.target_type;
    if(!WRITABLE.includes(table)||table==='memberships') fail('잘못된 버전 대상 유형입니다.');
    const targetId=version.target_id,snapshot=version.snapshot;
    if(!validId(targetId)||!object(snapshot)||snapshot.id!==targetId) fail('버전 원본과 복원 대상의 ID가 일치하지 않습니다.');
    const target=this.get(table,targetId);
    if(['entities','documents'].includes(table)&&snapshot.kind!==target.kind) fail('이전 버전은 객체의 기본 유형을 변경할 수 없습니다.');
    if(table==='chapters'&&snapshot.document_id!==target.document_id) fail('장·절 이력의 서적은 현재 서적과 일치해야 합니다.');
    if(typeof version.created_at!=='string'||typeof version.label!=='string') fail('버전의 시각 또는 설명이 잘못되었습니다.');
    if(!Number.isInteger(snapshot.revision)||snapshot.revision<1) fail('버전의 수정 번호가 잘못되었습니다.');
    const chapters=snapshot._chapters;
    if(chapters!=null) {
      if(table!=='documents'||!Array.isArray(chapters)) fail('장·절 이력이 잘못되었습니다.');
      const seen=new Set();
      for(const chapter of chapters) {
        if(!object(chapter)||!validId(chapter.id)||chapter.document_id!==targetId||seen.has(chapter.id)) fail('서적 이력의 장·절 연결이 잘못되었습니다.'); seen.add(chapter.id);
        const current=this.get('chapters',chapter.id,false); if(!current||current.document_id!==targetId) fail('서적 이력은 다른 서적의 장·절을 덮어쓸 수 없습니다.');
      }
    }
  }
  restoreVersion(id) {
    const version=this.get('versions',id); this.validateVersion(version); const table=version.target_type;
    if(!WRITABLE.includes(table)) fail('복원할 수 없는 이력입니다.');
    const current=this.get(table,version.target_id),snapshot=clone(version.snapshot),chapters=snapshot._chapters; delete snapshot._chapters;
    this.validate(table,snapshot); this.version(table,current,'이전 버전 복원 직전'); Object.assign(snapshot,{revision:current.revision+1,updated_at:now()}); this.put(table,snapshot);
    if(chapters!=null) {
      const ids=new Set(chapters.map(c=>c.id)); for(const chapter of this.all('chapters')) if(chapter.document_id===snapshot.id&&!ids.has(chapter.id)) this.delete('chapters',chapter.id);
      for(const chapter of chapters) {const prior=this.get('chapters',chapter.id,false); if(prior) this.version('chapters',prior,'서적 버전 복원 전'); Object.assign(chapter,{revision:(prior?.revision??0)+1,updated_at:now()}); this.put('chapters',chapter);}
      for(const chapter of chapters) this.validate('chapters',chapter);
    }
    return snapshot;
  }
  async importBackup(backup,mode='merge',confirm=null) {
    if(!object(backup)||backup.format!=='the-myth-backup'||backup.format_version!==1) fail('지원하는 THE MYTH 백업 파일이 아닙니다.');
    if(!['merge','replace'].includes(mode)) fail('복원 방식은 merge 또는 replace여야 합니다.');
    if(mode==='replace'&&confirm!=='REPLACE') fail('전체 교체는 confirm: REPLACE 확인이 필요합니다.',409);
    for(const table of COLLECTIONS) if(!Array.isArray(backup[table])) fail(`백업에서 ${table} 목록이 누락되었습니다.`);
    const previous=this.backup();
    if(mode==='replace') {this.replacing=true; for(const table of COLLECTIONS) this.records[table].clear();}
    const seen=new Set(); let inserted=0;
    for(const table of COLLECTIONS) for(const record of backup[table]) {
      if(!object(record)||!validId(record.id)) fail('잘못된 백업 레코드입니다.');
      if(seen.has(record.id)) fail('백업의 고유 ID가 중복되었습니다.'); seen.add(record.id);
      const existing=this.get(table,record.id,false);
      if(existing) { if(!equal(existing,record)) fail({message:'기존 자료와 충돌합니다. 병합은 기존 자료를 덮어쓰지 않습니다.',collection:table,id:record.id},409); continue; }
      for(const other of COLLECTIONS) if(other!==table&&this.get(other,record.id,false)) fail('다른 자료와 ID가 충돌합니다.',409);
      this.put(table,record); inserted++;
    }
    for(const table of WRITABLE) for(const record of this.all(table)) {if(!Number.isInteger(record.revision)||record.revision<1) fail('백업의 수정 번호가 잘못되었습니다.'); this.validate(table,record);}
    for(const version of this.all('versions')) this.validateVersion(version);
    if(!this.env.BUCKET) fail('복원 전 안전 백업 저장소가 연결되지 않았습니다. 기존 자료는 변경되지 않았습니다.',503);
    const safety=`before-restore-${now().replace(/[^0-9TZ]/g,'')}-${newId().slice(0,8)}.json`;
    await this.env.BUCKET.put(`backups/${safety}`,JSON.stringify(previous),{httpMetadata:{contentType:'application/json'}});
    this.imported=true;
    return {restored:inserted,mode,safety_backup:safety};
  }
}
