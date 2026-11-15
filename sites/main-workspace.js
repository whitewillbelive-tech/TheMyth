import { CATALOG, PROFILE_FIELDS, catalogKey, catalogMarkerMatches, catalogStatus, appearancesFor, appearanceTitleId, generationForTitle, titleIdsForEntity, generationAppearanceId, generationAppearancesFor, generationAppearanceFor, generationIdsForCharacter } from '../web/main-domain.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (detail, status = 422) => { throw Object.assign(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)), { detail, status }); };
const normal = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const active = row => row && !row.deleted_at;
const fields = new Map(PROFILE_FIELDS.map(field => [field.key, field]));

function typedReference(store, id, kinds, activeReference = true) {
  if (id === null || id === '') return;
  if (typeof id !== 'string') fail('연결 대상 ID는 문자열 또는 미정이어야 합니다.');
  const target = store.existsReference(id, ['entities'], kinds);
  if (activeReference && target?.deleted_at) fail('휴지통의 자료는 새로운 작품별 설정에 연결할 수 없습니다.');
}
export function validateProfileFields(store, values, { rejectUnknown = false, activeReferences = true } = {}) {
  if (!object(values)) fail('작품별 개별 설정은 객체여야 합니다.');
  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    if (!field) { if (rejectUnknown) fail(`지원하지 않는 작품별 정보 항목: ${key}`); continue; }
    if (field.type === 'time') { store.time(value); continue; }
    if (field.type === 'id') { typedReference(store, value, field.kinds, activeReferences); continue; }
    if (field.type === 'aliases' || field.type === 'id-list') {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) fail(`${field.label}은 문자열 목록이어야 합니다.`);
      if (field.type === 'id-list') {
        if (new Set(value).size !== value.length) fail(`${field.label}에 중복 연결이 있습니다.`);
        for (const id of value) { if (!id) fail('빈 연결 ID는 사용할 수 없습니다.'); typedReference(store, id, field.kinds, activeReferences); }
      }
    } else if (typeof value !== 'string') fail(`${field.label}은 텍스트여야 합니다.`);
  }
}

// Only records carrying the new optional profile schema use its new validation.
// Older backups and version snapshots continue to use their original contract.
export function validateWorkspaceRecord(store, table, record) {
  if(table==='relations'&&(record.type==='generation_appearance'||record.data?.generation_schema===1)) {
    if(!generationAppearanceId(store.state(),record))fail('세대별 정보는 하나의 인물과 세대를 연결해야 합니다.');
    validateGenerationSettings(store,record.data,{activeReferences:false});
  }
  if (table === 'relations' && record.data?.profile_schema === 1) {
    const state = store.state(), titleId = appearanceTitleId(state, record);
    if (!titleId) fail('작품별 설정은 하나의 인물과 타이틀을 연결해야 합니다.');
    validateProfileFields(store, record.data.overrides ?? {}, { activeReferences: false });
    if (!Array.isArray(record.data.inherit_fields ?? []) || (record.data.inherit_fields ?? []).some(key => !fields.has(key))) fail('공통 설정 상속 항목이 잘못되었습니다.');
  }
}
export function validateWorkspaceMutation(store, table, record, previous = null) {
  if (table === 'entities') {
    if (record.kind === 'character') {
      const common = Object.fromEntries(PROFILE_FIELDS.filter(field => !['name', 'description'].includes(field.key) && Object.hasOwn(record.data ?? {}, field.key) && (!previous || JSON.stringify(previous.data?.[field.key]) !== JSON.stringify(record.data[field.key]))).map(field => [field.key, record.data[field.key]]));
      // The original generic entity API accepted a comma-separated aliases
      // string. Keep that legacy representation readable and round-trippable.
      if (typeof common.aliases === 'string') delete common.aliases;
      validateProfileFields(store, common);
      for(const key of ['ideology','primary_power','character_narrative'])if(Object.hasOwn(record.data??{},key)&&(!previous||JSON.stringify(previous.data?.[key])!==JSON.stringify(record.data[key]))&&record.data[key]!==null&&typeof record.data[key]!=='string')fail(`${key}는 텍스트 또는 미정이어야 합니다.`);
      if(Object.hasOwn(record.data??{},'mbti')&&(!previous||JSON.stringify(previous.data?.mbti)!==JSON.stringify(record.data.mbti)))validateMbti(record.data.mbti);
    }
    if (record.kind === 'event' && record.data?.title_id && (!previous || previous.data?.title_id !== record.data.title_id || previous.data?.generation_id !== record.data.generation_id)) {
      const title = store.existsReference(record.data.title_id, ['entities'], ['title']);
      if (title.deleted_at) fail('사건의 소속 타이틀이 휴지통에 있습니다.');
      if (record.data.generation_id && record.data.generation_id !== title.data?.generation_id) fail('사건의 세대와 소속 타이틀의 세대가 다릅니다.');
    }
  }
  if (table !== 'relations') return;
  if(record.type==='generation_appearance')validateGenerationSettings(store,record.data,{previous:previous?.data??{}});
  const a = store.get('entities', record.source_id, false), b = store.get('entities', record.target_id, false);
  const changedLink = !previous || previous.source_id !== record.source_id || previous.target_id !== record.target_id || previous.type !== record.type;
  if (!changedLink) return; // Preserve legacy links when editing their notes.
  if (['causes', 'caused_by'].includes(record.type) && (a?.kind === 'event' || b?.kind === 'event') && !(a?.kind === 'event' && b?.kind === 'event')) fail('원인·결과 사건 연결은 양쪽 모두 사건이어야 합니다.');
  if (a?.kind !== 'event' || b?.kind !== 'event' || !['related', 'before', 'after', 'precedes', 'follows', 'causes', 'caused_by'].includes(record.type)) return;
  const state = store.state();
  const ag = new Set(titleIdsForEntity(state, a).map(id => generationForTitle(state, id)?.id).filter(Boolean));
  const bg = new Set(titleIdsForEntity(state, b).map(id => generationForTitle(state, id)?.id).filter(Boolean));
  if (ag.size && bg.size && ![...ag].some(id => bg.has(id))) fail('사건은 같은 세대의 타이틀 사이에서 연결할 수 있습니다. 기존 사건과 관계는 유지됩니다.');
}

export function validateMbti(value) {
  if(value===null||value===undefined)return;
  if(!object(value))fail('MBTI는 네 성향 축의 비율 객체여야 합니다.');
  for(const [key,number] of Object.entries(value)) {
    if(!['ei','sn','tf','jp'].includes(key))fail('지원하지 않는 MBTI 성향 축입니다.');
    if(number!==null&&(typeof number!=='number'||!Number.isFinite(number)||number<0||number>100))fail('MBTI 비율은 0부터 100 사이의 숫자 또는 미정이어야 합니다.');
  }
}
export function validateGenerationSettings(store, data, {activeReferences=true,previous={}}={}) {
  if(!object(data))fail('세대별 정보는 객체여야 합니다.');
  for(const key of ['ideology_rank','narrative'])if(data[key]!==undefined&&data[key]!==null&&typeof data[key]!=='string')fail('사상 등급과 개별 서사는 텍스트여야 합니다.');
  if(data.affiliations!==undefined&&data.affiliations!==null) {
    if(!Array.isArray(data.affiliations))fail('소속은 연결 목록이어야 합니다.');
    const seen=new Set();
    for(const ref of data.affiliations) {
      if(!object(ref)||!['entities','groups'].includes(ref.collection)||typeof ref.id!=='string'||!ref.id)fail('소속의 종류와 고유 ID를 확인하세요.');
      const key=ref.collection+':'+ref.id;if(seen.has(key))fail('같은 소속이 중복 선택되었습니다.');seen.add(key);
      const target=store.existsReference(ref.id,[ref.collection],ref.collection==='entities'?['organization','civilization']:null);
      if(activeReferences&&target.deleted_at&&!(previous.affiliations??[]).some(old=>old.collection===ref.collection&&old.id===ref.id))fail('보관된 소속을 새로 연결할 수 없습니다.');
    }
  }
}
function normalizedGenerationSettings(store, supplied={}, previous={}) {
  if(!object(supplied))fail('세대별 정보는 객체여야 합니다.');
  validateGenerationSettings(store,supplied,{previous});
  const patch={};
  for(const key of ['affiliations','ideology_rank','narrative'])if(Object.hasOwn(supplied,key))patch[key]=structuredClone(supplied[key]??(key==='affiliations'?[]:''));
  return patch;
}

function moveTitleGenerationReferences(store, titleId, oldGenerationId, newGenerationId) {
  const updated=[];
  for(const collection of ['entities','relations','states','documents','chapters','groups','memberships']) for(const record of store.all(collection)) {
    if(!record.data?.generation_id || record.id===titleId)continue;
    const primary=record.data.title_id===titleId, multiple=Array.isArray(record.data.title_ids)&&record.data.title_ids.includes(titleId);
    if(!primary&&!multiple)continue;
    if(record.data.generation_id!==oldGenerationId&&record.data.generation_id!==newGenerationId)fail({message:'체라 참조의 기존 세대 정보가 일치하지 않습니다. 원본을 보존하고 이동을 중단합니다.',collection,id:record.id},409);
    if(multiple&&!primary&&record.data.title_ids.some(id=>id!==titleId&&generationForTitle(store.state(),id)?.id!==newGenerationId))fail({message:'여러 세대의 작품이 한 세대 참조에 함께 연결되어 있습니다. 이동 범위를 먼저 확인하세요.',collection,id:record.id},409);
    if(record.data.generation_id===oldGenerationId) {
      store.update(collection,record.id,{data:{...record.data,generation_id:newGenerationId}},'체라 소속 세대 이전 전');updated.push({collection,id:record.id});
    }
  }
  return updated;
}
export function reconcileCatalog(store) {
  const before = catalogStatus(store.state());
  if (before.conflicts.length) fail({ message: '기존 세대·타이틀 ID의 중복을 먼저 확인하세요.', conflicts: before.conflicts }, 409);
  const created_ids = [], updated_ids = [], resultGenerations = [], resultTitles = [], moved_references=[];
  const entities = () => store.all('entities');
  // Resolve every generation first, so moving an existing title never needs a
  // temporary duplicate or a fabricated generation ID.
  for (const spec of CATALOG) {
    const key = catalogKey(spec.number), tagged=entities().filter(row=>row.kind==='generation'&&row.data?.catalog_key===key);
    let generation=tagged[0];
    if(!generation) {
      const candidates=entities().filter(row=>row.kind==='generation'&&row.data?.number===spec.number);
      if(candidates.length>1)fail({message:`${spec.number}세대 객체가 여러 개입니다. 자동 병합하지 않습니다.`,ids:candidates.map(row=>row.id)},409);
      generation=candidates[0];
      if(generation?.deleted_at)fail({message:`${spec.number}세대가 휴지통에 있습니다. 기존 ID를 복원한 뒤 등록하세요.`,id:generation.id},409);
      if(generation){generation=store.update('entities',generation.id,{name:spec.name,sort_order:spec.number-1,data:{...generation.data,number:spec.number,catalog_key:key}},'본편 세대 체계 갱신 전');updated_ids.push(generation.id);}
      else {generation=store.create('entities',{kind:'generation',name:spec.name,sort_order:spec.number-1,data:{number:spec.number,catalog_key:key}});created_ids.push(generation.id);}
    }
    resultGenerations.push(generation);
  }
  for(const spec of CATALOG) {
    const generation=resultGenerations.find(row=>row.data.number===spec.number);
    for(const [index,name] of spec.titles.entries()) {
      const key=catalogKey(spec.number,name), marked=entities().filter(row=>row.kind==='title'&&catalogMarkerMatches(row,spec.number,name));
      if(marked.length>1)fail({message:`${name} 등록 표식이 중복되었습니다.`,ids:marked.map(row=>row.id)},409);
      let title=marked[0];
      if(name==='체라'&&spec.number===3) {
        const candidates=entities().filter(row=>row.kind==='title'&&(row.data?.catalog_key===catalogKey(2,'체라')||row.data?.catalog_key===key||row.data?.catalog_key_v2===key||normal(row.name)==='체라'));
        if(candidates.length>1)fail({message:'체라 타이틀이 중복되어 기존 ID를 결정할 수 없습니다.',ids:candidates.map(row=>row.id)},409);
        const existing=candidates[0];
        if(existing) {
          title=existing;
          if(Object.hasOwn(existing.data??{},'catalog_key_v2')&&existing.data.catalog_key_v2!==key)fail({message:'체라의 기존 확장 등록 표식과 충돌합니다. 사용자 값을 덮어쓰지 않습니다.',id:existing.id},409);
          if(existing.data?.generation_id!==generation.id||!catalogMarkerMatches(existing,spec.number,name)) {
            if(existing.deleted_at)fail({message:'보관된 체라 타이틀의 이동은 기존 기록을 확인한 뒤 진행하세요.',id:existing.id},409);
            const oldGeneration=resultGenerations.find(row=>row.data.number===2);
            if(existing.data?.generation_id&&existing.data.generation_id!==oldGeneration.id&&existing.data.generation_id!==generation.id)fail({message:'체라의 소속 세대가 예상과 다릅니다. 사용자 설정을 덮어쓰지 않습니다.',id:existing.id},409);
            title=store.update('entities',existing.id,{sort_order:index,data:{...existing.data,generation_id:generation.id,catalog_key:catalogKey(2,'체라'),catalog_key_v2:key}},'체라 3세대 이동 전');updated_ids.push(title.id);
            moved_references.push(...moveTitleGenerationReferences(store,title.id,oldGeneration.id,generation.id));
          }
        }
      }
      if(!title) {
        const matches=entities().filter(row=>row.kind==='title'&&row.data?.generation_id===generation.id&&normal(row.name)===normal(name));
        if(matches.length>1)fail({message:`${name} 타이틀이 중복되었습니다. 기존 ID를 먼저 확인하세요.`,ids:matches.map(row=>row.id)},409);
        title=matches[0];
        if(title?.deleted_at)fail({message:`${name} 타이틀이 휴지통에 있습니다. 새 객체로 중복 등록하지 않습니다.`,id:title.id},409);
        if(title){title=store.update('entities',title.id,{sort_order:index,data:{...title.data,...(spec.number===3&&name==='체라'?{catalog_key:catalogKey(2,'체라'),catalog_key_v2:key}:{catalog_key:key})}},'본편 타이틀 순서 등록 전');updated_ids.push(title.id);}
        else {
          const unassigned=entities().filter(row=>active(row)&&row.kind==='title'&&!row.data?.generation_id&&normal(row.name)===normal(name));
          if(unassigned.length)fail({message:`${name}와 이름이 같은 미소속 타이틀이 있습니다. 세대 연결을 먼저 확인하세요.`,ids:unassigned.map(row=>row.id)},409);
          title=store.create('entities',{kind:'title',name,sort_order:index,data:{generation_id:generation.id,...(spec.number===3&&name==='체라'?{catalog_key:catalogKey(2,'체라'),catalog_key_v2:key}:{catalog_key:key}),status:'구상',time:{mode:'unknown'}}});created_ids.push(title.id);
        }
      }
      resultTitles.push(title);
    }
  }
  return {generations:resultGenerations,titles:resultTitles,created_ids,updated_ids,moved_references,unchanged:!created_ids.length&&!updated_ids.length&&!moved_references.length,catalog:catalogStatus(store.state())};
}

function characterRecord(store, id) {
  const character = store.get('entities', id);
  if (character.kind !== 'character' || character.deleted_at) fail('활성 인물을 선택하세요.');
  return character;
}
function assertRevision(record, supplied) {
  if (!Number.isInteger(supplied) || supplied !== record.revision) fail('다른 창에서 변경되었습니다. 최신 내용을 다시 불러온 뒤 편집하세요.', 409);
}
function hasSlotContent(appearance) {
  const data = appearance.data ?? {};
  return Object.keys(data.overrides ?? {}).length > 0 || [data.role, data.note].some(value => value !== undefined && value !== '') || !!appearance.start || !!appearance.end || Object.keys(data).some(key => !['overrides', 'inherit_fields', 'profile_schema', 'exclusive', 'role', 'note'].includes(key));
}

// Creation is one transaction: a global identity and its selected title slots
// are either all stored or all rejected. Unknown optional details stay unknown.
export function createCharacter(store, payload) {
  if (!object(payload)) fail('인물 정보는 객체여야 합니다.');
  if (payload.name != null && typeof payload.name !== 'string') fail('이름은 텍스트여야 합니다.');
  if (payload.description != null && typeof payload.description !== 'string') fail('설명은 텍스트여야 합니다.');
  if (payload.data != null && !object(payload.data)) fail('인물 설정은 객체여야 합니다.');
  const data = structuredClone(payload.data ?? {});
  // Older form readers represented empty optional text as null. Accept that
  // representation at creation without making any world fact mandatory.
  const optionalValues = values => Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const field = fields.get(key);
    if (value !== null || !field) return [key, value];
    return [key, ['aliases', 'id-list'].includes(field.type) ? [] : field.type === 'id' ? null : field.type === 'time' ? { mode: 'unknown' } : ''];
  }));
  Object.assign(data, optionalValues(data));
  const titleIds = payload.title_ids ?? [];
  if (!Array.isArray(titleIds) || titleIds.some(id => typeof id !== 'string' || !id) || new Set(titleIds).size !== titleIds.length) fail('등장 작품은 중복 없는 타이틀 ID 목록이어야 합니다.');
  for (const titleId of titleIds) typedReference(store, titleId, ['title']);
  const settings = payload.title_settings ?? {};
  if (!object(settings)) fail('작품별 설정은 타이틀별 객체여야 합니다.');
  const slots = new Map();
  for (const [titleId, supplied] of Object.entries(settings)) {
    if (!titleIds.includes(titleId)) fail('등장 작품으로 선택한 타이틀의 설정만 저장할 수 있습니다.');
    if (!object(supplied)) fail('작품별 설정은 객체여야 합니다.');
    if (supplied.overrides != null && !object(supplied.overrides)) fail('작품별 개별 설정은 객체여야 합니다.');
    const overrides = optionalValues(supplied.overrides ?? {}), inherit = supplied.inherit_fields ?? [];
    validateProfileFields(store, overrides, { rejectUnknown: true });
    if (!Array.isArray(inherit) || inherit.some(key => !fields.has(key)) || new Set(inherit).size !== inherit.length) fail('공통 설정으로 사용할 항목이 잘못되었습니다.');
    if (inherit.some(key => Object.hasOwn(overrides, key))) fail('한 항목을 개별 설정과 공통 상속으로 동시에 저장할 수 없습니다.');
    slots.set(titleId, { overrides, inherit_fields: inherit });
  }
  const generationIds=Object.hasOwn(payload,'generation_ids')?payload.generation_ids:[...new Set(titleIds.map(id=>generationForTitle(store.state(),id)?.id).filter(Boolean))];
  const generationSettings=prepareGenerationSelection(store,generationIds,payload.generation_settings??{});
  data.generation_model_version=1;
  const values = { kind: 'character', name: payload.name?.trim() || '이름 미정', description: payload.description ?? '', data };
  if (payload.sort_order != null) values.sort_order = payload.sort_order;
  const character = store.create('entities', values);
  validateWorkspaceMutation(store, 'entities', character);
  const appearances = titleIds.map(titleId => store.create('relations', {
    source_id: character.id, target_id: titleId, type: 'appearance',
    data: { profile_schema: 1, ...(slots.get(titleId) ?? { overrides: {}, inherit_fields: [] }) },
  }));
  const generation_appearances=generationIds.map(generationId=>createGenerationAppearance(store,character.id,generationId,generationSettings.get(generationId)));
  return { character, appearances, generation_appearances };
}
export function setCharacterAppearances(store, id, payload) {
  const character = characterRecord(store, id);
  assertRevision(character, payload.revision);
  if (!Array.isArray(payload.title_ids) || payload.title_ids.some(titleId => typeof titleId !== 'string') || new Set(payload.title_ids).size !== payload.title_ids.length) fail('등장 작품은 중복 없는 타이틀 ID 목록이어야 합니다.');
  for (const titleId of payload.title_ids) typedReference(store, titleId, ['title']);
  if (payload.appearance_revisions != null && !object(payload.appearance_revisions)) fail('등장 작품의 수정 번호 목록이 잘못되었습니다.');
  const state = store.state(), all = appearancesFor(state, id, { includeArchived: true }), wanted = new Set(payload.title_ids);
  if (all.length && (!payload.appearance_revisions || all.some(row => !Object.hasOwn(payload.appearance_revisions, row.id)) || Object.keys(payload.appearance_revisions).some(key => !all.some(row => row.id === key)))) fail('등장 작품 기록이 변경되었거나 수정 번호가 누락되었습니다. 최신 내용을 다시 불러오세요.', 409);
  const byTitle = new Map();
  for (const row of all) {
    const titleId = appearanceTitleId(state, row, id);
    if (!byTitle.has(titleId)) byTitle.set(titleId, []);
    byTitle.get(titleId).push(row);
    if (payload.appearance_revisions && Object.hasOwn(payload.appearance_revisions, row.id)) assertRevision(row, payload.appearance_revisions[row.id]);
  }
  const requires_confirmation = [];
  for (const [titleId, candidates] of byTitle) {
    const live = candidates.filter(active);
    if (live.length > 1 || wanted.has(titleId) && !live.length && candidates.length > 1) fail({ message: '같은 작품의 등장 기록이 여러 개입니다. 기존 내용을 자동 병합하지 않습니다.', title_id: titleId, ids: candidates.map(row => row.id) }, 409);
    if (!wanted.has(titleId) && live.some(hasSlotContent)) requires_confirmation.push(titleId);
  }
  const confirmed = payload.confirm_detach === true ? new Set(requires_confirmation) : new Set(Array.isArray(payload.confirm_detach) ? payload.confirm_detach : []);
  if (requires_confirmation.some(titleId => !confirmed.has(titleId))) fail({ message: '작품별 정보가 있는 연결입니다. 연결만 해제하고 설정과 이력을 보관할지 확인하세요.', requires_confirmation, preserved: true }, 409);
  const detached = [], restored = [], created = [];
  for (const [titleId, candidates] of byTitle) {
    const live = candidates.find(active);
    if (live && !wanted.has(titleId)) detached.push(store.delete('relations', live.id));
    if (!live && wanted.has(titleId)) restored.push(store.delete('relations', candidates[0].id, true));
  }
  for (const titleId of wanted) if (!byTitle.has(titleId)) created.push(store.create('relations', { source_id: id, target_id: titleId, type: 'appearance', data: { profile_schema: 1, overrides: {}, inherit_fields: [] } }));
  let updated = character;
  if (detached.length || restored.length || created.length) updated = store.update('entities', id, { revision: character.revision, data: { ...character.data, appearance_revision: (Number.isInteger(character.data?.appearance_revision) ? character.data.appearance_revision : 0) + 1 } }, '등장 작품 연결 변경 전');
  return { character: updated, appearances: appearancesFor(store.state(), id, { includeArchived: true }), detached, restored, created };
}

export function updateTitleSettings(store, id, titleId, payload) {
  characterRecord(store, id);
  typedReference(store, titleId, ['title']);
  const state = store.state(), matches = appearancesFor(state, id).filter(row => appearanceTitleId(state, row, id) === titleId);
  if (matches.length !== 1) fail({ message: matches.length ? '작품별 등장 기록이 중복되었습니다. 원본을 먼저 확인하세요.' : '이 작품의 등장 연결을 먼저 선택하세요.', title_id: titleId, ids: matches.map(row => row.id) }, 409);
  const appearance = matches[0];
  assertRevision(appearance, payload.revision);
  const patch = payload.overrides ?? {}, inherit = payload.inherit_fields ?? [];
  validateProfileFields(store, patch, { rejectUnknown: true });
  if (!Array.isArray(inherit) || inherit.some(key => !fields.has(key)) || new Set(inherit).size !== inherit.length) fail('공통 설정으로 되돌릴 항목이 잘못되었습니다.');
  if (inherit.some(key => Object.hasOwn(patch, key))) fail('한 항목을 개별 설정과 공통 상속으로 동시에 저장할 수 없습니다.');
  const data = { ...appearance.data }, overrides = { ...(object(data.overrides) ? data.overrides : {}) }, inherited = new Set(Array.isArray(data.inherit_fields) ? data.inherit_fields : []);
  for (const key of inherit) { delete overrides[key]; inherited.add(key); }
  for (const [key, value] of Object.entries(patch)) { overrides[key] = structuredClone(value); inherited.delete(key); }
  // Keep legacy role/note unchanged, and suppress their fallback through the
  // inheritance marker. Store.update also keeps the complete pre-edit snapshot.
  Object.assign(data, { profile_schema: 1, overrides, inherit_fields: [...inherited] });
  return store.update('relations', appearance.id, { revision: appearance.revision, data }, '작품별 설정 변경 전');
}

function validateGenerationIds(store, ids) {
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)fail('등장 세대는 중복 없는 세대 ID 목록이어야 합니다.');
  for(const id of ids)typedReference(store,id,['generation']);
}
function prepareGenerationSelection(store, ids, settings={}) {
  validateGenerationIds(store,ids);
  if(!object(settings))fail('세대별 정보는 세대별 객체여야 합니다.');
  const result=new Map();
  for(const [id,value] of Object.entries(settings)) {
    if(!ids.includes(id))fail('선택한 등장 세대의 정보만 저장할 수 있습니다.');
    result.set(id,normalizedGenerationSettings(store,value));
  }
  return result;
}
function createGenerationAppearance(store, characterId, generationId, settings={}) {
  return store.create('relations',{source_id:characterId,target_id:generationId,type:'generation_appearance',data:{generation_schema:1,affiliations:[],ideology_rank:'',narrative:'',...settings}});
}
export function upgradeGenerationModel(store) {
  const catalog=reconcileCatalog(store),characters=[],created_generation_appearances=[];
  for(const character of store.all('entities').filter(row=>row.kind==='character'&&row.data?.generation_model_version!==1)) {
    const existing=generationAppearancesFor(store.state(),character.id,{includeArchived:true}),seen=new Set(existing.map(row=>generationAppearanceId(store.state(),row,character.id)));
    const inferred=[...new Set(appearancesFor(store.state(),character.id).map(row=>generationForTitle(store.state(),appearanceTitleId(store.state(),row,character.id))?.id).filter(Boolean))];
    for(const id of inferred)if(!seen.has(id))created_generation_appearances.push(createGenerationAppearance(store,character.id,id));
    characters.push(store.update('entities',character.id,{data:{...character.data,generation_model_version:1}},'세대별 인물 정보 확장 전'));
  }
  return {catalog,characters,created_generation_appearances,unchanged:catalog.unchanged&&!characters.length&&!created_generation_appearances.length};
}
export function setCharacterGenerations(store,id,payload) {
  const character=characterRecord(store,id);assertRevision(character,payload.revision);
  validateGenerationIds(store,payload.generation_ids);
  const state=store.state(),all=generationAppearancesFor(state,id,{includeArchived:true}),revisions=payload.generation_revisions??{};
  if(!object(revisions))fail('등장 세대의 수정 번호 목록이 잘못되었습니다.');
  if(all.length&&(all.some(row=>!Object.hasOwn(revisions,row.id))||Object.keys(revisions).some(key=>!all.some(row=>row.id===key))))fail('등장 세대 기록이 변경되었습니다. 최신 내용을 다시 불러오세요.',409);
  for(const row of all)if(Object.hasOwn(revisions,row.id))assertRevision(row,revisions[row.id]);
  const wanted=new Set(payload.generation_ids),byGeneration=new Map();
  for(const row of all){const gid=generationAppearanceId(state,row,id);if(!byGeneration.has(gid))byGeneration.set(gid,[]);byGeneration.get(gid).push(row);}
  const protectedIds=[];
  for(const [gid,records] of byGeneration) {
    const live=records.filter(active);
    if(live.length>1||wanted.has(gid)&&!live.length&&records.length>1)fail({message:'같은 세대의 인물 정보가 중복됩니다. 기존 기록을 확인하세요.',generation_id:gid,ids:records.map(row=>row.id)},409);
    if(!wanted.has(gid)&&live.some(row=>(row.data?.affiliations??[]).length||row.data?.ideology_rank||row.data?.narrative))protectedIds.push(gid);
  }
  const confirmed=payload.confirm_detach===true?new Set(protectedIds):new Set(Array.isArray(payload.confirm_detach)?payload.confirm_detach:[]);
  if(protectedIds.some(gid=>!confirmed.has(gid)))fail({message:'작성된 세대별 정보는 보관됩니다. 연결 해제를 확인하세요.',requires_confirmation:protectedIds,preserved:true},409);
  const created=[],restored=[],detached=[];
  for(const [gid,records] of byGeneration) {
    const live=records.find(active);
    if(live&&!wanted.has(gid))detached.push(store.delete('relations',live.id));
    if(!live&&wanted.has(gid))restored.push(store.delete('relations',records[0].id,true));
  }
  for(const gid of wanted)if(!byGeneration.has(gid))created.push(createGenerationAppearance(store,id,gid));
  const changed=created.length||restored.length||detached.length||character.data?.generation_model_version!==1;
  const updated=changed?store.update('entities',id,{revision:character.revision,data:{...character.data,generation_model_version:1,generation_appearance_revision:(Number.isInteger(character.data?.generation_appearance_revision)?character.data.generation_appearance_revision:0)+1}},'등장 세대 연결 변경 전'):character;
  return {character:updated,generation_appearances:generationAppearancesFor(store.state(),id,{includeArchived:true}),created,restored,detached};
}
export function updateGenerationSettings(store,id,generationId,payload) {
  characterRecord(store,id);typedReference(store,generationId,['generation']);
  const state=store.state(),matches=generationAppearancesFor(state,id).filter(row=>generationAppearanceId(state,row,id)===generationId);
  if(matches.length!==1)fail({message:matches.length?'세대별 인물 정보가 중복됩니다.':'등장 세대부터 선택하세요.',generation_id:generationId},409);
  const relation=matches[0];assertRevision(relation,payload.revision);
  const patch=normalizedGenerationSettings(store,payload,relation.data);
  return store.update('relations',relation.id,{revision:relation.revision,data:{...relation.data,...patch,generation_schema:1}},'세대별 인물 정보 변경 전');
}
export function updateTitleStory(store,id,payload) {
  const title=store.get('entities',id);
  if(title.kind!=='title'||title.deleted_at)fail('활성 타이틀을 선택하세요.');
  assertRevision(title,payload.revision);
  const data={...title.data};
  if(Object.hasOwn(payload,'overview')){if(typeof payload.overview!=='string')fail('작품 개요는 텍스트여야 합니다.');data.overview=payload.overview;}
  if(Object.hasOwn(payload,'synopsis')) {
    if(!object(payload.synopsis))fail('시놉시스는 기·승·전·결 객체여야 합니다.');
    for(const [key,value] of Object.entries(payload.synopsis))if(!['ki','seung','jeon','gyeol'].includes(key)||typeof value!=='string')fail('시놉시스 항목은 기·승·전·결의 텍스트여야 합니다.');
    if(data.synopsis!==undefined&&!object(data.synopsis)&&!Object.hasOwn(data,'synopsis_legacy'))data.synopsis_legacy=structuredClone(data.synopsis);
    data.synopsis={...(object(data.synopsis)?data.synopsis:{}),...payload.synopsis};
  }
  return store.update('entities',id,{revision:title.revision,data},'타이틀 개요·시놉시스 변경 전');
}
