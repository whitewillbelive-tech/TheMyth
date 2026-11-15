// Character projections and form readers. These helpers never write records or
// infer world facts from a generation/title name.
export const MBTI_AXES = Object.freeze([
  { key: 'ei', left: 'E', right: 'I' },
  { key: 'sn', left: 'S', right: 'N' },
  { key: 'tf', left: 'T', right: 'F' },
  { key: 'jp', left: 'J', right: 'P' },
]);
const rows = (state, key) => Array.isArray(state?.[key]) ? state[key] : [];
const active = record => record && !record.deleted_at;
const clone = value => structuredClone(value);
const asEntries = value => Array.isArray(value) ? value : typeof value?.entries === 'function' ? [...value.entries()] : Object.entries(value || {});
const get = (entries, key) => entries.find(([name]) => name === key)?.[1];
const has = (entries, key) => entries.some(([name]) => name === key);
export function generationRecords(state) {
  return rows(state, 'entities').filter(row => active(row) && row.kind === 'generation').sort((a, b) => (a.data?.number ?? Infinity) - (b.data?.number ?? Infinity) || String(a.id).localeCompare(String(b.id)));
}
export function relationGenerationId(state, relation, characterId) {
  if (relation?.type !== 'generation_appearance') return null;
  const entity = id => rows(state, 'entities').find(row => row.id === id);
  const source = entity(relation.source_id), target = entity(relation.target_id);
  if (source?.kind === 'character' && source.id === characterId && target?.kind === 'generation') return target.id;
  if (target?.kind === 'character' && target.id === characterId && source?.kind === 'generation') return source.id;
  return null;
}
export function generationAppearances(state, characterId, { includeArchived = false } = {}) {
  return rows(state, 'relations').filter(row => (includeArchived || active(row)) && relationGenerationId(state, row, characterId));
}
export function characterGenerationIds(state, character) {
  const all = generationAppearances(state, character.id, { includeArchived: true });
  if (all.length || character.data?.generation_model_version === 1) return [...new Set(all.filter(active).map(row => relationGenerationId(state, row, character.id)))];
  const titles = rows(state, 'entities').filter(row => active(row) && row.kind === 'title');
  return [...new Set(rows(state, 'relations').filter(row => active(row) && row.type === 'appearance' && [row.source_id, row.target_id].includes(character.id)).map(row => titles.find(title => title.id === (row.source_id === character.id ? row.target_id : row.source_id))?.data?.generation_id).filter(Boolean))];
}
export function generationProfile(state, characterId, generationId) {
  const candidates = generationAppearances(state, characterId, { includeArchived: true }).filter(row => relationGenerationId(state, row, characterId) === generationId);
  const current = candidates.filter(active);
  const relation = current.length === 1 ? current[0] : current.length ? null : candidates.length === 1 ? candidates[0] : null;
  const data = relation?.data || {};
  return { relation, duplicate: current.length > 1 || !current.length && candidates.length > 1, archived: !!relation?.deleted_at, affiliations: clone(data.affiliations || []), ideology_rank: data.ideology_rank ?? '', narrative: data.narrative ?? '' };
}
export function mbtiSummary(input = {}) {
  const values = input && typeof input === 'object' ? input : {};
  const axes = MBTI_AXES.map(axis => {
    const value = values[axis.key];
    const known = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
    return { ...axis, known, value: known ? value : null, opposite: known ? 100 - value : null, letter: !known || value === 50 ? '?' : value > 50 ? axis.left : axis.right };
  });
  const determined = axes.every(axis => axis.known && axis.value !== 50);
  return { axes, determined, type: determined ? axes.map(axis => axis.letter).join('') : '미정', partialType: axes.map(axis => axis.letter).join('') };
}
export function readMbti(entries) {
  const source = asEntries(entries), result = {};
  for (const axis of MBTI_AXES) {
    const raw = get(source, 'mbti_' + axis.key);
    if (raw === undefined || raw === null || String(raw).trim() === '') { result[axis.key] = null; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${axis.left}/${axis.right} 비율은 0부터 100까지 입력하세요.`);
    result[axis.key] = value;
  }
  return result;
}
export function readCommonCharacter(entries, character = {}, state = null) {
  const source = asEntries(entries), data = clone(character.data || {});
  const text = key => String(get(source, key) ?? '');
  if (has(source, 'origin_planet_id')) {
    const id = text('origin_planet_id') || null;
    if (id && state) {
      const planet = rows(state, 'entities').find(row => row.id === id && row.kind === 'planet');
      if (!planet || id.startsWith('demo:') || planet.data?.demo === true) throw new Error('등록된 실제 행성을 출신으로 선택하세요.');
    }
    data.origin_planet_id = id;
  }
  for (const key of ['ideology', 'primary_power', 'character_narrative']) if (has(source, key)) data[key] = text(key);
  if (MBTI_AXES.some(axis => has(source, 'mbti_' + axis.key))) {
    const values = readMbti(source);
    data.mbti = { ...(data.mbti || {}), ...Object.fromEntries(MBTI_AXES.filter(axis => has(source, 'mbti_' + axis.key)).map(axis => [axis.key, values[axis.key]])) };
  }
  return { kind: 'character', name: has(source, 'name') ? text('name').trim() || '이름 미정' : character.name || '이름 미정', description: character.description ?? '', data };
}
export function readGenerationProfile(entries) {
  const source = asEntries(entries);
  const affiliations = source.filter(([key]) => key === 'affiliations').map(([, value]) => {
    const text = String(value), split = text.indexOf(':'), collection = text.slice(0, split), id = text.slice(split + 1);
    if (split < 0 || !['entities', 'groups'].includes(collection) || !id) throw new Error('소속 자료를 다시 선택하세요.');
    return { collection, id };
  });
  const seen = new Set();
  return { affiliations: affiliations.filter(ref => { const key = ref.collection + ':' + ref.id; if (seen.has(key)) return false; seen.add(key); return true; }), ideology_rank: String(get(source, 'ideology_rank') ?? ''), narrative: String(get(source, 'narrative') ?? '') };
}
export function hasGenerationContent(profile) {
  return !!(profile?.affiliations?.length || profile?.ideology_rank || profile?.narrative);
}
