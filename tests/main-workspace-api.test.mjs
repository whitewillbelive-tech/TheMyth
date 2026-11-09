import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../sites/api.js';
import { Fixture, collections } from './d1-test-helper.mjs';
import { CATALOG, appearanceFor, appearancesFor, appearanceTitleId, catalogStatus, commonProfile, resolveTitleProfile, titleIdsForEntity, matchesTitleScope, eventRelationWarnings, profileTimelineWarnings } from '../web/main-domain.js';

function scenario(name, run) {
  test(name, async t => {
    const f = new Fixture(handleApi); t.after(() => f.close());
    let storageWrites = 0;
    f.env.BUCKET.put = async () => { storageWrites++; throw new Error('New workspace operations must not write R2'); };
    f.env.BUCKET.delete = async () => { storageWrites++; throw new Error('New workspace operations must not delete R2'); };
    await run(f, t);
    assert.equal(storageWrites, 0, 'Unexpected R2 mutation');
  });
}
const absolute = year => ({ mode: 'absolute', year });
async function sameRecords(f, before) { const after = await f.state(); for (const key of collections) assert.deepEqual(after[key], before[key], key); }
async function catalog(f) { return f.req('POST', '/api/catalog/reconcile', {}); }
async function sync(f, character, title_ids, extra = {}) {
  const state = await f.state(), current = state.entities.find(row => row.id === character.id);
  return f.req('POST', `/api/characters/${character.id}/appearances`, { revision: current.revision, title_ids, appearance_revisions: Object.fromEntries(appearancesFor(state, character.id, { includeArchived: true }).map(row => [row.id, row.revision])), ...extra });
}
async function profile(f, character, title, overrides = {}, inherit_fields = []) {
  const appearance = appearanceFor(await f.state(), character.id, title.id);
  return f.req('PATCH', `/api/characters/${character.id}/title-settings/${title.id}`, { revision: appearance.revision, overrides, inherit_fields });
}
async function createLegacyCatalog(f) {
  const generations = [];
  for (const [index, name] of ['Earth', 'Universe', '3세대 · 미정'].entries()) generations.push(await f.create('entities', { id: ['generation-earth', 'generation-universe', 'generation-undecided'][index], kind: 'generation', name, sort_order: index, data: { number: index + 1, custom_generation_field: 'keep' } }));
  for (const [index, name] of CATALOG[0].titles.entries()) await f.create('entities', { id: `title-earth-${index + 1}`, kind: 'title', name, sort_order: index, data: { generation_id: generations[0].id, time: { mode: 'unknown' }, extra: 'keep' } });
  return generations;
}

scenario('character creation accepts unfinished identity and empty optional fields without title links', async f => {
  const first = await f.req('POST', '/api/characters', {});
  const second = await f.req('POST', '/api/characters', { name: '   ', description: null, data: { role: null, aliases: null, time: null, notes: null, origin_planet_id: null } });
  assert.equal(first.character.kind, 'character');
  assert.equal(first.character.name, '이름 미정');
  assert.equal(first.character.description, '');
  assert.deepEqual(first.appearances, []);
  assert.equal(second.character.name, '이름 미정');
  assert.notEqual(first.character.id, second.character.id);
  assert.equal(second.character.data.role, '');
  assert.deepEqual(second.character.data.aliases, []);
  assert.deepEqual(second.character.data.time, { mode: 'unknown' });
  assert.equal(second.character.data.notes, '');
  assert.equal(second.character.data.origin_planet_id, null);
  assert.equal((await f.state()).relations.length, 0);
  f.reopen();
  assert.deepEqual(await f.record('entities', second.character.id), second.character);
});

scenario('character creation atomically stores one identity and selected title settings with common inheritance', async f => {
  const { titles } = await catalog(f), first = titles[0], second = titles[4];
  const planet = await f.entity('planet', '출신 행성');
  const before = await f.state();
  const result = await f.req('POST', '/api/characters', {
    name: '새 인물', description: '', sort_order: 3,
    data: { origin_planet_id: planet.id, role: '공통 역할', notes: '공통 메모' },
    title_ids: [first.id, second.id],
    title_settings: {
      [first.id]: { overrides: { name: '작품 이름', role: null, description: '' }, inherit_fields: ['notes'] },
      [second.id]: { overrides: {}, inherit_fields: ['role'] },
    },
  });
  assert.equal(result.character.kind, 'character');
  assert.equal(result.character.data.origin_planet_id, planet.id);
  assert.equal(result.appearances.length, 2);
  let state = await f.state();
  assert.equal(state.entities.filter(row => row.kind === 'character').length, 1);
  for (const record of before.entities) assert.deepEqual(state.entities.find(row => row.id === record.id), record);
  const a = appearanceFor(state, result.character.id, first.id), b = appearanceFor(state, result.character.id, second.id);
  assert.equal(a.source_id, result.character.id);
  assert.equal(b.source_id, result.character.id);
  assert.equal(resolveTitleProfile(result.character, a).values.name, '작품 이름');
  assert.equal(resolveTitleProfile(result.character, a).values.role, '');
  assert.equal(resolveTitleProfile(result.character, a).values.notes, '공통 메모');
  assert.equal(resolveTitleProfile(result.character, b).values.role, '공통 역할');
  f.reopen(); state = await f.state();
  assert.deepEqual(appearanceFor(state, result.character.id, first.id), a);
  assert.deepEqual(appearanceFor(state, result.character.id, second.id), b);
});

scenario('invalid title or slot input rejects character creation without any partial records', async f => {
  const { titles } = await catalog(f), title = titles[0], other = titles[1];
  const planet = await f.entity('planet', '잘못된 타이틀 유형');
  const archived = await f.entity('title', '삭제한 작품');
  await f.req('DELETE', `/api/entities/${archived.id}`);
  const before = await f.state();
  const invalid = [
    { title_ids: [title.id, 'missing'] },
    { title_ids: [planet.id] },
    { title_ids: [archived.id] },
    { title_ids: [title.id, title.id] },
    { title_ids: [''] },
    { title_ids: [title.id], title_settings: { [other.id]: { overrides: { role: '연결되지 않은 작품' } } } },
    { title_ids: [title.id], title_settings: { [title.id]: { overrides: { unknown_field: '허용되지 않음' } } } },
    { title_ids: [title.id], title_settings: { [title.id]: { overrides: { role: '개별' }, inherit_fields: ['role'] } } },
    { title_ids: [title.id], title_settings: { [title.id]: { overrides: { activity_planet_id: title.id } } } },
    { data: { origin_planet_id: title.id } },
    { name: 123 },
    { data: { role: 123 } },
  ];
  for (const payload of invalid) {
    await f.error('POST', '/api/characters', payload, 422);
    await sameRecords(f, before);
  }
});

scenario('catalog preserves legacy IDs, adds six real Universe titles and is idempotent after user edits', async f => {
  const generations = await createLegacyCatalog(f);
  const extra = await f.create('entities', { kind: 'title', name: '사용자의 다른 작품', sort_order: 40, data: { generation_id: generations[1].id, custom: 'untouched' } });
  const manuscript = await f.create('documents', { kind: 'story', name: '기존 원고', body: '원본 내용', canon_status: 'draft', data: { title_ids: ['title-earth-1'] } });
  const result = await catalog(f), state = await f.state();
  assert.equal(state.entities.find(row => row.id === 'generation-undecided').name, 'Heaven');
  assert.equal(state.entities.find(row => row.id === 'generation-undecided').data.custom_generation_field, 'keep');
  assert.equal(result.created_ids.length, 6);
  assert.deepEqual(result.titles.filter(row => row.data.generation_id === generations[1].id).map(row => row.name), CATALOG[1].titles);
  for (let i = 1; i <= 4; i++) assert.equal(state.entities.find(row => row.id === `title-earth-${i}`).data.extra, 'keep');
  assert.equal(state.entities.some(row => row.kind === 'title' && row.data.generation_id === 'generation-undecided'), false);
  assert.deepEqual(await f.record('entities', extra.id), extra);
  assert.deepEqual(await f.record('documents', manuscript.id), manuscript);
  assert.equal(catalogStatus(state).initialized, true);
  const required = result.titles[0];
  await f.update('entities', required, { name: '사용자가 수정한 이름', sort_order: 91 });
  await f.req('DELETE', `/api/entities/${result.titles[4].id}`);
  const before = await f.state();
  assert.equal((await catalog(f)).unchanged, true);
  await sameRecords(f, before);
  f.reopen(); assert.equal((await catalog(f)).unchanged, true); await sameRecords(f, before);
});

scenario('catalog ambiguous legacy names stop atomically without replacing or merging existing records', async f => {
  const [earth] = await createLegacyCatalog(f);
  await f.create('entities', { kind: 'title', name: '위버멘쉬', data: { generation_id: earth.id } });
  const before = await f.state();
  await f.error('POST', '/api/catalog/reconcile', {}, 409);
  await sameRecords(f, before);
});

scenario('one character appears in two titles with sparse overrides and live common inheritance', async f => {
  const { titles } = await catalog(f), a = titles[0], b = titles[4];
  const planet = await f.entity('planet', '출신 행성');
  const character = await f.entity('character', '공통 이름', { origin_planet_id: planet.id, role: '공통 역할', aliases: ['기본 별칭'], custom: { retained: true } });
  await sync(f, character, [a.id, b.id]);
  const first = await profile(f, character, a, { name: '작품 A 이름', role: 'A 역할', aliases: [], description: '작품 A 설명' });
  let state = await f.state(), current = await f.record('entities', character.id);
  assert.equal(state.entities.filter(row => row.kind === 'character').length, 1);
  assert.equal(appearanceFor(state, character.id, b.id).source_id, character.id);
  assert.equal(resolveTitleProfile(current, first).values.name, '작품 A 이름');
  assert.deepEqual(resolveTitleProfile(current, first).values.aliases, []);
  assert.equal(resolveTitleProfile(current, appearanceFor(state, character.id, b.id)).values.role, '공통 역할');
  current = await f.update('entities', current, { revision: current.revision, name: '수정한 공통 이름', data: { ...current.data, role: '수정한 공통 역할' } });
  state = await f.state();
  assert.equal(resolveTitleProfile(current, appearanceFor(state, character.id, a.id)).values.role, 'A 역할');
  assert.equal(resolveTitleProfile(current, appearanceFor(state, character.id, b.id)).values.role, '수정한 공통 역할');
  const inherited = await profile(f, character, a, {}, ['role', 'name']);
  assert.equal(resolveTitleProfile(current, inherited).values.name, '수정한 공통 이름');
  assert.equal(resolveTitleProfile(current, inherited).sources.role, 'common');
  assert.equal(current.data.origin_planet_id, planet.id);
  assert.deepEqual(current.data.custom, { retained: true });
  assert.ok((await f.state()).versions.some(row => row.target_id === first.id && row.snapshot.data.overrides.role === 'A 역할'));
  f.reopen(); assert.equal(resolveTitleProfile(await f.record('entities', character.id), await f.record('relations', inherited.id)).values.role, '수정한 공통 역할');
});

scenario('detaching a populated slot requires confirmation and reconnects the same archived relation and data', async f => {
  const { titles } = await catalog(f), a = titles[0], b = titles[4];
  const person = await f.entity('character', 'A');
  await sync(f, person, [a.id, b.id]);
  const populated = await profile(f, person, a, { notes: '절대 잃지 않을 메모', condition: '상태 A' });
  const before = await f.state(), character = await f.record('entities', person.id);
  const payload = { revision: character.revision, title_ids: [b.id], appearance_revisions: Object.fromEntries(appearancesFor(before, person.id, { includeArchived: true }).map(row => [row.id, row.revision])) };
  const confirmation = await f.error('POST', `/api/characters/${person.id}/appearances`, payload, 409);
  assert.match(confirmation, /requires_confirmation/); await sameRecords(f, before);
  const detached = await sync(f, person, [b.id], { confirm_detach: true });
  assert.equal(detached.detached[0].id, populated.id);
  assert.ok((await f.record('relations', populated.id)).deleted_at);
  assert.equal((await f.record('relations', populated.id)).data.overrides.notes, '절대 잃지 않을 메모');
  const restored = await sync(f, person, [a.id, b.id]);
  assert.equal(restored.restored[0].id, populated.id);
  assert.equal(restored.restored[0].data.overrides.condition, '상태 A');
  assert.equal((await f.state()).entities.filter(row => row.kind === 'character').length, 1);
});

scenario('legacy reversed appearance role and note survive inheritance, detach and restore', async f => {
  const { titles } = await catalog(f), title = titles[0];
  const person = await f.entity('character', 'A', { role: '기본 역할', aliases: '기존, 문자열' });
  const legacy = await f.relation(title, person, 'appearance', { data: { role: '옛 역할', note: '옛 메모', extension: { keep: 'unknown' } }, start: { mode: 'unknown' } });
  assert.deepEqual(commonProfile(person).aliases, ['기존', '문자열']);
  assert.equal(resolveTitleProfile(person, legacy).sources.role, 'legacy');
  const updated = await profile(f, person, title, {}, ['role', 'notes']);
  assert.equal(updated.data.role, '옛 역할'); assert.equal(updated.data.note, '옛 메모');
  assert.deepEqual(updated.data.extension, { keep: 'unknown' });
  assert.equal(resolveTitleProfile(person, updated).values.role, '기본 역할');
  await sync(f, person, [], { confirm_detach: true });
  const restored = await sync(f, person, [title.id]);
  assert.equal(restored.restored[0].id, legacy.id);
  assert.equal(restored.restored[0].source_id, title.id);
});

scenario('stale link sets, stale slot edits, invalid override references and origin changes cannot partially write', async f => {
  const { titles } = await catalog(f), title = titles[0];
  const person = await f.entity('character', 'A');
  await sync(f, person, [title.id]);
  const state = await f.state(), character = await f.record('entities', person.id), appearance = appearanceFor(state, person.id, title.id);
  await profile(f, person, title, { role: '최신 역할' });
  let before = await f.state();
  await f.error('PATCH', `/api/characters/${person.id}/title-settings/${title.id}`, { revision: appearance.revision, overrides: { role: '오래된 입력' } }, 409);
  await f.error('POST', `/api/characters/${person.id}/appearances`, { revision: character.revision, title_ids: [], appearance_revisions: { [appearance.id]: appearance.revision }, confirm_detach: true }, 409);
  await sameRecords(f, before);
  const current = appearanceFor(before, person.id, title.id);
  await f.error('PATCH', `/api/characters/${person.id}/title-settings/${title.id}`, { revision: current.revision, overrides: { origin_planet_id: person.id } });
  await f.error('PATCH', `/api/characters/${person.id}/title-settings/${title.id}`, { revision: current.revision, overrides: { activity_planet_id: person.id } });
  await f.error('PATCH', `/api/characters/${person.id}/title-settings/${title.id}`, { revision: current.revision, overrides: { organization_ids: ['missing'] } });
  await sameRecords(f, before);
});

scenario('duplicate appearance records are surfaced without choosing or merging a slot', async f => {
  const { titles } = await catalog(f), title = titles[0], person = await f.entity('character', 'A');
  await f.relation(person, title, 'appearance', { data: { role: '첫 기록' } });
  await f.relation(person, title, 'appearance', { data: { role: '다른 기록' } });
  const before = await f.state();
  assert.equal(appearanceFor(before, person.id, title.id), null);
  await f.error('POST', `/api/characters/${person.id}/appearances`, { revision: person.revision, title_ids: [title.id], appearance_revisions: Object.fromEntries(appearancesFor(before, person.id).map(row => [row.id, row.revision])) }, 409);
  await sameRecords(f, before);
});

scenario('existing colon-separated object IDs remain usable through encoded profile routes', async f => {
  const person = await f.create('entities', { id: 'character:legacy', kind: 'character', name: '기존 인물', data: {} });
  const title = await f.create('entities', { id: 'title:legacy', kind: 'title', name: '기존 작품', data: {} });
  await f.req('POST', `/api/characters/${encodeURIComponent(person.id)}/appearances`, { revision: person.revision, title_ids: [title.id] });
  const appearance = appearanceFor(await f.state(), person.id, title.id);
  const updated = await f.req('PATCH', `/api/characters/${encodeURIComponent(person.id)}/title-settings/${encodeURIComponent(title.id)}`, { revision: appearance.revision, overrides: { notes: '동일 ID 메모' } });
  assert.equal(updated.source_id, person.id); assert.equal(updated.target_id, title.id);
  await f.error('POST', '/api/characters/%ZZ/appearances', { revision: 1, title_ids: [] }, 422);
});

scenario('explicit event ownership and cross-title causal direction appear in the global timeline with warnings', async f => {
  const { titles } = await catalog(f), a = titles[0], b = titles[1], universe = titles[4];
  const first = await f.entity('event', '뒤 연도 원인', { title_id: a.id, generation_id: a.data.generation_id, time: absolute(20) });
  const second = await f.entity('event', '앞 연도 결과', { title_id: b.id, generation_id: b.data.generation_id, time: absolute(10) });
  const edge = await f.relation(first, second, 'causes');
  const all = await f.req('GET', '/api/timeline');
  assert.ok(all.conflicts.some(row => row.type === 'date_order' && row.ids.includes(edge.id)));
  assert.ok(all.events.findIndex(row => row.id === first.id) < all.events.findIndex(row => row.id === second.id));
  assert.ok((await f.req('GET', `/api/timeline?title_id=${a.id}`)).events.some(row => row.id === first.id));
  assert.equal((await f.record('relations', edge.id)).target_id, second.id);
  assert.ok(eventRelationWarnings(await f.state(), edge).length);
  const otherGeneration = await f.entity('event', '다른 세대', { title_id: universe.id });
  // A preserved legacy reference must not override the new explicit owner.
  await f.relation(otherGeneration, a, 'references');
  assert.deepEqual(titleIdsForEntity(await f.state(), otherGeneration), [universe.id]);
  const before = await f.state();
  await f.error('POST', '/api/relations', { source_id: first.id, target_id: otherGeneration.id, type: 'related' });
  await f.error('POST', '/api/entities', { name: '잘못된 소속', kind: 'event', data: { title_id: a.id, generation_id: universe.data.generation_id } });
  await sameRecords(f, before);
});

scenario('title and generation timeline filters hide other-title-only states while common data stays optional', async f => {
  const { titles } = await catalog(f), a = titles[0], b = titles[4];
  const ca = await f.entity('character', 'A'), cb = await f.entity('character', 'B'), common = await f.entity('character', '공통');
  await sync(f, ca, [a.id]); await sync(f, cb, [b.id]);
  for (const person of [ca, cb, common]) await f.create('states', { entity_id: person.id, attribute: '활동 상태', value: person.name, start: absolute(0), end: absolute(10) });
  const selected = await f.req('GET', `/api/timeline?year=5&title_id=${a.id}`);
  assert.deepEqual(new Set(selected.effective_states.map(row => row.entity_id)), new Set([ca.id, common.id]));
  const strict = await f.req('GET', `/api/timeline?year=5&generation_id=${a.data.generation_id}&include_common=0`);
  assert.deepEqual(strict.effective_states.map(row => row.entity_id), [ca.id]);
  await f.error('GET', `/api/timeline?generation_id=${b.data.generation_id}&title_id=${a.id}`);
});

scenario('group, civilization, origin and activity space scope is a pure projection of original IDs', async f => {
  const { titles } = await catalog(f), title = titles[0];
  const galaxy = await f.entity('space', '은하'), planet = await f.entity('planet', '행성', { parent_id: galaxy.id });
  const civilization = await f.entity('civilization', '문명'), organization = await f.entity('organization', '집단');
  const person = await f.entity('character', 'A', { origin_planet_id: planet.id, civilization_id: civilization.id });
  await sync(f, person, [title.id]);
  await profile(f, person, title, { activity_planet_id: planet.id, organization_ids: [organization.id] });
  const group = await f.create('groups', { name: '원본 그룹' }); await f.create('memberships', { group_id: group.id, entity_id: person.id });
  const state = await f.state(), before = structuredClone(state);
  for (const item of [person, civilization, organization, planet, galaxy, group]) {
    assert.ok(titleIdsForEntity(state, item).includes(title.id));
    assert.equal(matchesTitleScope(state, item, { titleId: title.id, includeCommon: false }), true);
  }
  assert.deepEqual(state, before);
});

scenario('conflicting title settings warn against states, membership and simultaneous title values without modifying originals', async f => {
  const { titles } = await catalog(f), a = titles[0], b = titles[1];
  const person = await f.entity('character', 'A'), canonical = await f.entity('organization', '원본 집단'), projection = await f.entity('organization', '작품별 집단');
  await sync(f, person, [a.id, b.id]);
  await f.relation(person, canonical, 'membership', { start: absolute(0), end: absolute(20) });
  await f.create('states', { entity_id: person.id, attribute: '생존 상태', value: '원본 상태', start: absolute(0), end: absolute(20) });
  const pa = await profile(f, person, a, { time: { mode: 'range', start: 0, end: 10 }, condition: 'A 상태', organization_ids: [projection.id] });
  await profile(f, person, b, { time: { mode: 'range', start: 5, end: 15 }, condition: 'B 상태' });
  const state = await f.state(), before = structuredClone(state), warnings = profileTimelineWarnings(state, await f.record('entities', person.id), pa);
  assert.ok(warnings.some(value => value.includes('원본 상태')));
  assert.ok(warnings.some(value => value.includes('원본 소속')));
  assert.ok(warnings.some(value => value.includes('다릅니다')));
  assert.deepEqual(state, before);
});

test('new profile backup round-trips soft-deleted referenced objects and unknown legacy fields', async t => {
  const f = new Fixture(handleApi), restored = new Fixture(handleApi); t.after(() => { f.close(); restored.close(); });
  const { titles } = await catalog(f), title = titles[0], person = await f.entity('character', 'A'), org = await f.entity('organization', '삭제 후에도 참조 보존');
  await sync(f, person, [title.id]);
  await profile(f, person, title, { organization_ids: [org.id], notes: '원고와 연결된 메모' });
  await f.req('DELETE', `/api/entities/${org.id}`);
  const backup = await f.backup();
  await restored.replace(backup);
  const after = await restored.state();
  for (const key of collections) assert.deepEqual(after[key], backup[key]);
  assert.ok(after.entities.find(row => row.id === org.id).deleted_at);
  assert.equal(appearanceFor(after, person.id, title.id).data.overrides.notes, '원고와 연결된 메모');
});

test('legacy cross-generation event links remain restorable and editable without rewriting their direction', async t => {
  const source = new Fixture(handleApi), target = new Fixture(handleApi); t.after(() => { source.close(); target.close(); });
  const { titles } = await catalog(source);
  const first = await source.entity('event', '기존 사건 A', { title_id: titles[0].id, time: { mode: 'unknown' } });
  const second = await source.entity('event', '기존 사건 B', { title_id: titles[4].id, time: { mode: 'unknown' } });
  const backup = await source.backup();
  const legacy = { id: 'legacy-cross-generation', revision: 1, created_at: '2026-01-01', updated_at: '2026-01-01', deleted_at: null, source_id: first.id, target_id: second.id, type: 'before', start: null, end: null, data: { note: '원본 관계' } };
  backup.relations.push(legacy);
  await target.replace(backup);
  assert.deepEqual(await target.record('relations', legacy.id), legacy);
  const updated = await target.req('PATCH', `/api/relations/${legacy.id}`, { revision: 1, data: { note: '기존 관계 메모만 수정' } });
  assert.equal(updated.source_id, first.id); assert.equal(updated.target_id, second.id);
  assert.equal(updated.type, 'before');
  assert.equal((await target.record('entities', first.id)).data.time.mode, 'unknown');
});
