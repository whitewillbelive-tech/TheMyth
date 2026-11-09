import { Store, WRITABLE, fail, validId } from './store.js';
import { reconcileCatalog, setCharacterAppearances, updateTitleSettings, validateWorkspaceMutation } from './main-workspace.js';
import { matchesTitleScope } from '../web/main-domain.js';

const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
const json = (value,status=200,extra={}) => new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});
const isObject = value => value!==null&&typeof value==='object'&&!Array.isArray(value);
const pathId = value => { let id;try{id=decodeURIComponent(value);}catch{fail('연결 ID의 URL 인코딩이 잘못되었습니다.');}if(!validId(id))fail('유효한 고유 ID가 필요합니다.');return id; };

async function body(request) {
  const length=request.headers.get('content-length');
  if(length&&(!/^\d+$/.test(length)||Number(length)>32*1024*1024)) fail('요청은 32 MiB 이하여야 합니다.',413);
  if(!request.body) fail('JSON 객체 본문이 필요합니다.');
  const reader=request.body.getReader(),chunks=[]; let size=0;
  while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>32*1024*1024) {await reader.cancel(); fail('요청은 32 MiB 이하여야 합니다.',413);} chunks.push(value); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
  let value; try {value=JSON.parse(new TextDecoder().decode(bytes));} catch {fail('올바른 JSON 객체를 입력하세요.');}
  if(!isObject(value)) fail('JSON 객체 본문이 필요합니다.');
  return value;
}

function exportDocument(store,id,format='md',chapterId=null) {
  if(!['md','txt'].includes(format)) fail('내보내기 형식은 md 또는 txt입니다.');
  const document=store.get('documents',id);
  let chapters=store.all('chapters').filter(c=>c.document_id===id&&!c.deleted_at);
  chapters.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0)||(a.created_at??'').localeCompare(b.created_at??''));
  let title=document.name,lines=[(format==='md'?'# ':'')+title,'',document.body??'',''];
  if(chapterId) {
    const chapter=chapters.find(c=>c.id===chapterId); if(!chapter) fail('선택한 장을 찾을 수 없습니다.',404);
    const subtree=new Set([chapterId]); let previous;
    do {previous=subtree.size; for(const c of chapters) if(subtree.has(c.parent_id)) subtree.add(c.id);} while(previous!==subtree.size);
    chapters=chapters.filter(c=>subtree.has(c.id));title=chapter.name;lines=[];
  }
  const activeIds=new Set(chapters.map(c=>c.id));
  const appendChapters=(parent,depth=2)=>{
    for(const chapter of chapters) {
      const effectiveParent=activeIds.has(chapter.parent_id)?chapter.parent_id:null;
      if(effectiveParent!==parent) continue;
      lines.push((format==='md'?'#'.repeat(Math.min(depth,6))+' ':'')+chapter.name,'',chapter.body??'',''); appendChapters(chapter.id,depth+1);
    }
  };
  if(chapterId) {const root=chapters.find(c=>c.id===chapterId);lines.push((format==='md'?'# ':'')+root.name,'',root.body??'','');chapters=chapters.filter(c=>c.id!==chapterId);appendChapters(chapterId);}
  else appendChapters(null);
  const filename=encodeURIComponent(title.replaceAll('/','_').replaceAll('\\','_')+'.'+format).replaceAll("'",'%27');
  return new Response(lines.join('\n'),{headers:{...headers,'Content-Type':`${format==='md'?'text/markdown':'text/plain'}; charset=utf-8`,'Content-Disposition':`attachment; filename*=UTF-8''${filename}`}});
}

/** The owner-private Sites dispatch is the authentication/access boundary. */
export async function handleApi(request,env) {
  try {
    const url=new URL(request.url),method=request.method.toUpperCase(),path=url.pathname.replace(/\/$/,'');
    if(['POST','PATCH','PUT','DELETE'].includes(method)) {
      const origin=request.headers.get('origin');
      if(origin&&origin.replace(/\/$/,'')!==url.origin) fail('다른 사이트에서 이 작업 공간을 변경할 수 없습니다.',403);
      if(request.headers.get('sec-fetch-site')==='cross-site') fail('다른 사이트의 변경 요청이 차단되었습니다.',403);
    }
    if(path==='/api/health'&&method==='GET') {
      if(!env.DB) fail('영속 저장소가 연결되지 않았습니다.',503);
      await env.DB.prepare('SELECT 1').first();
      return json({status:'ok',schema_version:1,storage:'cloudflare-d1'});
    }
    const safetyMatch=path.match(/^\/api\/safety-backups\/(before-restore-[A-Za-z0-9TZ-]+\.json)$/);
    if(safetyMatch&&method==='GET') {
      if(!env.BUCKET) fail('백업 저장소가 연결되지 않았습니다.',503);
      const saved=await env.BUCKET.get(`backups/${safetyMatch[1]}`); if(!saved) fail('안전 백업을 찾을 수 없습니다.',404);
      return new Response(saved.body,{headers:{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="${safetyMatch[1]}"`}});
    }
    const store=await Store.load(env);
    if(path==='/api/state'&&method==='GET') return json(store.state());
    if(path==='/api/catalog/reconcile'&&method==='POST') {
      await body(request);
      const result=reconcileCatalog(store); await store.commit(); return json(result);
    }
    const appearanceMatch=path.match(/^\/api\/characters\/([^/]+)\/appearances$/);
    if(appearanceMatch&&method==='POST') {
      const result=setCharacterAppearances(store,pathId(appearanceMatch[1]),await body(request)); await store.commit(); return json(result);
    }
    const settingsMatch=path.match(/^\/api\/characters\/([^/]+)\/title-settings\/([^/]+)$/);
    if(settingsMatch&&method==='PATCH') {
      const result=updateTitleSettings(store,pathId(settingsMatch[1]),pathId(settingsMatch[2]),await body(request)); await store.commit(); return json(result);
    }
    if(path==='/api/timeline'&&method==='GET') {
      const raw=url.searchParams.get('year'),year=raw===null?null:Number(raw);
      if(raw!==null&&(raw.trim()===''||!Number.isFinite(year))) fail('유한한 숫자 연도를 입력하세요.');
      return json(timeline(store.state(),year,url.searchParams.get('title_id'),{generationId:url.searchParams.get('generation_id'),includeCommon:url.searchParams.get('include_common')!=='0'}));
    }
    if(path==='/api/backup'&&method==='GET') return json(store.backup(),200,{'Content-Disposition':'attachment; filename="the-myth-backup.json"'});
    if(path==='/api/backup/restore'&&method==='POST') {
      const payload=await body(request),result=await store.importBackup(payload.backup,payload.mode??'merge',payload.confirm); await store.commit(); return json(result);
    }
    const parts=path.split('/').filter(Boolean),collection=parts[1],id=parts[2]?decodeURIComponent(parts[2]):null,action=parts[3];
    if(parts[0]!=='api'||parts.length>4) fail('경로를 찾을 수 없습니다.',404);
    if(collection==='entities'&&id&&action==='impact'&&['GET','POST'].includes(method)) return json(store.impact(id));
    if(collection==='entities'&&id&&action==='merge-preview'&&method==='GET') return json(store.mergePreview(id,url.searchParams.get('source_id')));
    if(collection==='entities'&&id&&action==='merge'&&method==='POST') {const payload=await body(request),result=store.merge(id,payload.source_id,payload.field_choices??{});await store.commit();return json(result);}
    if(collection==='entities'&&id&&action==='split'&&method==='POST') {const result=store.split(id,await body(request));await store.commit();return json(result);}
    if(collection==='versions'&&id&&action==='restore'&&method==='POST') {const result=store.restoreVersion(id);await store.commit();return json(result);}
    if(collection==='documents'&&id&&action==='export'&&method==='GET') return exportDocument(store,id,url.searchParams.get('format')??'md',url.searchParams.get('chapter_id'));
    if(collection==='versions'&&!id&&method==='GET') return json(store.all('versions'));
    if(!WRITABLE.includes(collection)) fail('경로를 찾을 수 없습니다.',404);
    if(action) {
      if(action==='restore'&&collection!=='memberships'&&method==='POST') {const result=store.delete(collection,id,true);await store.commit();return json(result);}
      fail('경로를 찾을 수 없습니다.',404);
    }
    if(method==='GET') return json(id?store.get(collection,id):store.all(collection));
    let result,previous=null;
    if(method==='POST'&&!id) result=store.create(collection,await body(request));
    else if(method==='PATCH'&&id) {previous=store.get(collection,id);result=store.update(collection,id,await body(request));}
    else if(method==='DELETE'&&id) result=store.delete(collection,id);
    else fail('허용되지 않는 요청 방식입니다.',405);
    if(['POST','PATCH'].includes(method)) validateWorkspaceMutation(store,collection,result,previous);
    await store.commit(); return json(result);
  } catch(error) {
    if(error.status) return json({detail:error.detail??error.message},error.status);
    console.error('THE MYTH API failure',error);
    return json({detail:'저장소 요청을 완료하지 못했습니다. 저장되지 않은 편집 내용을 보존한 뒤 다시 시도하세요.'},500);
  }
}
// Faithful port of myth/store.py numeric, bounds, active_at, and timeline.
// `fail(detail, status)` is provided by the consuming store module.
export function numeric(time, end = false) {
  if (!time || [undefined, null, 'unknown', 'before', 'after'].includes(time.mode)) return null;
  if (time.mode === 'absolute') return time.year ?? null;
  if (time.mode === 'range') return time[end ? 'end' : 'start'] ?? null;
  return null;
}
export function bounds(record) {
  if ('start' in record || 'end' in record) return [numeric(record.start), numeric(record.end, true)];
  const time = record.data?.time;
  return [numeric(time), numeric(time, true)];
}
function pythonTruthy(value) {
  if (value === null || value === undefined || value === false || value === '' || value === 0) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}
export function active_at(record, year) {
  const [start, end] = bounds(record);
  if (year === null || year === undefined) return 'uncertain';
  if ((pythonTruthy(record.start) && start === null) || (pythonTruthy(record.end) && end === null) || (start === null && end === null)) return 'uncertain';
  return (start === null || start <= year) && (end === null || year <= end) ? 'effective' : 'inactive';
}
export function timeline(state, year = null, title_id = null, {generationId = null, includeCommon = true} = {}) {
  const entities = state.entities.filter(e => !pythonTruthy(e.deleted_at));
  let relations = state.relations.filter(r => !pythonTruthy(r.deleted_at));
  let states = state.states.filter(r => !pythonTruthy(r.deleted_at));
  const by_id = new Map(entities.map(e => [e.id, e]));
  const selected_title = title_id ? by_id.get(title_id) : null;
  if (title_id && (!selected_title || selected_title.kind !== 'title')) fail('선택한 타이틀을 찾을 수 없습니다.', 404);
  const selectedGeneration = generationId ? by_id.get(generationId) : null;
  if(generationId&&(!selectedGeneration||selectedGeneration.kind!=='generation')) fail('선택한 세대를 찾을 수 없습니다.',404);
  if(generationId&&selected_title&&selected_title.data?.generation_id!==generationId) fail('선택한 세대와 타이틀이 일치하지 않습니다.');
  const window = selected_title && year === null ? bounds(selected_title) : [year, year];
  const related = new Set(title_id ? [title_id] : by_id.keys());
  if (title_id) {
    for (const relation of relations) {
      if ([relation.source_id, relation.target_id].includes(title_id)) related.add(relation.target_id === title_id ? relation.source_id : relation.target_id);
    }
  }
  const scoped = !!title_id || !!generationId;
  const scope = {generationId:generationId??'',titleId:title_id??'',includeCommon};
  const visibleEntity = id => matchesTitleScope(state,by_id.get(id),scope);
  if(scoped) {
    states=states.filter(record=>visibleEntity(record.entity_id));
    relations=relations.filter(record=>{
      if(record.data?.title_id&&!matchesTitleScope(state,record,scope))return false;
      const titleEndpoints=[record.source_id,record.target_id].filter(id=>by_id.get(id)?.kind==='title');
      if(title_id&&titleEndpoints.length&&!titleEndpoints.includes(title_id))return false;
      return visibleEntity(record.source_id)&&visibleEntity(record.target_id);
    });
  }
  const items = entities.filter(e => ['event', 'title'].includes(e.kind) && (!scoped || matchesTitleScope(state,e,scope)));
  const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  items.sort((a, b) => ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || lexical(a.created_at ?? '', b.created_at ?? '') || lexical(a.id, b.id));
  const item_ids = new Set(items.map(i => i.id));
  const edges = new Map(Array.from(item_ids, id => [id, new Set()]));
  for (const relation of relations) {
    let a, b;
    if (['before', '이전', 'precedes', 'causes'].includes(relation.type)) [a, b] = [relation.source_id, relation.target_id];
    else if (['after', '이후', 'follows', 'caused_by'].includes(relation.type)) [a, b] = [relation.target_id, relation.source_id];
    else continue;
    if (item_ids.has(a) && item_ids.has(b)) edges.get(a).add(b);
  }
  for (const item of items) {
    const time = item.data?.time ?? {};
    if (item_ids.has(time.event_id)) {
      const [a, b] = time.mode === 'before' ? [item.id, time.event_id] : [time.event_id, item.id];
      edges.get(a).add(b);
    }
  }
  const indegree = new Map(Array.from(item_ids, id => [id, 0]));
  for (const targets of edges.values()) for (const id of targets) indegree.set(id, indegree.get(id) + 1);
  const ordered = [], emitted = new Set();
  while (ordered.length < items.length) {
    const ready = items.find(e => !emitted.has(e.id) && indegree.get(e.id) === 0);
    if (!ready) break;
    ordered.push(ready);
    emitted.add(ready.id);
    for (const target of edges.get(ready.id)) indegree.set(target, indegree.get(target) - 1);
  }
  const conflicts = [];
  if (ordered.length < items.length) {
    const cyclic = items.filter(e => !emitted.has(e.id));
    conflicts.push({ type: 'chronology_cycle', message: '사건의 선후 관계가 순환합니다. 자료는 유지됩니다.', ids: cyclic.map(e => e.id) });
    ordered.push(...cyclic);
  }
  const effective_states = [], effective_relations = [], uncertain = [];
  function status_in_window(record) {
    if (year !== null) return active_at(record, year);
    const [window_start, window_end] = window;
    if (window_start === null && window_end === null) return 'uncertain';
    const [start, end] = bounds(record);
    if ((pythonTruthy(record.start) && start === null) || (pythonTruthy(record.end) && end === null) || (start === null && end === null)) return 'uncertain';
    return Math.max(start ?? -Infinity, window_start ?? -Infinity) <= Math.min(end ?? Infinity, window_end ?? Infinity) ? 'effective' : 'inactive';
  }
  for (const [records, output, collection] of [[states, effective_states, 'states'], [relations, effective_relations, 'relations']]) {
    for (const record of records) {
      const status = status_in_window(record);
      if (status === 'effective') output.push(record);
      else if (status === 'uncertain') uncertain.push({ collection, record });
    }
  }
  const exclusive = new Set(['나이', '외형', '생존 상태', '활동 상태', '현재 활동 행성', '현재 행성', '통치', '통치자', 'age', 'appearance', 'alive', 'status', 'location', 'current_planet', 'ruler']);
  for (let i = 0; i < states.length; i++) {
    const a = states[i];
    for (const b of states.slice(i + 1)) {
      if (a.entity_id !== b.entity_id || a.attribute !== b.attribute || a.value === b.value) continue;
      if (!exclusive.has(a.attribute) && !pythonTruthy(a.data?.exclusive) && !pythonTruthy(b.data?.exclusive)) continue;
      const [aa, az] = bounds(a), [ba, bz] = bounds(b);
      if (aa === null || ba === null) continue;
      if (Math.max(aa, ba) <= Math.min(az ?? Infinity, bz ?? Infinity)) conflicts.push({ type: 'state_overlap', message: `${a.attribute}의 서로 다른 상태가 중첩됩니다.`, ids: [a.id, b.id], entity_id: a.entity_id });
    }
  }
  for (let i = 0; i < relations.length; i++) {
    const a = relations[i];
    if (!['governs', 'galaxy_master', '통치', '갤럭시 마스터'].includes(a.type) || a.data?.exclusive === false) continue;
    for (const b of relations.slice(i + 1)) {
      if (b.type !== a.type || b.target_id !== a.target_id || b.source_id === a.source_id || b.data?.exclusive === false) continue;
      const [aa, az] = bounds(a), [ba, bz] = bounds(b);
      if (aa !== null && ba !== null && Math.max(aa, ba) <= Math.min(az ?? Infinity, bz ?? Infinity)) conflicts.push({ type: 'governance_overlap', message: '동일 공간의 통치·조율 관계가 중첩됩니다. 공동 관계이면 exclusive=false로 표시하세요.', ids: [a.id, b.id], entity_id: a.target_id });
    }
  }
  for (const relation of relations) {
    if (!['before', 'after', '이전', '이후', 'precedes', 'follows', 'causes', 'caused_by'].includes(relation.type)) continue;
    const source = by_id.get(relation.source_id), target = by_id.get(relation.target_id);
    if (!source || !target) continue;
    const [sa] = bounds(source), [ta] = bounds(target);
    if (sa !== null && ta !== null && ((['before', '이전', 'precedes', 'causes'].includes(relation.type) && sa > ta) || (['after', '이후', 'follows', 'caused_by'].includes(relation.type) && sa < ta))) conflicts.push({ type: 'date_order', message: '확정 연도와 사건 선후 관계가 충돌합니다.', ids: [relation.id] });
  }
  return { year, title_id, generation_id:generationId, observation_range: { start: window[0], end: window[1] }, items: ordered, events: ordered.filter(e => e.kind === 'event'), titles: ordered.filter(e => e.kind === 'title'), effective_states, effective_relations, uncertain, conflicts };
}
