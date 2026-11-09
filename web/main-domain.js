// Pure shared domain helpers. These project existing records; they never write
// records, infer world facts, or duplicate a character for a title.
export const CATALOG = Object.freeze([
  { number: 1, name: 'Earth', titles: ['위버멘쉬', '마몬', '아나키', '랑데부'] },
  { number: 2, name: 'Universe', titles: ['올쳐', '브이젯', '흑과 백의 서신', '영웅과 용사의 길', '체라', '월계 전쟁'] },
  { number: 3, name: 'Heaven', titles: [] },
]);

export const PROFILE_FIELDS = Object.freeze([
  { key: 'name', label: '작품에서 사용하는 이름', type: 'text' },
  { key: 'aliases', label: '별칭', type: 'aliases' },
  { key: 'presence', label: '등장 여부', type: 'text' },
  { key: 'role', label: '등장 역할', type: 'text' },
  { key: 'appearance', label: '외형', type: 'textarea' },
  { key: 'condition', label: '당시 상태', type: 'textarea' },
  { key: 'activity_space_id', label: '활동 지역', type: 'id', kinds: ['space', 'planet'] },
  { key: 'activity_planet_id', label: '활동 행성', type: 'id', kinds: ['planet'] },
  { key: 'organization_ids', label: '소속 집단·문명', type: 'id-list', kinds: ['organization', 'civilization'] },
  { key: 'position', label: '직위·사회적 지위', type: 'text' },
  { key: 'abilities', label: '능력·무술', type: 'textarea' },
  { key: 'values', label: '사상·가치관', type: 'textarea' },
  { key: 'time', label: '작품 시점·시간 범위', type: 'time' },
  { key: 'description', label: '작품별 설명', type: 'textarea' },
  { key: 'notes', label: '집필 메모', type: 'textarea' },
]);
export const EVENT_RELATIONS = Object.freeze({ related: '관련 사건', before: '선행 사건', after: '후속 사건', causes: '원인', caused_by: '결과' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => value === undefined ? undefined : structuredClone(value);
const rows = (state, collection) => Array.isArray(state?.[collection]) ? state[collection] : [];
const active = row => row && !row.deleted_at;
const order = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id));
const normal = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const entity = (state, id) => rows(state, 'entities').find(row => row.id === id);

export function generations(state) {
  return rows(state, 'entities').filter(row => active(row) && row.kind === 'generation').sort((a, b) => (a.data?.number ?? Infinity) - (b.data?.number ?? Infinity) || order(a, b));
}
export function titlesForGeneration(state, generationId) {
  return rows(state, 'entities').filter(row => active(row) && row.kind === 'title' && row.data?.generation_id === generationId).sort(order);
}
export function generationForTitle(state, titleId) {
  const title = entity(state, titleId);
  return title?.kind === 'title' ? entity(state, title.data?.generation_id) ?? null : null;
}
export function appearanceTitleId(state, appearance, characterId = null) {
  if (appearance?.type !== 'appearance') return null;
  const a = entity(state, appearance.source_id), b = entity(state, appearance.target_id);
  if (a?.kind === 'character' && b?.kind === 'title' && (!characterId || a.id === characterId)) return b.id;
  if (b?.kind === 'character' && a?.kind === 'title' && (!characterId || b.id === characterId)) return a.id;
  return null;
}
export function appearancesFor(state, characterId, { includeArchived = false } = {}) {
  return rows(state, 'relations').filter(row => (includeArchived || active(row)) && appearanceTitleId(state, row, characterId)).sort(order);
}
export function ambiguousAppearances(state, characterId, titleId) {
  return appearancesFor(state, characterId).filter(row => appearanceTitleId(state, row, characterId) === titleId);
}
export function appearanceFor(state, characterId, titleId, { includeArchived = false } = {}) {
  const found = appearancesFor(state, characterId, { includeArchived }).filter(row => appearanceTitleId(state, row, characterId) === titleId);
  return found.length === 1 ? found[0] : null;
}
export function commonProfile(character) {
  const result = {};
  for (const field of PROFILE_FIELDS) {
    const key = field.key;
    let source = ['name', 'description'].includes(key) ? character?.[key] : character?.data?.[key];
    if (field.type === 'aliases' && typeof source === 'string') source = source.split(',').map(value => value.trim()).filter(Boolean);
    result[key] = copy(source ?? (field.type === 'aliases' || field.type === 'id-list' ? [] : field.type === 'id' ? null : field.type === 'time' ? { mode: 'unknown' } : key === 'presence' ? '등장' : ''));
  }
  return result;
}
export function resolveTitleProfile(character, appearance) {
  const values = commonProfile(character), sources = Object.fromEntries(PROFILE_FIELDS.map(field => [field.key, 'common']));
  const data = object(appearance?.data) ? appearance.data : {};
  const overrides = object(data.overrides) ? copy(data.overrides) : {};
  const inherit = new Set(Array.isArray(data.inherit_fields) ? data.inherit_fields : []);
  const legacyFields = [], warnings = [];
  const legacy = { ...(Object.hasOwn(data, 'role') ? { role: data.role } : {}), ...(Object.hasOwn(data, 'note') ? { notes: data.note } : {}) };
  for (const field of PROFILE_FIELDS) {
    const key = field.key;
    if (Object.hasOwn(overrides, key)) { values[key] = copy(overrides[key]); sources[key] = 'override'; }
    else if (!inherit.has(key) && Object.hasOwn(legacy, key)) { values[key] = copy(legacy[key]); sources[key] = 'legacy'; legacyFields.push(key); }
  }
  if (appearance?.deleted_at) warnings.push('연결이 해제된 작품의 설정입니다. 연결을 복원하면 같은 기록을 다시 사용할 수 있습니다.');
  if (appearance?.start || appearance?.end) warnings.push('기존 등장 시점 관계는 통합 연대기의 원본 기록으로 보존됩니다.');
  return { values, sources, overrides, legacyFields, warnings };
}
export function titleIdsForEntity(state, item, visited = new Set()) {
  if (!item || visited.has(item.id)) return [];
  visited.add(item.id);
  const titles = new Set(rows(state, 'entities').filter(row => active(row) && row.kind === 'title').map(row => row.id));
  // An event's explicit primary title owns it. Old title links remain intact
  // as references, but do not turn it into a second event or another owner.
  if (item.kind === 'event' && titles.has(item.data?.title_id)) return [item.data.title_id];
  const result = new Set();
  if (titles.has(item.id)) result.add(item.id);
  if (titles.has(item.data?.title_id)) result.add(item.data.title_id);
  for (const id of item.data?.title_ids ?? []) if (titles.has(id)) result.add(id);
  for (const relation of rows(state, 'relations').filter(active)) {
    if (relation.source_id === item.id && titles.has(relation.target_id)) result.add(relation.target_id);
    if (relation.target_id === item.id && titles.has(relation.source_id)) result.add(relation.source_id);
  }
  // A group is a view over original members, not another set of entities.
  if (rows(state, 'groups').some(group => group.id === item.id)) {
    for (const member of rows(state, 'memberships').filter(row => row.group_id === item.id)) {
      const target = entity(state, member.entity_id);
      if (target) for (const id of titleIdsForEntity(state, target, visited)) result.add(id);
    }
  }
  if (['organization', 'civilization', 'space', 'planet', 'setting', 'custom', 'thought'].includes(item.kind)) {
    const participants = new Set();
    for (const relation of rows(state, 'relations').filter(active)) {
      const other = relation.source_id === item.id ? relation.target_id : relation.target_id === item.id ? relation.source_id : null;
      if (other && ['character', 'event'].includes(entity(state, other)?.kind)) participants.add(other);
    }
    for (const character of rows(state, 'entities').filter(row => active(row) && row.kind === 'character')) {
      if (character.data?.civilization_id === item.id || character.data?.origin_planet_id === item.id) participants.add(character.id);
      for (const appearance of appearancesFor(state, character.id)) {
        const values = resolveTitleProfile(character, appearance).values;
        if (values.organization_ids?.includes(item.id) || values.activity_space_id === item.id || values.activity_planet_id === item.id) {
          const id = appearanceTitleId(state, appearance, character.id);
          if (id) result.add(id);
        }
      }
    }
    for (const id of participants) for (const titleId of titleIdsForEntity(state, entity(state, id), visited)) result.add(titleId);
    if (['space', 'planet'].includes(item.kind)) {
      for (const child of rows(state, 'entities').filter(row => active(row) && ['space', 'planet'].includes(row.kind) && row.data?.parent_id === item.id)) {
        for (const titleId of titleIdsForEntity(state, child, visited)) result.add(titleId);
      }
    }
  }
  return [...result];
}
export function matchesTitleScope(state, item, { generationId = '', titleId = '', includeCommon = true } = {}) {
  if (!generationId && !titleId) return true;
  const ids = titleIdsForEntity(state, item);
  if (!ids.length) return includeCommon;
  if (titleId) return ids.includes(titleId);
  return ids.some(id => generationForTitle(state, id)?.id === generationId);
}
export function catalogKey(number, title = null) { return title === null ? `generation:${number}` : `title:${number}:${title}`; }
export function catalogStatus(state) {
  const entities = rows(state, 'entities'), missing = [], conflicts = [];
  for (const spec of CATALOG) {
    const generationKey = catalogKey(spec.number);
    const tagged = entities.filter(row => row.kind === 'generation' && row.data?.catalog_key === generationKey);
    if (tagged.length > 1) conflicts.push(`${spec.number}세대의 등록 표식이 중복되었습니다.`);
    if (!tagged.length) missing.push(generationKey);
    const generation = tagged[0] ?? entities.find(row => row.kind === 'generation' && row.data?.number === spec.number);
    for (const title of spec.titles) {
      const key = catalogKey(spec.number, title);
      const found = entities.filter(row => row.kind === 'title' && row.data?.catalog_key === key);
      if (found.length > 1) conflicts.push(`${title}의 등록 표식이 중복되었습니다.`);
      if (!found.length) missing.push(key);
    }
    if (generation && !tagged.length && entities.filter(row => active(row) && row.kind === 'generation' && row.data?.number === spec.number).length > 1) conflicts.push(`${spec.number}세대 객체가 여러 개입니다. 기존 ID를 먼저 확인하세요.`);
  }
  return { initialized: !missing.length && !conflicts.length, needsSetup: !!missing.length, missing, conflicts };
}
function numeric(time, end = false) {
  if (!object(time)) return null;
  return time.mode === 'absolute' ? time.year ?? null : time.mode === 'range' ? time[end ? 'end' : 'start'] ?? null : null;
}
export function eventRelationWarnings(state, relation) {
  const a = entity(state, relation?.source_id), b = entity(state, relation?.target_id), warnings = [];
  if (!a || !b || a.kind !== 'event' || b.kind !== 'event') return warnings;
  const aTitles = titleIdsForEntity(state, a), bTitles = titleIdsForEntity(state, b);
  const aGenerations = new Set(aTitles.map(id => generationForTitle(state, id)?.id).filter(Boolean));
  const bGenerations = new Set(bTitles.map(id => generationForTitle(state, id)?.id).filter(Boolean));
  if (aGenerations.size && bGenerations.size && ![...aGenerations].some(id => bGenerations.has(id))) warnings.push('서로 다른 세대의 사건 연결입니다. 기존 관계와 시간 범위를 확인하세요.');
  const before = ['before', 'precedes', '이전', 'causes'].includes(relation.type), after = ['after', 'follows', '이후', 'caused_by'].includes(relation.type);
  const ay = numeric(a.data?.time), by = numeric(b.data?.time);
  if (ay !== null && by !== null && (before && ay > by || after && ay < by)) warnings.push('확정 연도와 사건 관계의 방향이 충돌합니다. 원본 시점은 변경하지 않았습니다.');
  return warnings;
}
export function profileTimelineWarnings(state, character, appearance) {
  const profile = resolveTitleProfile(character, appearance), warnings = [...profile.warnings];
  const time = profile.values.time, start = numeric(time), end = numeric(time, true);
  if (start === null) return warnings;
  const attributes = { appearance: ['외형', 'appearance'], condition: ['상태', '생존 상태', '활동 상태', 'status', 'alive'], activity_planet_id: ['현재 활동 행성', '현재 행성', 'current_planet'] };
  for (const record of rows(state, 'states').filter(row => active(row) && row.entity_id === character.id)) {
    const rs = numeric(record.start), re = numeric(record.end, true);
    if (rs === null || Math.max(start, rs) > Math.min(end ?? Infinity, re ?? Infinity)) continue;
    for (const [key, names] of Object.entries(attributes)) if (profile.sources[key] !== 'common' && names.includes(record.attribute) && String(profile.values[key] ?? '') !== String(record.value ?? '')) warnings.push(`${record.attribute} 작품별 설정과 같은 시점의 원본 상태가 다릅니다. 통합 연대기 기록은 유지됩니다.`);
  }
  if (profile.sources.organization_ids !== 'common') {
    const members = rows(state, 'relations').filter(row => active(row) && row.type === 'membership' && [row.source_id, row.target_id].includes(character.id)).filter(row => {
      const rs = numeric(row.start), re = numeric(row.end, true);
      return rs !== null && Math.max(start, rs) <= Math.min(end ?? Infinity, re ?? Infinity);
    });
    if (members.length) {
      const canonical = members.map(row => row.source_id === character.id ? row.target_id : row.source_id).sort();
      const projected = [...(profile.values.organization_ids ?? [])].sort();
      if (JSON.stringify(canonical) !== JSON.stringify(projected)) warnings.push('작품별 소속과 같은 시점의 원본 소속 기록이 다릅니다. 복수 소속을 허용하며 원본 관계는 유지됩니다.');
    }
  }
  for (const other of appearancesFor(state, character.id)) {
    if (other.id === appearance?.id) continue;
    const otherProfile = resolveTitleProfile(character, other), otherStart = numeric(otherProfile.values.time), otherEnd = numeric(otherProfile.values.time, true);
    if (otherStart === null || Math.max(start, otherStart) > Math.min(end ?? Infinity, otherEnd ?? Infinity)) continue;
    for (const key of ['appearance', 'condition', 'activity_planet_id']) {
      if (profile.sources[key] === 'common' && otherProfile.sources[key] === 'common') continue;
      if (JSON.stringify(profile.values[key]) !== JSON.stringify(otherProfile.values[key])) {
        const label = PROFILE_FIELDS.find(field => field.key === key)?.label ?? key;
        const title = entity(state, appearanceTitleId(state, other, character.id));
        warnings.push(`${label} 설정이 같은 시점의 ${title?.name ?? '다른 작품'} 기록과 다릅니다. 각 작품의 설정을 보존한 채 확인하세요.`);
      }
    }
  }
  return [...new Set(warnings)];
}
