import { COMMON_FIELDS, WORK_FIELDS, resolveWorkCharacter, workCharacters, mainCharacterCandidates } from './work-characters-domain.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy = value => structuredClone(value);
const active = (state, table) => (state?.[table] || []).filter(row => !row.deleted_at);
const enc = encodeURIComponent;
const field = (label, control, wide = false) => `<label class="story-field${wide ? ' story-field-wide' : ''}"><span>${h(label)}</span>${control}</label>`;
const input = (name, value = '', attrs = '') => `<input name="${h(name)}" value="${h(value)}" ${attrs}>`;
const area = (name, value = '', attrs = '') => `<textarea name="${h(name)}" rows="5" ${attrs}>${h(value)}</textarea>`;
const button = (label, action, id = '', cls = 'ghost small') => `<button type="button" class="button ${cls}" data-story-action="${action}" data-story-id="${h(id)}">${h(label)}</button>`;
const select = (name, values, selected) => `<select name="${h(name)}">${values.map(([value,label]) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(label)}</option>`).join('')}</select>`;
const empty = text => `<p class="muted story-empty">${h(text)}</p>`;
const textValue = value => Array.isArray(value) ? value.join(', ') : value && typeof value === 'object' ? value.mode === 'unknown' ? '미정' : value.mode === 'absolute' ? String(value.year ?? '') : value.mode === 'range' ? `${value.start ?? '미정'} ~ ${value.end ?? '미정'}` : '시점 참조' : String(value ?? '');
const commonValue = (record, key) => ['name','description'].includes(key) ? record?.[key] ?? '' : record?.data?.[key] ?? (key === 'aliases' ? [] : '');
const certaintyOptions = [['user_confirmed','사용자 확정 설정'],['gpt_proposal','GPT 분석·검토 제안'],['research','연구·참고 담론'],['undecided','미정'],['superseded','이전 설정 · 대체됨']];
const disclosureOptions = [['public','설정 내용 제공됨'],['private','비공개·상세 미제공']];
const assignmentStatusOptions = [['placement_confirmed','명단 배치 확인 · 보유 시점 미정'],['aspirant_undetermined','지향·연결됨 · 취득 시점 미정'],['current','해당 시점의 보유 확인'],['former','과거 보유 확인'],['undecided','미정']];
const phaseOptions = [['past','이미 일어난 사건'],['current','현재 상황'],['goal','미래의 목표'],['undecided','시점 미정']];

const overviewComparisonFields = [{key:'name',label:'작품명'},{key:'provisional_title',label:'제목 상태'},{key:'overview',label:'개요'},{key:'form',label:'작품 형태'},{key:'era_region',label:'시대·지역'},{key:'notes',label:'메모'}];
const materialComparisonFields = [{key:'name',label:'자료명'},{key:'description',label:'내용'},{key:'certainty',label:'확정 상태'},{key:'disclosure',label:'공개 범위'},{key:'phase',label:'사건·상황 구분'},{key:'source_label',label:'출처 표시'},{key:'source_note',label:'출처·검토 메모'}];
const profileComparisonFields = WORK_FIELDS.flatMap(f=>[{key:f.key,label:f.label},{key:'mode_'+f.key,label:f.label+' 적용 범위'},{key:'note_'+f.key,label:f.label+' 재정의 메모'}]);
function recordComparisonValues(record,kind){return kind==='overview'?{name:record.name,provisional_title:String(!!record.data?.provisional_title),overview:record.data?.overview??record.description??'',form:record.data?.form||'',era_region:record.data?.era_region||'',notes:record.data?.notes||''}:{name:record.name,description:record.description||'',certainty:record.data?.certainty,disclosure:record.data?.disclosure,phase:record.data?.phase,source_label:record.data?.source?.label||'',source_note:record.data?.source?.note||''};}
function profileComparisonValues(projection,payload=null){
  const values=copy(projection.values),overrides={...projection.overrides},notes={...projection.override_notes};
  if(payload){Object.assign(overrides,payload.overrides||{});Object.assign(notes,payload.override_notes||{});for(const key of payload.inherit_fields||[]){delete overrides[key];delete notes[key];}}
  for(const f of WORK_FIELDS){values[f.key]=Object.hasOwn(overrides,f.key)?copy(overrides[f.key]):copy(commonValue(projection.common,f.key));if(f.key==='time'&&values[f.key]==='')values[f.key]={mode:'unknown'};values['mode_'+f.key]=Object.hasOwn(overrides,f.key)?'이 작품에서만 수정':'공통값 사용';values['note_'+f.key]=notes[f.key]||'';}
  return values;
}
function readEditorTime(fd){const mode=fd.get('time_mode')||'unknown';if(mode==='unknown')return{mode:'unknown'};if(mode==='absolute'){const raw=String(fd.get('time_year')||'').trim();if(!raw)throw Error('확정 연도를 입력하거나 시점 미정을 선택하세요.');return{mode,year:Number(raw)};}return{mode:'range',start:String(fd.get('time_start')||'').trim()?Number(fd.get('time_start')):null,end:String(fd.get('time_end')||'').trim()?Number(fd.get('time_end')):null};}

export const STORY_SECTIONS = Object.freeze([
  ['overview','작품 개요'],['characters','인물'],['events','사건·관계'],['world','배경·규칙'],['ideas','사상·담론'],['review','검토·출처'],
]);

export function storyMaterials(state, workId, section) {
  const sections = section === 'ideas' ? ['ideas','research','research_discourses'] : section === 'review' ? ['review','sources'] : [section];
  return active(state,'entities').filter(row => row.data?.work_id === workId && sections.includes(row.data?.section) && row.data?.classification !== 'honor').sort((a,b) => (a.data?.original_number ?? a.sort_order ?? Infinity) - (b.data?.original_number ?? b.sort_order ?? Infinity) || String(a.name).localeCompare(String(b.name),'ko'));
}

export function searchStoryCharacters(state, workId, query = '') {
  const honors = new Map(active(state,'entities').filter(row => row.data?.classification === 'honor' || row.data?.honor_letter).map(row => [row.id,row]));
  const assignments = active(state,'relations').filter(row => row.type === 'honor_assignment' && row.data?.work_id === workId);
  const q = String(query).normalize('NFC').trim().toLocaleLowerCase();
  return workCharacters(state,workId).map(projection => {
    const id = projection.local?.id || projection.character?.id || projection.id;
    const letters = assignments.filter(row => row.source_id === id).map(row => honors.get(row.target_id)?.data?.honor_letter || '').filter(Boolean).sort();
    const values = projection.values || {};
    const haystack = [values.name,values.english_name,...(Array.isArray(values.aliases) ? values.aliases : [values.aliases]),values.occupation,values.role,...letters].join(' ').normalize('NFC').toLocaleLowerCase();
    return {...projection,localId:id,letters,searchText:haystack};
  }).filter(row => !q || row.searchText.includes(q)).sort((a,b) => (a.letters[0] || '~').localeCompare(b.letters[0] || '~') || String(a.values?.english_name || a.values?.name || '').localeCompare(String(b.values?.english_name || b.values?.name || ''),'ko'));
}

export function profileFormValues(form) {
  const fd = new FormData(form), overrides = {}, inherit_fields = [], override_notes = {};
  for (const f of WORK_FIELDS) {
    if (fd.get('mode_' + f.key) !== 'override') { inherit_fields.push(f.key); continue; }
    if (f.key === 'time') {
      const mode = fd.get('time_mode') || 'unknown';
      if (mode === 'unknown') overrides.time = {mode:'unknown'};
      else if (mode === 'absolute') { const raw=String(fd.get('time_year') ?? '').trim(); if(!raw)throw Error('확정 연도를 입력하거나 시점 미정을 선택하세요.'); overrides.time={mode,year:Number(raw)}; }
      else overrides.time={mode:'range',start:String(fd.get('time_start') ?? '').trim() === '' ? null : Number(fd.get('time_start')),end:String(fd.get('time_end') ?? '').trim() === '' ? null : Number(fd.get('time_end'))};
    } else overrides[f.key] = f.key === 'aliases' ? String(fd.get(f.key) ?? '').split(',').map(s=>s.trim()).filter(Boolean) : String(fd.get(f.key) ?? '');
    override_notes[f.key]=String(fd.get('note_'+f.key) ?? '').trim();
  }
  return {overrides,inherit_fields,override_notes};
}

export function fieldComparison(fields, before, after) {
  return `<div class="story-comparison-scroll"><table class="story-comparison"><thead><tr><th>항목</th><th>최신 저장 내용</th><th>내 수정 내용</th></tr></thead><tbody>${fields.map(f=>`<tr><th>${h(f.label)}</th><td><pre>${h(textValue(before?.[f.key]))}</pre></td><td><pre>${h(textValue(after?.[f.key]))}</pre></td></tr>`).join('')}</tbody></table></div>`;
}

function sourceMarkup(record, state, table = 'entities') {
  const source=record.data?.source, sources=record.data?.sources, history=(state.versions||[]).filter(v=>v.target_type===table&&v.target_id===record.id).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const sourceText = value => typeof value === 'string' ? value : Object.entries(value||{}).filter(([,v])=>v!==null&&v!==undefined).map(([key,v])=>`${({label:'자료',kind:'유형',date:'날짜',library_file_id:'Library 원문',status:'확인 상태',note:'메모',reference:'참조',original_number:'원문 번호'}[key]||key)}: ${typeof v==='object'?Object.values(v).join(' · '):v}`).join('\n');
  return `<details class="story-source"><summary>출처·변경 이력</summary>${source || sources ? `<pre>${h(sourceText(source))}${sources ? '\n'+h((Array.isArray(sources)?sources:[sources]).map(sourceText).join('\n\n')) : ''}</pre>` : empty('출처가 아직 기록되지 않았습니다.')}<p class="muted">${history.length}개의 이전 상태가 보관되어 있습니다.</p>${history.slice(0,15).map(v=>`<details><summary>${h(v.label||'수정 전')} · ${h(String(v.created_at||'').slice(0,19).replace('T',' '))}</summary><p class="story-prose">${h(v.snapshot?.description || v.snapshot?.data?.overview || v.snapshot?.name || '연결 및 설정 변경 기록')}</p></details>`).join('')}</details>`;
}

function materialMetadata(record) {
  return `<div class="reference-chips"><span class="pill">${h(certaintyOptions.find(([key])=>key===record.data?.certainty)?.[1] || '상태 확인 필요')}</span><span class="pill">${h(disclosureOptions.find(([key])=>key===record.data?.disclosure)?.[1] || '공개 범위 미정')}</span>${record.data?.phase?`<span class="pill">${h(phaseOptions.find(([key])=>key===record.data.phase)?.[1]||'시점 미정')}</span>`:''}</div>`;
}

function controlFor(f,value,disabled=false) {
  const attrs=disabled?'disabled':'';
  if(f.key==='time')return `<div class="story-time-controls">${select('time_mode',[['unknown','시점 미정'],['absolute','확정 연도'],['range','기간']],value?.mode||'unknown').replace('<select ',disabled?'<select disabled ':'<select ')}${input('time_year',value?.year??'',`type="number" aria-label="확정 연도" placeholder="연도" ${attrs}`)}${input('time_start',value?.start??'',`type="number" aria-label="기간 시작" placeholder="시작 · 미정은 빈칸" ${attrs}`)}${input('time_end',value?.end??'',`type="number" aria-label="기간 종료" placeholder="종료 · 미정은 빈칸" ${attrs}`)}</div>`;
  return ['description','goals','activities','condition','ideology','notes'].includes(f.key) ? area(f.key,textValue(value),attrs) : input(f.key,textValue(value),attrs);
}

export function renderWorkProfile(projection, draft = null) {
  const values = {...projection.values,...projection.overrides,...(draft?.overrides||{})}, inherited = new Set(draft?.inherit_fields||[]), overrides=draft?draft.overrides||{}:projection.overrides||{}, notes=draft?.override_notes||projection.override_notes||{};
  return `<form data-story-form="profile"><h3>이 작품에서만 수정</h3><p class="muted">공통값을 참조하거나 이 작품만의 값을 선택합니다. 행적과 당시 상태는 다른 작품에 덮어쓰지 않습니다.</p>${WORK_FIELDS.map(f=>{
    const override=Object.hasOwn(overrides,f.key)&&!inherited.has(f.key);
    return `<section class="story-profile-field" data-profile-field="${h(f.key)}"><div class="section-title"><strong>${h(f.label)}</strong>${select('mode_'+f.key,[['common','공통값 사용'],['override','이 작품에서만 수정']],override?'override':'common')}</div><div class="story-profile-control">${controlFor(f,values[f.key],!override)}</div><p class="muted small-text">공통값: ${h(textValue(commonValue(projection.common,f.key)) || '미정')}</p>${input('note_'+f.key,notes[f.key]||'',`placeholder="공통값과 다른 이유 · 선택 사항" aria-label="${h(f.label)} 재정의 메모"`)}</section>`;
  }).join('')}<div class="form-actions"><span class="muted">빈 항목은 나중에 작성할 수 있습니다.</span><button type="submit" class="button primary">작품별 정보 저장</button></div></form>`;
}

export function mountStoryWorkspace(root, ctx) {
  let disposed=false, busy=false, section=ctx.section||'overview', selected='', characterId='', query='', projection=null, preview=null, candidateQuery='', conflict=null, recordBase=null, pending=Promise.resolve();
  const workId=ctx.document.id, drafts=ctx.drafts||{};
  const state=()=>ctx.getState?.()||ctx.state;
  const work=()=>state().documents.find(row=>row.id===workId)||ctx.document;
  const entity=id=>state().entities.find(row=>row.id===id);
  const draftKey=()=>`story-workspace:${workId}:${section}:${characterId||selected||'overview'}`;
  const persist=()=>ctx.persistDrafts?.();
  const status=text=>ctx.onStatus?.(text);
  const path=suffix=>`/work-characters/${enc(characterId)}/${enc(workId)}${suffix}`;
  function request(path,method='GET',body){const flight=ctx.api(path,method,body);if(['POST','PATCH','PUT','DELETE'].includes(method))pending=flight.catch(()=>{});return flight;}
  const envelope=p=>({expected_write_revision:p.expected_write_revision,revisions:copy(p.revisions)});
  const guard=fn=>async event=>{if(event?.type==='submit')event.preventDefault();if(busy)return;busy=true;try{await fn(event);}catch(error){status('저장 실패 · 초안 보존');ctx.onError?.(error);const el=root.querySelector('[data-story-error]');if(el)el.textContent=error.message;}finally{busy=false;}};
  const changed=async()=>{await ctx.onChanged?.();};
  const stage=value=>{
    const draft=drafts[draftKey()]||{},kind=value.common?'common':value.profile?'profile':section==='overview'?'overview':'material';
    draft.bases ||= {};
    if(!draft.bases[kind])draft.bases[kind]=characterId?{...envelope(projection),values:copy(projection.values),common_values:Object.fromEntries(COMMON_FIELDS.map(f=>[f.key,commonValue(projection.common,f.key)]))}:{revision:(recordBase||(selected&&selected!=='new'?entity(selected):work()))?.revision};
    draft.last_kind=kind;Object.assign(draft,value);drafts[draftKey()]=draft;persist();status('미저장 변경사항 · 초안 보관 중');
  };
  const clearDraft=(kind,key=draftKey())=>{
    const draft=drafts[key];
    if(!kind||!draft||!['common','profile'].includes(kind))delete drafts[key];
    else{delete draft[kind];delete draft.bases?.[kind];delete draft.conflict;if(!draft.common&&!draft.profile)delete drafts[key];else draft.last_kind=draft.common?'common':'profile';}
    persist();conflict=null;
  };
  function mutationEnvelope(kind){return envelope(drafts[draftKey()]?.bases?.[kind]||projection);}
  function restoredConflict(){
    if(conflict)return;
    const draft=drafts[draftKey()],kind=draft?.last_kind,base=draft?.bases?.[kind];if(!base)return;
    const current=characterId?projection:selected&&selected!=='new'?entity(selected):work();if(!current)return;
    const stale=characterId?base.expected_write_revision!==current.expected_write_revision||JSON.stringify(base.revisions)!==JSON.stringify(current.revisions):base.revision!==current.revision;
    if(!stale)return;
    const fields=kind==='common'?COMMON_FIELDS:kind==='profile'?profileComparisonFields:kind==='overview'?overviewComparisonFields:materialComparisonFields;
    conflict={kind,fields,latest:copy(current),before:characterId?kind==='common'?Object.fromEntries(COMMON_FIELDS.map(f=>[f.key,commonValue(current.common,f.key)])):profileComparisonValues(current):recordComparisonValues(current,kind),after:kind==='common'?draft.common:kind==='profile'?profileComparisonValues(current,draft.profile):draft.fields};
  }
  async function loadCharacter(id){characterId=id;selected='';projection=await request(`/work-characters/${enc(id)}/${enc(workId)}`);preview=null;conflict=null;draw();}
  const fieldName=id=>{const scoped=active(state(),'relations').some(r=>r.type==='work_appearance'&&r.source_id===id&&r.target_id===workId);return (scoped?resolveWorkCharacter(state(),id,workId).values.name:null)||entity(id)?.name||state().documents.find(x=>x.id===id)?.name||'연결 자료';};
  function relationList(id=null) {
    const relations=active(state(),'relations').filter(r=>(r.data?.work_id===workId||r.target_id===workId)&&!['work_appearance','identity_link','honor_assignment'].includes(r.type)&&(!id||r.source_id===id||r.target_id===id));
    return relations.map(r=>`<div class="story-relation"><div><button type="button" class="text-link" data-story-action="jump-record" data-story-id="${h(r.source_id)}">${h(fieldName(r.source_id))}</button><span> → ${h(r.data?.label||r.type)} → </span><button type="button" class="text-link" data-story-action="jump-record" data-story-id="${h(r.target_id)}">${h(fieldName(r.target_id))}</button>${r.data?.note?`<p>${h(r.data.note)}</p>`:''}</div>${button('관계 편집','edit-relation',r.id)}</div>`).join('')||empty('연결된 사건·관계·사상 기록이 없습니다.');
  }
  function overview() {
    const d=work(), draft=drafts[draftKey()]?.fields||{}, values={name:d.name,overview:d.data?.overview??d.description??'',form:d.data?.form||'외전',era_region:d.data?.era_region||'',notes:d.data?.notes||'',...draft};recordBase ||= copy(d);
    return `<form data-story-form="overview"><div class="story-form-grid">${field('작품명',input('name',values.name,'required'))}${field('제목 상태',select('provisional_title',[['true','가제'],['false','정식 제목']],String(draft.provisional_title??d.data?.provisional_title??false)))}${field('작품 형태',input('form',values.form))}${field('세대·정확한 시대·지역',input('era_region',values.era_region,'placeholder="미정 · 본편 세대에 자동 배치하지 않습니다"'))}${field('작품 개요',area('overview',values.overview),true)}${field('작품 메모',area('notes',values.notes),true)}</div><p class="callout">제목을 바꾸어도 작품과 인물의 연결은 유지됩니다. 설정 편집은 원고 본문을 변경하지 않습니다.</p><div class="form-actions"><span class="muted">${drafts[draftKey()]?'보관한 미저장 초안이 있습니다.':'변경사항은 서버에 저장됩니다.'}</span><button type="submit" class="button primary">작품 개요 저장</button></div></form>${sourceMarkup(d,state(),'documents')}`;
  }
  function characterList(){
    const list=searchStoryCharacters(state(),workId,query);
    return `<div class="story-toolbar"><label class="story-search">인물 검색<input data-story-search="characters" value="${h(query)}" placeholder="이름 · 영문명 · 별칭 · 칭호 · 직역"></label>${button('+ 인물 등록','new-character','','primary small')}</div><div class="story-character-layout"><div class="story-character-list" aria-label="작품 인물 · 알파벳순">${list.map(p=>`<button type="button" class="story-character-row ${p.localId===characterId?'active':''}" data-story-action="character" data-story-id="${h(p.localId)}"><span class="story-honor">${h(p.letters.join(' / ')||'—')}</span><span><strong>${h(p.values.name)}</strong><small>${h(p.values.english_name||'영문명 미정')} · ${h(p.values.occupation||p.values.role||'직역 미정')}</small></span></button>`).join('')||empty('검색된 인물이 없습니다.')}</div><div class="story-character-detail">${characterId?characterDetail():empty('인물을 선택하면 공통 정보와 이 작품의 설정을 편집할 수 있습니다.')}</div></div>`;
  }
  function characterDetail(){
    if(!projection)return empty('인물 정보를 불러오는 중입니다.');
    const p=projection,draft=drafts[draftKey()]||{}, commonValues={...Object.fromEntries(COMMON_FIELDS.map(f=>[f.key,commonValue(p.common,f.key)])),...(draft.common||{})};
    const works=(p.affectedWorks||[]).map(w=>w.name||fieldName(w.id)).join(' · ');
    const assignments=active(state(),'relations').filter(r=>r.type==='honor_assignment'&&r.source_id===characterId&&r.data?.work_id===workId);
    const honors=assignments.map(r=>`${entity(r.target_id)?.data?.honor_letter||''} · ${assignmentStatusOptions.find(([key])=>key===r.data?.status)?.[1]||'배정 시점·보유 여부 미정'}`).join(' / ');
    return `${draft.common||draft.profile?`<p class="callout">보관된 미저장 인물 정보가 있습니다. 연결·해제·공통 반영 전에 저장하거나 서버 내용을 사용하세요. ${button('서버 내용 사용','discard')}</p>`:''}<header class="story-character-heading"><h3>${h(p.values?.name||p.local?.name)}</h3><p>${h(p.values?.english_name||'')}</p>${honors?`<p class="muted">칭호 ${h(honors)}</p>`:''}${p.identity?`<p class="callout">본편의 ${h(p.common?.name)}과 같은 공통 정보를 참조합니다. 작품별 재정의값과 기존 사건 연결은 유지됩니다.</p>`:''}</header>${assignments.map(r=>`<div class="story-honor-edit"><span>${h(entity(r.target_id)?.data?.honor_letter||'칭호')} · ${h(r.data?.note||'배정 시점 미정')}</span>${button('칭호 배정 편집','edit-honor',r.id)}</div>`).join('')}<div class="actions story-character-actions">${p.identity?'':button('본편 인물 연결','find-main',characterId)}${p.identity?button('본편 연결 해제','unlink',characterId):''}${p.common?.id!==p.local?.id?button('본편 인물 열기','open-main',p.common.id):''}</div><details class="story-common-editor" ${draft.common?'open':''}><summary>공통 정보 수정</summary><p class="callout">공통값을 사용하는 작품에 반영됩니다. 작품별 재정의는 보존됩니다.<br>영향을 받는 작품: ${h(works||work().name)}</p><form data-story-form="common"><div class="story-form-grid">${COMMON_FIELDS.map(f=>field(f.label,controlFor(f,commonValues[f.key]),f.key==='description')).join('')}</div><div class="form-actions"><span class="muted">모든 작품의 본문을 덮어쓰지 않습니다.</span><button type="submit" class="button primary">공통 정보 저장</button></div></form></details>${renderWorkProfile(p,draft.profile)}<details class="story-promote"><summary>공통 정보에 반영</summary><p class="muted">선택한 작품별 값을 공통 정보로 올립니다. 변경 전후를 확인한 뒤 적용하세요.</p><form data-story-form="promote">${COMMON_FIELDS.map(f=>`<label class="checkbox-row"><input type="checkbox" name="promote_fields" value="${h(f.key)}">${h(f.label)} · ${h(textValue(p.values?.[f.key]))||'빈 값'}</label>`).join('')}<button type="submit" class="button ghost small">선택한 정보 비교</button></form></details><section><h3>연결된 사건·관계·사상</h3>${relationList(characterId)}</section><section><h3>다른 작품의 등장 정보</h3><div class="reference-chips">${(p.affectedWorks||[]).map(w=>button(w.name||fieldName(w.id),'open-work',w.id)).join('')||empty('다른 작품 연결은 아직 없습니다.')}</div></section>${sourceMarkup(p.local,state())}${preview?identityPanel():''}`;
  }
  function identityPanel(){
    if(preview.mode==='promote')return `<section class="story-identity-panel"><h3>공통 정보 반영 전 확인</h3>${fieldComparison(COMMON_FIELDS.filter(f=>preview.fields.includes(f.key)),preview.before,preview.after)}<label class="checkbox-row"><input type="checkbox" data-story-confirm>영향을 받는 작품과 변경 전후를 확인했습니다.</label>${button('공통 정보에 반영','apply-promote','','primary small')}${button('취소','close-identity')}</section>`;
    const candidates=mainCharacterCandidates(state(),candidateQuery);
    return `<section class="story-identity-panel" aria-label="본편 인물 연결 비교"><h3>본편 인물 연결</h3>${preview.notice?`<p class="conflict" role="alert">${h(preview.notice)}</p>`:''}<p class="muted">이름이나 칭호가 같아도 자동으로 동일인으로 합치지 않습니다. 본편 인물과 기존 작품 정보를 비교해 선택하세요.</p><label class="story-search">본편 인물 검색<input data-story-search="main" value="${h(candidateQuery)}" placeholder="이름 · 영문명 · 별칭"></label><div class="story-candidate-list">${candidates.map(c=>`<div class="story-candidate"><div><strong>${h(c.name)} ${h(c.data?.english_name||'')}</strong><p>${h(c.description||'기본 설명 미정')}</p><small>${h((c.works||c.affectedWorks||[]).map(w=>w.name||fieldName(w.id)).join(' · ')||'본편 등장 정보')}</small></div>${button('이 인물과 비교','compare-main',c.id)}</div>`).join('')||empty('검색된 본편 인물이 없습니다. 동일성이 확인되지 않은 인물은 외전 인물로 유지할 수 있습니다.')}</div>${preview.target?`<form data-story-form="identity"><h4>${h(preview.target.name)}과 공통값 비교</h4><p class="muted">단순 연결입니다. 기존 인물 원본이나 사건·관계의 대상을 삭제하거나 병합하지 않습니다.</p><div class="story-comparison-scroll"><table class="story-comparison"><thead><tr><th>항목</th><th>외전 공통값</th><th>본편 공통값</th><th>연결 후 사용할 값</th></tr></thead><tbody>${COMMON_FIELDS.map(f=>{
      const clash=(preview.conflicts||[]).some(c=>c.field===f.key);return `<tr><th>${h(f.label)}</th><td><pre>${h(textValue(preview.local_values?.[f.key]??commonValue(preview.local,f.key)))}</pre></td><td><pre>${h(textValue(preview.common_values?.[f.key]??commonValue(preview.target,f.key)))}</pre></td><td>${clash?`<label><input type="radio" name="choice_${h(f.key)}" value="common" required> 본편값</label><label><input type="radio" name="choice_${h(f.key)}" value="local" required> 외전값</label>`:'같은 값 · 유지'}</td></tr>`;
    }).join('')}</tbody></table></div><p class="callout">공통값 영향 작품: ${h((preview.affectedWorks||[]).map(w=>w.name||fieldName(w.id)).join(' · ')||'선택한 인물의 등장 작품')}</p><label class="checkbox-row"><input type="checkbox" name="identity_confirm" required>동일 인물임을 확인했으며 선택한 공통값으로 연결합니다.</label><button type="submit" class="button primary">연결 결과 저장</button></form>`:''}${button('비교 닫기','close-identity')}</section>`;
  }
  function materials(){
    const records=storyMaterials(state(),workId,section),r=records.find(x=>x.id===selected);
    if(!r&&selected!=='new')recordBase=null;
    return `<div class="story-toolbar"><p class="muted">${section==='ideas'?'사상 설정·참고 담론을 관리합니다. 사상집 원고를 자동 집필하지 않습니다.':section==='events'?'사건·현재 상황·목표를 구분합니다. 목록 순서는 확정 연대나 장면 순서가 아닙니다.':'확정 여부와 공개 여부는 별도로 관리합니다.'}</p>${button('+ 자료 추가','new-material','','primary small')}</div><div class="story-material-layout"><div class="story-material-list">${records.map(x=>`<button type="button" class="story-material-row ${selected===x.id?'active':''}" data-story-action="material" data-story-id="${h(x.id)}"><strong>${x.data?.original_number?`${h(x.data.original_number)}. `:''}${h(x.name)}</strong><small>${h(x.data?.category||certaintyOptions.find(([k])=>k===x.data?.certainty)?.[1]||'상태 확인 필요')}</small></button>`).join('')||empty('등록된 자료가 없습니다. 확인하지 못한 원문 내용은 임의로 채우지 않습니다.')}</div><div>${r||selected==='new'?materialEditor(r):empty('자료를 선택하면 내용과 확정·공개 상태를 읽고 수정할 수 있습니다.')}</div></div>${section==='events'?`<section class="story-relations-panel"><div class="section-title"><h3>작품의 연결 관계</h3>${button('+ 관계 연결','new-relation')}</div>${relationList()}</section>`:''}${section==='review'?`<p class="callout">이전 설정은 최신 확정 설정으로 구분해 보관합니다. Library 원문을 확보하지 못한 자료와 담론은 미확인으로 남기며 확정 사실로 입력하지 않습니다.</p>`:''}`;
  }
  function materialEditor(r){
    recordBase ||= r?copy(r):null;const draft=drafts[draftKey()]?.fields||{},d=r?.data||{},v={name:r?.name||'',description:r?.description||'',certainty:d.certainty||'user_confirmed',disclosure:d.disclosure||'public',phase:d.phase||'undecided',source_label:d.source?.label||'',source_note:d.source?.note||'',...draft};
    return `${r?materialMetadata(r):''}<form data-story-form="material"><div class="story-form-grid">${field('자료명',input('name',v.name,'required'),true)}${field('설정·내용',area('description',v.description,'rows="12"'),true)}${field('확정 상태',select('certainty',certaintyOptions,v.certainty))}${field('공개 범위',select('disclosure',disclosureOptions,v.disclosure))}${section==='events'?field('사건·상황 구분',select('phase',phaseOptions,v.phase)):''}${field('출처 표시',input('source_label',v.source_label))}${field('출처·검토 메모',area('source_note',v.source_note),true)}</div><div class="form-actions"><span class="muted">현재 작품의 설정만 변경합니다.</span><button type="submit" class="button primary">자료 저장</button></div></form>${r?`<section><h3>관련 인물·사건·사상</h3>${relationList(r.id)}${button('+ 관계 연결','new-relation',r.id)}</section>${sourceMarkup(r,state())}`:''}`;
  }
  function conflictPanel(){
    if(!conflict)return '';
    return `<section class="story-conflict conflict" role="alert"><h3>다른 화면의 최신 수정과 충돌했습니다</h3><p>내 초안을 보존했습니다. 최신값과 비교한 뒤 다시 적용하거나 서버 내용을 사용하세요.</p>${fieldComparison(conflict.fields,conflict.before,conflict.after)}<label class="checkbox-row"><input type="checkbox" data-story-confirm>최신 내용과 차이를 확인했습니다.</label><div class="actions">${button('비교 후 내 수정 다시 적용','reapply','','primary small')}${button('서버 내용 사용','discard','','ghost small')}</div></section>`;
  }
  function draw(){
    if(disposed)return;
    restoredConflict();
    root.innerHTML=`<section class="story-workspace" aria-label="${h(work().name)} 설정 관리"><nav class="story-section-tabs" aria-label="외전 설정 메뉴">${STORY_SECTIONS.map(([id,label])=>`<button type="button" class="button ${id===section?'active':'ghost'}" data-story-action="section" data-story-id="${id}" aria-current="${id===section?'page':'false'}">${label}</button>`).join('')}</nav><p class="story-work-status muted">${h(work().data?.form||'외전')} · ${work().data?.provisional_title?'가제 · ':''}세대 ${h(work().data?.generation_id?fieldName(work().data.generation_id):'미정')} · 시대·지역 ${h(work().data?.era_region||'미정')}</p><p data-story-error class="story-error" role="alert"></p>${conflictPanel()}<div class="story-work-content">${section==='overview'?overview():section==='characters'?characterList():materials()}</div><div data-story-modal></div></section>`;
    bind();
  }
  function readFields(form){const result={};for(const [key,value]of new FormData(form).entries())result[key]=String(value);return result;}
  async function saveWithConflict(fn, details){
    if(conflict)throw Error('보관된 초안이 최신 상태와 다릅니다. 위 비교 화면에서 먼저 다시 적용하거나 서버 내용을 사용하세요.');
    const savingKey=draftKey();
    try{await fn();clearDraft(details.kind,savingKey);if(details.kind==='promote')preview=null;await changed();projection=characterId?await request(path('')):null;recordBase=null;status('모든 변경사항 저장됨');draw();}
    catch(error){
      if(error.status===409){
        await changed();const fresh=characterId?await request(path('')):selected&&selected!=='new'?entity(selected):work();
        const commonFields=characterId&&['common','promote'].includes(details.kind);
        conflict={...details,latest:fresh,before:characterId?commonFields?Object.fromEntries(COMMON_FIELDS.map(f=>[f.key,commonValue(fresh.common,f.key)])):profileComparisonValues(fresh):recordComparisonValues(fresh,details.kind),after:details.kind==='promote'?fresh.values:details.kind==='profile'?profileComparisonValues(fresh,details.profile_payload):details.after};
        if(details.kind==='promote')preview=null;
        drafts[draftKey()]={...(drafts[draftKey()]||{}),conflict:true};persist();status('저장 충돌 · 초안 보존');draw();return;
      }
      throw error;
    }
  }
  function bind(){
    root.onclick=guard(async event=>{
      const b=event.target.closest('[data-story-action]');if(!b||!root.contains(b))return;const action=b.dataset.storyAction,id=b.dataset.storyId;
      if(action==='section'){section=id;selected='';characterId='';projection=null;recordBase=null;preview=null;conflict=null;draw();}
      else if(action==='character')await loadCharacter(id);
      else if(action==='material'){selected=id;recordBase=null;conflict=null;draw();}
      else if(action==='new-material'){selected='new';recordBase=null;conflict=null;draw();}
      else if(action==='find-main'){if(drafts[draftKey()]?.common||drafts[draftKey()]?.profile)throw Error('미저장 인물 정보를 먼저 저장하거나 서버 내용을 사용한 뒤 연결하세요.');preview={};candidateQuery='';draw();root.querySelector('[data-story-search="main"]')?.focus();}
      else if(action==='compare-main'){preview=await request(path('/identity-preview')+'?target_id='+enc(id));draw();}
      else if(action==='close-identity'){preview=null;draw();}
      else if(action==='open-main')await ctx.openEntity?.(id);
      else if(action==='open-work'){const d=state().documents.find(x=>x.id===id);if(d)await ctx.openStory?.(id);else await ctx.openEntity?.(id);}
      else if(action==='jump-record'){const r=entity(id);if(!r)return;if(r.kind==='character'&&workCharacters(state(),workId).some(p=>(p.local?.id||p.id)===id)){section='characters';await loadCharacter(id);}else if(r.data?.work_id===workId&&r.data?.section){section=['research','research_discourses'].includes(r.data.section)?'ideas':r.data.section;selected=id;characterId='';recordBase=null;draw();}else await ctx.openEntity?.(id);}
      else if(action==='new-character')await newCharacter();
      else if(action==='edit-honor')honorEditor(state().relations.find(r=>r.id===id));
      else if(action==='new-relation'||action==='edit-relation')relationEditor(action==='edit-relation'?state().relations.find(x=>x.id===id):null,action==='new-relation'?id:'');
      else if(action==='unlink'){
        if(drafts[draftKey()]?.common||drafts[draftKey()]?.profile)throw Error('미저장 인물 정보를 먼저 저장하거나 서버 내용을 사용한 뒤 연결을 해제하세요.');
        if(!ctx.confirm?.('연결을 해제해도 이 외전에서 보던 정보와 사건·관계는 보존됩니다. 본편 원본과 다른 작품 연결은 변경하지 않습니다. 해제할까요?'))return;
        await saveWithConflict(()=>request(path('/identity-unlink'),'POST',envelope(projection)),{kind:'unlink',fields:COMMON_FIELDS,after:projection.values});
      }else if(action==='apply-promote'){
        if(!root.querySelector('[data-story-confirm]')?.checked)throw Error('변경 전후와 영향 작품을 먼저 확인하세요.');
        const fields=preview.fields;await saveWithConflict(()=>request(path('/promote'),'POST',{...envelope(projection),fields}),{kind:'promote',promotion_fields:copy(fields),fields:COMMON_FIELDS.filter(f=>fields.includes(f.key)),after:preview.after});preview=null;
      }else if(action==='discard'){clearDraft();projection=characterId?await request(path('')):null;recordBase=null;draw();}
      else if(action==='reapply'){
        if(!root.querySelector('[data-story-confirm]')?.checked)throw Error('최신 내용과 내 초안의 차이를 먼저 확인하세요.');
        const current=conflict;projection=characterId?current.latest:projection;recordBase=characterId?null:copy(current.latest);const draft=drafts[draftKey()];if(draft){draft.bases||={};draft.bases[current.kind]=characterId?{...envelope(current.latest),values:copy(current.latest.values)}:{revision:current.latest.revision};delete draft.conflict;persist();}conflict=null;
        const form=root.querySelector(`[data-story-form="${current.kind}"]`);
        if(current.kind==='promote'){const fields=copy(current.promotion_fields);await saveWithConflict(()=>request(path('/promote'),'POST',{...envelope(projection),fields}),{...current,after:projection.values});}
        else if(current.kind==='unlink'){await saveWithConflict(()=>request(path('/identity-unlink'),'POST',envelope(projection)),current);}
        else if(form)await submitForm(form,current.kind);else throw Error('수정 범위를 다시 열어 최신 상태와 비교해 주세요.');
      }
    });
    for(const form of root.querySelectorAll('[data-story-form]')){
      form.onsubmit=guard(async()=>submitForm(form,form.dataset.storyForm));
      form.oninput=()=>{
        const kind=form.dataset.storyForm;
        if(kind==='overview'||kind==='material')stage({fields:readFields(form)});
        else if(kind==='common')stage({common:readCommon(form)});
        else if(kind==='profile'){try{stage({profile:profileFormValues(form)});}catch{}}
      };
    }
    for(const input of root.querySelectorAll('[data-story-search]'))input.oninput=()=>{
      const kind=input.dataset.storySearch,value=input.value,pos=input.selectionStart;
      if(kind==='characters')query=value;else candidateQuery=value;draw();const current=root.querySelector(`[data-story-search="${kind}"]`);current?.focus();current?.setSelectionRange(pos,pos);
    };
    for(const control of root.querySelectorAll('[data-profile-field] select[name^="mode_"]'))control.onchange=()=>{
      const panel=control.closest('[data-profile-field]'),disabled=control.value!=='override';for(const input of panel.querySelectorAll('.story-profile-control input,.story-profile-control textarea,.story-profile-control select'))input.disabled=disabled;
      try{stage({profile:profileFormValues(control.closest('form'))});}catch{}
    };
  }
  function readCommon(form){const fd=new FormData(form);return Object.fromEntries(COMMON_FIELDS.map(f=>[f.key,f.key==='aliases'?String(fd.get(f.key)||'').split(',').map(v=>v.trim()).filter(Boolean):String(fd.get(f.key)||'')]));}
  async function submitForm(form,kind){
    if(kind==='overview'){
      const fields=readFields(form);stage({fields});const base=recordBase||work();const revision=drafts[draftKey()]?.bases?.overview?.revision??base.revision;
      return saveWithConflict(()=>request('/documents/'+enc(workId),'PATCH',{revision,name:fields.name.trim()||base.name,data:{...base.data,overview:fields.overview,provisional_title:fields.provisional_title==='true',form:fields.form,era_region:fields.era_region,notes:fields.notes}}),{kind,fields:overviewComparisonFields,after:fields});
    }
    if(kind==='material'){
      const fields=readFields(form);stage({fields});const base=recordBase,types={events:'event',world:'setting',ideas:'thought',review:'custom'};
      const data={...(base?.data||{}),work_id:workId,section:base?.data?.section||section,certainty:fields.certainty,disclosure:fields.disclosure,...(section==='events'?{phase:fields.phase}:{}),source:{...(base?.data?.source||{}),label:fields.source_label,note:fields.source_note}};
      return saveWithConflict(async()=>{const r=await request('/entities'+(base?'/'+enc(base.id):''),base?'PATCH':'POST',{...(base?{revision:drafts[draftKey()]?.bases?.material?.revision??base.revision}:{}),kind:base?.kind||types[section]||'custom',name:fields.name,description:fields.description,data});selected=r.id;},{kind,fields:materialComparisonFields,after:fields});
    }
    if(kind==='common'){const fields=readCommon(form);stage({common:fields});return saveWithConflict(()=>request(path('/common'),'PATCH',{...mutationEnvelope('common'),fields}),{kind,fields:COMMON_FIELDS,after:fields});}
    if(kind==='profile'){const payload=profileFormValues(form);stage({profile:payload});return saveWithConflict(()=>request(path('/profile'),'PATCH',{...mutationEnvelope('profile'),...payload}),{kind,fields:profileComparisonFields,profile_payload:copy(payload),after:profileComparisonValues(projection,payload)});}
    if(kind==='promote'){
      if(drafts[draftKey()]?.common||drafts[draftKey()]?.profile)throw Error('미저장 인물 정보를 먼저 저장한 뒤 공통 정보에 반영하세요.');
      const fields=new FormData(form).getAll('promote_fields');if(!fields.length)throw Error('공통 정보에 반영할 항목을 선택하세요.');
      preview={mode:'promote',fields,before:Object.fromEntries(COMMON_FIELDS.map(f=>[f.key,commonValue(projection.common,f.key)])),after:projection.values};draw();return;
    }
    if(kind==='identity'){
      const fd=new FormData(form);if(!fd.get('identity_confirm'))throw Error('동일 인물 여부와 공통값 선택을 확인하세요.');
      const field_choices={};for(const clash of preview.conflicts||[]){const choice=fd.get('choice_'+clash.field);if(!['common','local'].includes(choice))throw Error('충돌하는 공통 항목의 값을 모두 선택하세요.');field_choices[clash.field]=choice;}
      try{await request(path('/identity-link'),'POST',{...envelope(preview),target_id:preview.target.id,field_choices});clearDraft();await changed();projection=await request(path(''));preview=null;status('본편 인물 연결 저장됨');draw();}
      catch(error){if(error.status!==409)throw error;const target=preview.target.id;await changed();projection=await request(path(''));preview=await request(path('/identity-preview')+'?target_id='+enc(target));preview.notice='비교 이후 저장 내용이 바뀌었습니다. 아래 최신 본편값과 외전값을 다시 비교하고 충돌 항목을 새로 선택하세요. 자동으로 연결하지 않았습니다.';draw();status('연결 비교 충돌 · 다시 선택 필요');}
    }
  }
  async function newCharacter(){
    const context=await request('/works/'+enc(workId)+'/context');
    showModal('이 외전의 인물 등록',`<div class="story-form-grid">${field('이름',input('name','','placeholder="미정은 빈칸"'))}${field('영문명',input('english_name'))}${field('별칭',input('aliases','','placeholder="쉼표로 구분"'),true)}${field('기본 설명',area('description'),true)}${field('이 작품의 직역',input('occupation'),true)}</div><p class="muted">본편 출연자로 자동 등록하지 않습니다. 동일 인물 연결은 등록 후 직접 비교해 선택하세요.</p>`,async form=>{
      const common=readCommon(form);common.name=common.name.trim()||'이름 미정';const occupation=String(new FormData(form).get('occupation')||'');
      const r=await request('/works/'+enc(workId)+'/characters','POST',{...envelope(context),common,overrides:{occupation}});await changed();await loadCharacter(r.local?.id||r.character?.id||r.id);
    });
  }
  function honorEditor(record){
    if(!record)return;let base=copy(record);
    const honors=active(state(),'entities').filter(e=>e.data?.classification==='honor'&&e.data?.work_id===workId).sort((a,b)=>String(a.data.honor_letter).localeCompare(String(b.data.honor_letter)));
    const time=record.data?.time||record.start||{mode:'unknown'};
    showModal('칭호 배정 편집',`<p class="callout">칭호와 인물의 정체성은 별개입니다. 같은 칭호에 시점 미정의 여러 인물을 연결할 수 있습니다. 세습이나 취득 시점을 자동으로 만들지 않습니다.</p><div class="story-form-grid">${field('알파벳 칭호',select('honor_target',honors.map(e=>[e.id,e.data.honor_letter]),record.target_id))}${field('배정 상태',select('assignment_status',assignmentStatusOptions,record.data?.status||'undecided'))}${field('적용 시점',controlFor({key:'time'},time),true)}${field('배정·시점 메모',area('honor_note',record.data?.note||''),true)}</div>`,async form=>{
      const fd=new FormData(form),mode=fd.get('time_mode')||'unknown';let value={mode:'unknown'};
      if(mode==='absolute'){const raw=String(fd.get('time_year')||'').trim();if(!raw)throw Error('확정 연도를 입력하거나 시점 미정을 선택하세요.');value={mode,year:Number(raw)};}
      else if(mode==='range')value={mode,start:String(fd.get('time_start')||'').trim()?Number(fd.get('time_start')):null,end:String(fd.get('time_end')||'').trim()?Number(fd.get('time_end')):null};
      await request('/relations/'+enc(base.id),'PATCH',{revision:base.revision,target_id:fd.get('honor_target'),data:{...base.data,work_id:workId,status:fd.get('assignment_status'),honor_letter:honors.find(h=>h.id===fd.get('honor_target'))?.data?.honor_letter||'',time:value,note:fd.get('honor_note')}});await changed();projection=await request(path(''));draw();
    },async form=>{await changed();const latest=state().relations.find(r=>r.id===base.id),fd=new FormData(form);if(!latest||latest.deleted_at)throw Error('칭호 배정이 보관되거나 삭제되었습니다. 초안은 화면에 유지됩니다.');return{fields:[{key:'letter',label:'칭호'},{key:'status',label:'배정 상태'},{key:'time',label:'적용 시점'},{key:'note',label:'메모'}],before:{letter:entity(latest.target_id)?.data?.honor_letter,time:latest.data?.time||latest.start||{mode:'unknown'},status:assignmentStatusOptions.find(([k])=>k===latest.data?.status)?.[1]||'미정',note:latest.data?.note},after:{letter:entity(fd.get('honor_target'))?.data?.honor_letter,time:readEditorTime(fd),status:assignmentStatusOptions.find(([k])=>k===fd.get('assignment_status'))?.[1]||'미정',note:fd.get('honor_note')},apply:()=>{base=copy(latest);}};});
  }
  function relationEditor(record=null,from=''){
    let base=record?copy(record):null;
    const choices=active(state(),'entities').filter(e=>e.data?.work_id===workId||workCharacters(state(),workId).some(p=>p.local?.id===e.id));
    const options=selected=>`<option value="">대상을 선택하세요</option>${choices.map(e=>`<option value="${h(e.id)}" ${selected===e.id?'selected':''}>${h(e.name)}${e.data?.english_name?' · '+h(e.data.english_name):''}</option>`).join('')}`;
    showModal(record?'관계 편집':'관계 연결',`<div class="story-form-grid">${field('출발 자료',`<select name="source_id" required>${options(record?.source_id||from)}</select>`)}${field('도착 자료',`<select name="target_id" required>${options(record?.target_id)}</select>`)}${field('관계 설명',input('label',record?.data?.label||'','required'),true)}${field('작가가 아는 사실과 인물의 인지 범위',area('note',record?.data?.note||''),true)}</div>`,async form=>{
      const fd=new FormData(form);await request('/relations'+(base?'/'+enc(base.id):''),base?'PATCH':'POST',{...(base?{revision:base.revision}:{}),source_id:fd.get('source_id'),target_id:fd.get('target_id'),type:base?.type||'related',start:base?.start||{mode:'unknown'},data:{...(base?.data||{}),work_id:workId,label:fd.get('label'),note:fd.get('note')}});await changed();projection=characterId?await request(path('')):null;draw();
    },record?async form=>{await changed();const latest=state().relations.find(r=>r.id===base.id),fd=new FormData(form);if(!latest||latest.deleted_at)throw Error('관계가 보관되거나 삭제되었습니다. 초안은 화면에 유지됩니다.');return{fields:[{key:'source',label:'출발 자료'},{key:'target',label:'도착 자료'},{key:'label',label:'관계 설명'},{key:'note',label:'인지 범위·메모'}],before:{source:fieldName(latest.source_id),target:fieldName(latest.target_id),label:latest.data?.label,note:latest.data?.note},after:{source:fieldName(fd.get('source_id')),target:fieldName(fd.get('target_id')),label:fd.get('label'),note:fd.get('note')},apply:()=>{base=copy(latest);}};}:null);
  }
  function showModal(title,html,onSubmit,onConflict=null){
    const host=root.querySelector('[data-story-modal]');host.innerHTML=`<section class="story-inline-modal" role="dialog" aria-label="${h(title)}"><form><h3>${h(title)}</h3>${html}<p data-modal-error class="story-error" role="alert"></p><div data-modal-conflict></div><div class="actions"><button type="submit" class="button primary">저장</button><button type="button" class="button ghost" data-modal-close>취소</button></div></form></section>`;
    const form=host.querySelector('form');let conflictApply=null;
    form.onsubmit=guard(async()=>{
      try{
        if(conflictApply){if(!host.querySelector('[data-modal-confirm]')?.checked)throw Error('최신 내용과 내 수정의 차이를 먼저 확인하세요.');conflictApply();conflictApply=null;}
        await onSubmit(form);host.innerHTML='';
      }catch(error){
        host.querySelector('[data-modal-error]').textContent=error.message;
        if(error.status===409&&onConflict){const comparison=await onConflict(form);conflictApply=comparison.apply;host.querySelector('[data-modal-conflict]').innerHTML=`<div class="conflict"><p>다른 화면의 최신 변경과 충돌했습니다. 초안을 유지했습니다. 비교 후 저장 버튼을 다시 누르세요.</p>${fieldComparison(comparison.fields,comparison.before,comparison.after)}<label class="checkbox-row"><input type="checkbox" data-modal-confirm>최신 내용과 차이를 확인했고 내 수정을 다시 적용합니다.</label></div>`;return;}
        throw error;
      }
    });host.querySelector('[data-modal-close]').onclick=()=>{host.innerHTML='';};host.scrollIntoView?.({block:'nearest'});
  }
  draw();
  return {dispose(){disposed=true;},async flush(){await pending;},openCharacter:loadCharacter};
}
