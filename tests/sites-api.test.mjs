import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { handleApi } from '../sites/api.js';
import { Fixture, collections, TestD1 } from './d1-test-helper.mjs';

const absolute = year => ({ mode: 'absolute', year });
const ids = rows => rows.map(row => row.id);
function scenario(name, run) {
  test(name, async t => { const f = new Fixture(handleApi); t.after(() => f.close()); await run(f, t); });
}
async function unchanged(f, before) {
  const after = await f.state();
  for (const table of collections) assert.deepEqual(after[table], before[table], `${table} unexpectedly changed`);
}

scenario('01. Hosted empty database never fabricates or re-seeds original user data', async f => {
  let state = await f.state();
  for (const table of collections) assert.deepEqual(state[table], []);
  assert.equal((await f.req('GET', '/api/health')).status, 'ok');
  f.reopen(); state = await f.state();
  for (const table of collections) assert.deepEqual(state[table], []);
});

scenario('02. Global character identity, different work roles and historical membership persist', async f => {
  const planet = await f.entity('planet', 'Origin');
  const person = await f.entity('character', 'A', { origin_planet_id: planet.id });
  const a = await f.entity('title', 'Title A'), b = await f.entity('title', 'Title B');
  const past = await f.entity('organization', 'Past'), later = await f.entity('organization', 'Later');
  const roleA = await f.relation(person, a, 'appearance', { data: { role: '주인공' } });
  const roleB = await f.relation(person, b, 'appearance', { data: { role: '조연' } });
  const first = await f.relation(person, past, 'membership', { start: absolute(0), end: absolute(49) });
  const second = await f.relation(person, later, 'membership', { start: absolute(50), end: null });
  await f.update('entities', person, { name: '[TEST] renamed' });
  assert.deepEqual(ids((await f.state()).entities.filter(e => e.kind === 'character')), [person.id]);
  assert.equal((await f.record('entities', person.id)).data.origin_planet_id, planet.id);
  assert.equal((await f.record('relations', roleA.id)).data.role, '주인공');
  assert.equal((await f.record('relations', roleB.id)).source_id, person.id);
  for (const [year, present, absent] of [[25, first, second], [75, second, first]]) {
    const timeline = await f.req('GET', `/api/timeline?year=${year}`);
    assert.ok(ids(timeline.effective_relations).includes(present.id));
    assert.ok(!ids(timeline.effective_relations).includes(absent.id));
  }
  for (const title of [a, b]) assert.ok(ids((await f.req('GET', `/api/timeline?year=75&title_id=${title.id}`)).effective_relations).includes(second.id));
});

scenario('03. Unknown and relative time remain uncertain; titles may overlap', async f => {
  const a = await f.entity('event', 'Unknown', { time: { mode: 'unknown' } });
  const b = await f.entity('event', 'After', { time: { mode: 'after', event_id: a.id } });
  await f.relation(a, b, 'before');
  await f.update('entities', a, { sort_order: 20 }); await f.update('entities', b, { sort_order: 30 });
  const t1 = await f.entity('title', 'Overlap A', { time: { mode: 'range', start: 10, end: 60 } });
  const t2 = await f.entity('title', 'Overlap B', { time: { mode: 'range', start: 40, end: 100 } });
  const timeline = await f.req('GET', '/api/timeline?year=50');
  assert.ok(ids(timeline.titles).includes(t1.id)); assert.ok(ids(timeline.titles).includes(t2.id));
  assert.equal((await f.record('entities', a.id)).data.time.year ?? null, null);
  assert.equal((await f.record('entities', b.id)).data.time.event_id, a.id);
  assert.ok(ids(timeline.events).indexOf(a.id) < ids(timeline.events).indexOf(b.id));
});

scenario('04. Exclusive state conflicts are reported without deleting history', async f => {
  const p = await f.entity('character', 'Conflicted');
  const a = await f.create('states', { entity_id: p.id, attribute: '생존 상태', value: '생존', start: absolute(0), end: absolute(100), data: { exclusive: true } });
  const b = await f.create('states', { entity_id: p.id, attribute: '생존 상태', value: '사망', start: absolute(50), end: absolute(150), data: { exclusive: true } });
  const unknown = await f.create('states', { entity_id: p.id, attribute: '활동지', value: '미정', start: { mode: 'unknown' } });
  const timeline = await f.req('GET', '/api/timeline?year=75');
  assert.ok(timeline.conflicts.length);
  for (const item of [a, b]) { assert.ok(ids(timeline.effective_states).includes(item.id)); assert.ok(!(await f.record('states', item.id)).deleted_at); }
  assert.equal((await f.record('states', unknown.id)).start.year ?? null, null);
});

scenario('05. Physical space hierarchy and historical governance remain separate', async f => {
  const galaxy = await f.entity('space', 'Galaxy', { subtype: '은하' });
  const a = await f.entity('planet', 'Planet A', { parent_id: galaxy.id, environment: 'environment' });
  const b = await f.entity('planet', 'Planet B', { parent_id: galaxy.id });
  const c1 = await f.entity('civilization', 'A'), c2 = await f.entity('civilization', 'B');
  const master = await f.relation(c1, galaxy, 'galaxy_master', { start: { mode: 'unknown' }, data: { role: '조율' } });
  const past = await f.relation(c1, a, 'governs', { start: absolute(0), end: absolute(49) });
  const later = await f.relation(c2, a, 'governs', { start: absolute(50) });
  const active = ids((await f.req('GET', '/api/timeline?year=70')).effective_relations);
  assert.ok(active.includes(later.id)); assert.ok(!active.includes(past.id));
  for (const item of [a, b]) assert.equal((await f.record('entities', item.id)).data.parent_id, galaxy.id);
  assert.equal((await f.record('entities', a.id)).data.environment, 'environment');
  assert.equal((await f.record('relations', master.id)).start.year ?? null, null);
  assert.ok(!(await f.record('relations', past.id)).deleted_at);
});

scenario('06. Group removal and soft delete preserve references and support restore', async f => {
  const p = await f.entity('character', 'Grouped'), event = await f.entity('event', 'Event');
  const relation = await f.relation(p, event, 'participates');
  const ga = await f.create('groups', { name: 'Parent' }), gb = await f.create('groups', { name: 'Child', parent_id: ga.id });
  const a = await f.create('memberships', { group_id: ga.id, entity_id: p.id }), b = await f.create('memberships', { group_id: gb.id, entity_id: p.id });
  await f.req('DELETE', `/api/memberships/${a.id}`);
  assert.ok(!(await f.record('entities', p.id)).deleted_at); assert.ok(ids((await f.state()).memberships).includes(b.id));
  assert.ok(JSON.stringify(await f.req('GET', `/api/entities/${p.id}/impact`)).includes(relation.id));
  await f.req('DELETE', `/api/entities/${p.id}`);
  assert.ok((await f.record('entities', p.id)).deleted_at);
  assert.ok(!(await f.record('entities', event.id)).deleted_at); assert.ok(!(await f.record('relations', relation.id)).deleted_at);
  await f.req('POST', `/api/entities/${p.id}/restore`, {});
  assert.ok(!(await f.record('entities', p.id)).deleted_at);
  assert.equal((await f.record('relations', relation.id)).source_id, p.id);
});

scenario('07. Hierarchy cycles and dangling references are rejected', async f => {
  const a = await f.entity('space', 'A'), b = await f.entity('space', 'B', { parent_id: a.id });
  await f.error('PATCH', `/api/entities/${a.id}`, { data: { parent_id: b.id } });
  const ga = await f.create('groups', { name: 'A' }), gb = await f.create('groups', { name: 'B', parent_id: ga.id });
  await f.error('PATCH', `/api/groups/${ga.id}`, { parent_id: gb.id });
  await f.error('POST', '/api/relations', { source_id: a.id, target_id: 'nonexistent', type: 'references' });
  await f.error('POST', '/api/entities', { kind: 'character', name: 'Invalid', data: { origin_planet_id: 'missing' } });
});

scenario('08. Revision guards reject stale autosave without losing latest text', async f => {
  const e = await f.entity('setting', 'Revision');
  const updated = await f.update('entities', e, { name: 'Updated', revision: e.revision });
  assert.ok(updated.revision > e.revision);
  await f.error('PATCH', `/api/entities/${e.id}`, { name: 'Lost update', revision: e.revision }, 409);
  assert.equal((await f.record('entities', e.id)).name, 'Updated');
});

scenario('09. Invalid years and reversed intervals cannot partially mutate records', async f => {
  const e = await f.entity('event', 'Unknown', { time: { mode: 'unknown' } });
  for (const year of ['unconfirmed', '', false, { year: 12 }]) {
    await f.error('PATCH', `/api/entities/${e.id}`, { data: { time: { mode: 'absolute', year } } });
    assert.equal((await f.record('entities', e.id)).data.time.mode, 'unknown');
  }
  await f.error('POST', '/api/states', { entity_id: e.id, attribute: 'status', value: 'invalid', start: absolute(100), end: absolute(10) });
});

scenario('10. Typed references and duplicate memberships are enforced', async f => {
  const p = await f.entity('character', 'Person'), planet = await f.entity('planet', 'Planet');
  await f.error('POST', '/api/entities', { kind: 'character', name: 'Wrong origin', data: { origin_planet_id: p.id } });
  await f.error('POST', '/api/documents', { kind: 'book', name: 'Wrong author', author_id: planet.id });
  const group = await f.create('groups', { name: 'Unique' });
  await f.create('memberships', { group_id: group.id, entity_id: p.id });
  await f.error('POST', '/api/memberships', { group_id: group.id, entity_id: p.id });
  assert.equal((await f.state()).memberships.length, 1);
});

scenario('11. Invalid relation edits and cross-book chapter parents are atomic', async f => {
  const a = await f.entity('character', 'A'), b = await f.entity('character', 'B'), rel = await f.relation(a, b, 'knows');
  await f.error('PATCH', `/api/relations/${rel.id}`, { target_id: 'missing', type: 'corrupted' });
  const stored = await f.record('relations', rel.id); assert.equal(stored.target_id, b.id); assert.equal(stored.type, 'knows');
  const first = await f.create('documents', { kind: 'book', name: 'First' }), second = await f.create('documents', { kind: 'book', name: 'Second' });
  const chapter = await f.create('chapters', { document_id: first.id, name: 'Chapter' });
  await f.error('POST', '/api/chapters', { document_id: second.id, parent_id: chapter.id, name: 'Wrong section' });
});

scenario('12. Chapter version restoration preserves body, order and parent', async f => {
  const book = await f.create('documents', { kind: 'book', name: 'History' });
  const parent = await f.create('chapters', { document_id: book.id, name: 'Parent' });
  const section = await f.create('chapters', { document_id: book.id, parent_id: parent.id, name: 'Section', body: 'original section', sort_order: 2 });
  await f.update('chapters', section, { body: 'changed section', sort_order: 7, parent_id: null });
  const version = (await f.state()).versions.find(v => v.target_id === section.id && v.snapshot.body === 'original section'); assert.ok(version);
  await f.req('POST', `/api/versions/${version.id}/restore`, {});
  const restored = await f.record('chapters', section.id);
  assert.equal(restored.body, 'original section'); assert.equal(restored.parent_id, parent.id); assert.equal(restored.document_id, book.id); assert.equal(restored.sort_order, 2);
});

scenario('13. Split preserves original and copies only selected fields and relations', async f => {
  const source = await f.entity('setting', 'Composite', { principle: 'principle', conditions: 'conditions' });
  const target = await f.entity('planet', 'Related'), relation = await f.relation(source, target, 'origin');
  await f.req('POST', `/api/entities/${source.id}/split`, { name: 'Split', fields: ['principle'], relation_ids: [relation.id] });
  const split = (await f.state()).entities.find(e => e.name === 'Split'); assert.ok(split); assert.notEqual(split.id, source.id);
  assert.equal(split.data.principle, 'principle'); assert.ok(!('conditions' in split.data));
  assert.equal((await f.record('entities', source.id)).data.conditions, 'conditions'); assert.ok(!(await f.record('relations', relation.id)).deleted_at);
  assert.ok((await f.state()).relations.some(r => r.source_id === split.id && r.target_id === target.id));
});

scenario('14. Merge requires conflict decisions and redirects references while keeping history', async f => {
  const target = await f.entity('character', 'Canonical', { aliases: 'canonical' }), source = await f.entity('character', 'Duplicate', { aliases: 'alternate' });
  const title = await f.entity('title', 'Title'), rel = await f.relation(source, title, 'appearance', { data: { role: 'role' } });
  const state = await f.create('states', { entity_id: source.id, attribute: '가치관', value: 'conviction', start: { mode: 'unknown' } });
  const group = await f.create('groups', { name: 'Merge group' });
  for (const person of [source, target]) await f.create('memberships', { group_id: group.id, entity_id: person.id });
  const book = await f.create('documents', { kind: 'book', name: 'Authored', author_id: source.id });
  const preview = await f.req('GET', `/api/entities/${target.id}/merge-preview?source_id=${source.id}`);
  await f.error('POST', `/api/entities/${target.id}/merge`, { source_id: source.id, field_choices: {} }, 409);
  assert.ok(!(await f.record('entities', source.id)).deleted_at);
  await f.req('POST', `/api/entities/${target.id}/merge`, { source_id: source.id, field_choices: Object.fromEntries(preview.conflicts.map(c => [c.field, 'target'])) });
  assert.ok((await f.record('entities', source.id)).deleted_at); assert.ok(!(await f.record('entities', target.id)).deleted_at);
  assert.equal((await f.record('relations', rel.id)).source_id, target.id); assert.equal((await f.record('states', state.id)).entity_id, target.id);
  assert.equal((await f.record('documents', book.id)).author_id, target.id);
  const members = (await f.state()).memberships.filter(m => m.group_id === group.id); assert.equal(members.length, 1); assert.equal(members[0].entity_id, target.id);
});

scenario('15. Books, philosophy and stories retain independent canon and ordered chapter exports', async f => {
  const author = await f.entity('character', 'Author', { profile: 'objective profile' });
  const thought = await f.entity('thought', 'Thought', { thesis: 'fallible claim' });
  const historical = await f.entity('thinker', 'Historical', { reality: 'historical' }), fictional = await f.entity('thinker', 'Fictional', { reality: 'fictional' });
  const book = await f.create('documents', { kind: 'book', name: 'Book', author_id: author.id, body: 'opening', canon_status: 'draft' });
  const a = await f.create('chapters', { document_id: book.id, name: 'Chapter A', body: 'alpha manuscript', sort_order: 10 });
  const b = await f.create('chapters', { document_id: book.id, name: 'Chapter B', body: 'beta manuscript', sort_order: 20 });
  await f.create('chapters', { document_id: book.id, parent_id: b.id, name: 'Section B1', body: 'nested section', sort_order: 10 });
  await f.update('chapters', b, { sort_order: 0 });
  await f.relation(thought, book, 'discussed_in'); await f.relation(historical, thought, 'founded'); await f.relation(fictional, thought, 'criticized');
  const story = await f.create('documents', { kind: 'story', name: 'Story', body: 'speculation', canon_status: 'undecided' }); await f.relation(story, author, 'features');
  await f.update('documents', story, { body: 'different origin' }); assert.equal((await f.record('entities', author.id)).data.profile, 'objective profile');
  const response = await f.response('GET', `/api/documents/${book.id}/export?format=md`); assert.equal(response.status, 200); const md = await response.text();
  assert.ok(md.includes('nested section')); assert.ok(md.indexOf('Chapter B') < md.indexOf('Chapter A'));
  const text = await (await f.response('GET', `/api/documents/${book.id}/export?format=txt&chapter_id=${a.id}`)).text();
  assert.ok(text.includes('alpha manuscript')); assert.ok(!text.includes('beta manuscript')); assert.equal((await f.record('documents', story.id)).canon_status, 'undecided');
});

scenario('16. Manuscript restoration survives closing and reopening persistent storage', async f => {
  const doc = await f.create('documents', { kind: 'story', name: 'Versions', body: 'first manuscript' });
  await f.update('documents', doc, { body: 'second manuscript' });
  const version = (await f.state()).versions.find(v => v.target_id === doc.id && v.snapshot.body === 'first manuscript'); assert.ok(version);
  await f.req('POST', `/api/versions/${version.id}/restore`, {}); f.reopen();
  assert.equal((await f.record('documents', doc.id)).body, 'first manuscript');
  assert.ok((await f.state()).versions.some(v => v.target_id === doc.id && v.snapshot.body === 'second manuscript'));
});

scenario('17. Backup restore into separate DB preserves IDs/payloads and refuses merge conflicts', async (f, t) => {
  const p = await f.entity('character', 'Backed up'), doc = await f.create('documents', { kind: 'story', name: 'Backup', body: 'preserved text' });
  await f.relation(doc, p, 'features'); const backup = await f.backup();
  const other = new Fixture(handleApi); t.after(() => other.close()); await other.replace(backup);
  await unchanged(other, backup); assert.ok(other.objects.size > 0, 'Pre-restore safety backup was not stored');
  await other.update('entities', p, { name: 'Keep newer edit' });
  await other.error('POST', '/api/backup/restore', { backup, mode: 'merge' }, 409);
  assert.equal((await other.record('entities', p.id)).name, 'Keep newer edit');
});

scenario('18. Malformed import is atomic and replace requires explicit confirmation', async f => {
  await f.entity('character', 'Protected'); const backup = await f.backup(), initial = await f.state();
  await f.error('POST', '/api/backup/restore', { backup, mode: 'replace' });
  const malformed = structuredClone(backup); malformed.entities = [{ id: 'bad', kind: 'character', name: 'invalid', data: { origin_planet_id: 'missing' } }];
  await f.error('POST', '/api/backup/restore', { backup: malformed, mode: 'replace', confirm: 'REPLACE' });
  await unchanged(f, initial);
});

scenario('19. Archived self-relations survive merge/backup, but cannot become active', async (f, t) => {
  const target = await f.entity('character', 'Target'), source = await f.entity('character', 'Source'), rel = await f.relation(source, target, 'knows');
  const preview = await f.req('GET', `/api/entities/${target.id}/merge-preview?source_id=${source.id}`);
  await f.req('POST', `/api/entities/${target.id}/merge`, { source_id: source.id, field_choices: Object.fromEntries(preview.conflicts.map(c => [c.field, 'target'])) });
  assert.ok((await f.record('relations', rel.id)).deleted_at);
  const other = new Fixture(handleApi); t.after(() => other.close()); await other.replace(await f.backup());
  assert.ok((await other.record('relations', rel.id)).deleted_at);
  await f.error('POST', `/api/relations/${rel.id}/restore`, {}); assert.ok((await f.record('relations', rel.id)).deleted_at);
});

scenario('20. Entity kind is immutable to protect existing typed references', async f => {
  const origin = await f.entity('planet', 'Origin'), p = await f.entity('character', 'Identity', { origin_planet_id: origin.id });
  await f.error('PATCH', `/api/entities/${origin.id}`, { kind: 'setting' });
  assert.equal((await f.record('entities', origin.id)).kind, 'planet'); assert.equal((await f.record('entities', p.id)).data.origin_planet_id, origin.id);
});

scenario('21. Cross-origin mutation requests cannot modify the archive', async f => {
  const before = await f.state();
  for (const headers of [{ Origin: 'https://unrelated.example' }, { 'Sec-Fetch-Site': 'cross-site' }])
    await f.error('POST', '/api/entities', { kind: 'character', name: 'hostile' }, 403, headers);
  await unchanged(f, before);
});

scenario('22. Imported versions cannot target unrelated objects', async f => {
  const a = await f.entity('character', 'Owner'), b = await f.entity('character', 'Unrelated');
  await f.update('entities', a, { description: 'history' }); const initial = await f.state(), backup = await f.backup();
  backup.versions.find(v => v.target_id === a.id).snapshot.id = b.id;
  await f.error('POST', '/api/backup/restore', { backup, mode: 'replace', confirm: 'REPLACE' }); await unchanged(f, initial);
});

scenario('23. Imported document snapshots cannot steal chapters from another book', async f => {
  const a = await f.create('documents', { kind: 'book', name: 'Own' }), b = await f.create('documents', { kind: 'book', name: 'Other' });
  const own = await f.create('chapters', { document_id: a.id, name: 'Own chapter', body: 'own' });
  const other = await f.create('chapters', { document_id: b.id, name: 'Protected chapter', body: 'protected' });
  await f.update('documents', a, { description: 'make history' }); const initial = await f.state(), original = await f.backup();
  for (const chapter of [{ ...own, document_id: b.id }, { ...other, document_id: a.id }]) {
    const backup = structuredClone(original); backup.versions.find(v => v.target_id === a.id).snapshot._chapters = [chapter];
    await f.error('POST', '/api/backup/restore', { backup, mode: 'replace', confirm: 'REPLACE' }); await unchanged(f, initial);
  }
});

scenario('24. Create rejects unsafe identifiers while accepting valid stable IDs', async f => {
  for (const id of ['x" autofocus onfocus="alert(1)', '<script>', '../outside', 'with space', 'a'.repeat(201)])
    await f.error('POST', '/api/entities', { id, kind: 'custom', name: 'unsafe' }, 422);
  assert.equal((await f.create('entities', { id: 'safe-ID_1.2:3', kind: 'custom', name: 'safe' })).id, 'safe-ID_1.2:3');
});

scenario('25. Imported entity and version identifiers are validated atomically', async f => {
  const e = await f.entity('custom', 'Before'); await f.update('entities', e, { name: 'After' }); const original = await f.backup();
  for (const collection of ['entities', 'versions']) {
    const backup = structuredClone(original); backup[collection][0].id = 'malicious" onclick="alert(1)';
    await f.error('POST', '/api/backup/restore', { backup, mode: 'replace', confirm: 'REPLACE' }, 422); await unchanged(f, original);
  }
});

scenario('26. D1 cross-request race rejects a stale transaction without partial changes', async f => {
  const e = await f.entity('setting', 'Race');
  const separate = new TestD1(f.dbPath);
  let raced = false;
  f.DB.beforeBatch = async queries => {
    if (!raced && queries.some(q => /INSERT INTO metadata/i.test(q.sql))) {
      raced = true;
      const row = JSON.parse(separate.db.prepare('SELECT record FROM entities WHERE id=?').get(e.id).record);
      row.name = 'Concurrent winner'; row.revision += 1;
      separate.db.prepare('UPDATE entities SET record=? WHERE id=?').run(JSON.stringify(row), e.id);
      separate.db.prepare("INSERT INTO metadata(key,value) VALUES('sites_write_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('concurrent-test-write');
    }
  };
  try {
    await f.error('PATCH', `/api/entities/${e.id}`, { name: 'Stale loser', revision: e.revision }, 409);
    assert.ok(raced, 'Race was not injected'); assert.equal((await f.record('entities', e.id)).name, 'Concurrent winner');
    assert.equal((await f.state()).versions.length, 0, 'Stale transaction wrote partial history');
  } finally { separate.close(); }
});

scenario('27. Failed durable safety backup prevents destructive restore', async f => {
  await f.entity('character', 'Protected'); const before = await f.state(), backup = await f.backup();
  f.env.BUCKET = { put: async () => { throw new Error('simulated R2 outage'); } };
  await f.error('POST', '/api/backup/restore', { backup, mode: 'replace', confirm: 'REPLACE' }); await unchanged(f, before);
});

scenario('28. Original Python SQLite backup imports without changing any collection payload', async f => {
  // A new temporary SQLite file is used: this never opens data/myth.sqlite3.
  const code = `
import json, tempfile
from pathlib import Path
from myth.store import Store
with tempfile.TemporaryDirectory(prefix='myth-python-interop-') as folder:
    s = Store(Path(folder) / 'fixture.sqlite3')
    with s.transaction() as db:
        planet = s.create(db, 'entities', {'kind':'planet','name':'[TEST] 원본 행성'})
        person = s.create(db, 'entities', {'kind':'character','name':'[TEST] 원본 인물','data':{'origin_planet_id':planet['id']}})
        group = s.create(db, 'groups', {'name':'[TEST] 원본 그룹'})
        s.create(db, 'memberships', {'group_id':group['id'],'entity_id':person['id']})
        s.create(db, 'states', {'entity_id':person['id'],'attribute':'생존 상태','value':'생존','start':{'mode':'unknown'}})
        book = s.create(db, 'documents', {'kind':'book','name':'[TEST] 원본 사상집','author_id':person['id'],'body':'원문 그대로 보존','canon_status':'draft'})
        chapter = s.create(db, 'chapters', {'document_id':book['id'],'name':'[TEST] 첫 장','body':'원본 장절','sort_order':2})
        s.create(db, 'relations', {'source_id':person['id'],'target_id':book['id'],'type':'authored'})
        s.update(db, 'chapters', chapter['id'], {'body':'개정 장절'})
        s.update(db, 'documents', book['id'], {'body':'개정 원고'})
        s.delete(db, 'entities', planet['id'])
    print(json.dumps(s.backup(), ensure_ascii=False))
`;
  const backup = JSON.parse(execFileSync('python', ['-c', code], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));
  for (const table of collections) assert.ok(backup[table].length > 0, `Python fixture must exercise ${table}`);
  const result = await f.replace(backup); assert.ok(result.restored > 0);
  await unchanged(f, backup); f.reopen(); await unchanged(f, backup);
  const exported = await f.backup();
  for (const table of collections) assert.deepEqual(exported[table], backup[table]);
});
