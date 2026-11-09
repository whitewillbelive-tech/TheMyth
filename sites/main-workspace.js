import { CATALOG, PROFILE_FIELDS, catalogKey, catalogStatus, appearancesFor, appearanceTitleId, generationForTitle, titleIdsForEntity } from '../web/main-domain.js';

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
    }
    if (record.kind === 'event' && record.data?.title_id && (!previous || previous.data?.title_id !== record.data.title_id || previous.data?.generation_id !== record.data.generation_id)) {
      const title = store.existsReference(record.data.title_id, ['entities'], ['title']);
      if (title.deleted_at) fail('사건의 소속 타이틀이 휴지통에 있습니다.');
      if (record.data.generation_id && record.data.generation_id !== title.data?.generation_id) fail('사건의 세대와 소속 타이틀의 세대가 다릅니다.');
    }
  }
  if (table !== 'relations') return;
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

export function reconcileCatalog(store) {
  const before = catalogStatus(store.state());
  if (before.conflicts.length) fail({ message: '기존 세대·타이틀 ID의 중복을 먼저 확인하세요.', conflicts: before.conflicts }, 409);
  const created_ids = [], updated_ids = [], resultGenerations = [], resultTitles = [];
  const entities = () => store.all('entities');
  for (const spec of CATALOG) {
    const key = catalogKey(spec.number);
    const tagged = entities().filter(row => row.kind === 'generation' && row.data?.catalog_key === key);
    let generation = tagged[0];
    if (!generation) {
      const candidates = entities().filter(row => row.kind === 'generation' && row.data?.number === spec.number);
      if (candidates.length > 1) fail({ message: `${spec.number}세대 객체가 여러 개입니다. 자동 병합하지 않습니다.`, ids: candidates.map(row => row.id) }, 409);
      generation = candidates[0];
      if (generation?.deleted_at) fail({ message: `${spec.number}세대가 휴지통에 있습니다. 기존 ID를 복원한 뒤 등록하세요.`, id: generation.id }, 409);
      if (generation) {
        generation = store.update('entities', generation.id, { name: spec.name, sort_order: spec.number - 1, data: { ...generation.data, number: spec.number, catalog_key: key } }, '본편 세대 체계 갱신 전');
        updated_ids.push(generation.id);
      } else {
        generation = store.create('entities', { kind: 'generation', name: spec.name, sort_order: spec.number - 1, data: { number: spec.number, catalog_key: key } });
        created_ids.push(generation.id);
      }
    }
    resultGenerations.push(generation);
    for (const [index, name] of spec.titles.entries()) {
      const titleKey = catalogKey(spec.number, name);
      const marked = entities().filter(row => row.kind === 'title' && row.data?.catalog_key === titleKey);
      if (marked.length > 1) fail({ message: `${name} 등록 표식이 중복되었습니다.`, ids: marked.map(row => row.id) }, 409);
      let title = marked[0];
      if (!title) {
        const matches = entities().filter(row => row.kind === 'title' && row.data?.generation_id === generation.id && normal(row.name) === normal(name));
        if (matches.length > 1) fail({ message: `${name} 타이틀이 중복되었습니다. 기존 ID를 먼저 확인하세요.`, ids: matches.map(row => row.id) }, 409);
        title = matches[0];
        if (title?.deleted_at) fail({ message: `${name} 타이틀이 휴지통에 있습니다. 새 객체로 중복 등록하지 않습니다.`, id: title.id }, 409);
        if (title) {
          title = store.update('entities', title.id, { sort_order: index, data: { ...title.data, catalog_key: titleKey } }, '본편 타이틀 순서 등록 전');
          updated_ids.push(title.id);
        } else {
          const unassigned = entities().filter(row => active(row) && row.kind === 'title' && !row.data?.generation_id && normal(row.name) === normal(name));
          if (unassigned.length) fail({ message: `${name}와 이름이 같은 미소속 타이틀이 있습니다. 세대 연결을 먼저 확인하세요.`, ids: unassigned.map(row => row.id) }, 409);
          title = store.create('entities', { kind: 'title', name, sort_order: index, data: { generation_id: generation.id, catalog_key: titleKey, status: '구상', time: { mode: 'unknown' } } });
          created_ids.push(title.id);
        }
      }
      resultTitles.push(title);
    }
  }
  return { generations: resultGenerations, titles: resultTitles, created_ids, updated_ids, unchanged: !created_ids.length && !updated_ids.length, catalog: catalogStatus(store.state()) };
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
