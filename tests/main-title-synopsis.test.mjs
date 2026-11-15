import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE_STORY_FIELDS, titleStoryDraftKey, readTitleStory, titleStoryPayload,
  renderTitleTabs, renderTitleSynopsis, createTitleStoryController,
} from '../web/title-synopsis.js';

const title = (id, name = id) => ({ id, kind: 'title', name, revision: 1, description: '기존 원문 ' + id, data: { synopsis: { ki: '기존 기 ' + id, extra: '보존할 확장값' }, extension: { keep: true } } });
function fixture(initial = [title('a'), title('b')], initialDrafts = {}) {
  const server = new Map(initial.map(row => [row.id, structuredClone(row)]));
  const client = new Map(initial.map(row => [row.id, structuredClone(row)]));
  const drafts = structuredClone(initialDrafts), requests = [], statuses = [], errors = [], timers = new Map();
  let timerId = 0, persisted = null;
  const options = {
    getTitle: id => client.get(id), drafts,
    persistDrafts: () => { persisted = JSON.parse(JSON.stringify(drafts)); },
    onSaved: row => client.set(row.id, structuredClone(row)),
    onStatus: (message, id) => statuses.push({ message, id }),
    onError: (error, id) => errors.push({ error, id }),
    onConflict: async id => { client.set(id, structuredClone(server.get(id))); return client.get(id); },
    setTimer: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimer: id => timers.delete(id),
    api: async (path, method, payload) => {
      requests.push({ path, method, payload: structuredClone(payload) });
      const id = decodeURIComponent(path.split('/')[2]), old = server.get(id);
      if (old.revision !== payload.revision) throw Object.assign(new Error('다른 창에서 변경되었습니다.'), { status: 409 });
      const next = structuredClone(old);
      if (Object.hasOwn(payload, 'overview')) next.data.overview = payload.overview;
      if (payload.synopsis) next.data.synopsis = { ...next.data.synopsis, ...payload.synopsis };
      next.revision += 1; server.set(id, next); return structuredClone(next);
    },
  };
  const controller = createTitleStoryController(options);
  return { server, client, drafts, requests, statuses, errors, timers, controller, options,
    persisted: () => persisted,
    async fireTimer() {
      const [id, callback] = [...timers.entries()][0]; timers.delete(id); callback();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('title story projection keeps legacy overview and escaped title-local long text', () => {
  const row = title('a', '<script>작품</script>');
  assert.equal(readTitleStory(row).overview, row.description);
  row.data.description = '기존 data 설명';
  assert.equal(readTitleStory(row).overview, '기존 data 설명');
  row.data.overview = '';
  assert.equal(readTitleStory(row).overview, '', 'explicitly cleared overview must not revive a legacy description');
  const before = structuredClone(row);
  const drafts = { [titleStoryDraftKey(row.id)]: { base_revision: 1, fields: { ki: '<img src=x onerror=alert(1)>\n긴 초안' } } };
  const html = renderTitleSynopsis(row, { drafts });
  assert.ok(html.includes('&lt;script&gt;작품&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(html.includes('<script>작품</script>'), false);
  for (const field of TITLE_STORY_FIELDS) assert.ok(html.includes(`data-title-story-field="${field.key}"`));
  assert.ok(html.includes('data-title-story-expand="ki"'));
  assert.deepEqual(row, before);
  const tabs = renderTitleTabs([row, title('b')], 'b');
  assert.ok(tabs.includes('data-title-story-select="b"'));
  assert.ok(tabs.includes('aria-selected="true"'));
  assert.equal(tabs.includes('generation'), false, 'the event module does not introduce another generation selector');
});

test('independent field saves and full save remain isolated by title ID and preserve untouched values', async () => {
  const f = fixture();
  try {
    f.controller.stage('a', 'overview', '새로운 작품 A 개요');
    f.controller.stage('a', 'ki', 'A의 기');
    f.controller.stage('b', 'ki', 'B의 기');
    await f.controller.save('a', 'ki');
    assert.deepEqual(f.requests[0], { path: '/titles/a/story', method: 'PATCH', payload: { revision: 1, synopsis: { ki: 'A의 기' } } });
    assert.deepEqual(f.drafts[titleStoryDraftKey('a')], { base_revision: 2, fields: { overview: '새로운 작품 A 개요' } });
    assert.equal(f.server.get('a').description, '기존 원문 a');
    assert.equal(f.server.get('a').data.synopsis.extra, '보존할 확장값');
    assert.equal(f.server.get('b').data.synopsis.ki, '기존 기 b');
    await f.controller.flush(['a']);
    assert.deepEqual(f.requests[1].payload, { revision: 2, overview: '새로운 작품 A 개요' });
    assert.equal(f.drafts[titleStoryDraftKey('a')], undefined);
    assert.equal(f.drafts[titleStoryDraftKey('b')].fields.ki, 'B의 기');
    await f.controller.flush(['b']);
    assert.equal(f.server.get('b').data.synopsis.ki, 'B의 기');
    assert.equal(f.server.get('a').data.synopsis.ki, 'A의 기');
    assert.deepEqual(f.persisted(), {});
  } finally { f.controller.dispose(); }
});

test('autosave coalesces title edits and keeps other fields out of the patch', async () => {
  const f = fixture();
  try {
    f.controller.stage('a', 'seung', '승 첫 초안');
    f.controller.stage('a', 'seung', '승 최신 초안');
    f.controller.stage('a', 'gyeol', '결 초안');
    assert.equal(f.timers.size, 1);
    await f.fireTimer();
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.requests[0].payload, { revision: 1, synopsis: { seung: '승 최신 초안', gyeol: '결 초안' } });
    assert.equal(f.server.get('a').data.synopsis.ki, '기존 기 a');
    assert.equal(f.drafts[titleStoryDraftKey('a')], undefined);
    await f.controller.save('a');
    assert.equal(f.requests.length, 1, 'saving an unchanged editor cannot create another write');
  } finally { f.controller.dispose(); }
});

test('restored stale drafts do not silently rebase or autosave before explicit comparison', async () => {
  const row = title('a'); row.revision = 5;
  const f = fixture([row], { [titleStoryDraftKey('a')]: { base_revision: 2, fields: { jeon: '보존할 과거 초안' } } });
  try {
    f.controller.resume('a');
    assert.equal(f.timers.size, 0);
    await assert.rejects(f.controller.save('a'), error => error.status === 409);
    assert.equal(f.requests.length, 0);
    assert.equal(f.drafts[titleStoryDraftKey('a')].base_revision, 2);
    await assert.rejects(f.controller.rebase('a', false, 5), /차이를 먼저 확인/);
    await assert.rejects(f.controller.rebase('a', true, 4), error => error.status === 409);
    assert.equal(f.requests.length, 0);
    const html = renderTitleSynopsis(row, { drafts: f.drafts });
    assert.ok(html.includes('최신 저장 내용'));
    assert.ok(html.includes('보존할 과거 초안'));
    await f.controller.rebase('a', true, 5);
    assert.equal(f.requests[0].payload.revision, 5);
    assert.equal(f.server.get('a').data.synopsis.jeon, '보존할 과거 초안');
  } finally { f.controller.dispose(); }
});

test('a backend conflict refreshes the comparison while preserving the exact original draft revision', async () => {
  const f = fixture([title('a')]);
  try {
    f.controller.stage('a', 'overview', '내 개요');
    const external = structuredClone(f.server.get('a')); external.revision = 4; external.data.overview = '다른 창의 개요'; f.server.set('a', external);
    await assert.rejects(f.controller.save('a'), error => error.status === 409);
    assert.equal(f.client.get('a').revision, 4);
    assert.equal(f.drafts[titleStoryDraftKey('a')].base_revision, 1);
    assert.equal(f.drafts[titleStoryDraftKey('a')].fields.overview, '내 개요');
    assert.equal(f.timers.size, 0);
    const comparison = renderTitleSynopsis(f.client.get('a'), { drafts: f.drafts });
    assert.ok(comparison.includes('다른 창의 개요')); assert.ok(comparison.includes('내 개요'));
    await f.controller.rebase('a', true, 4);
    assert.deepEqual(f.requests.map(request => request.payload.revision), [1, 4]);
    assert.equal(f.server.get('a').data.overview, '내 개요');
  } finally { f.controller.dispose(); }
});

test('typing during an in-flight save preserves the newer local value for the next revision', async () => {
  const f = fixture([title('a')]);
  let complete;
  const realApi = f.options.api;
  f.controller.dispose();
  const controller = createTitleStoryController({ ...f.options, api: async (...args) => { await new Promise(resolve => { complete = resolve; }); return realApi(...args); } });
  try {
    controller.stage('a', 'ki', '전송한 첫 문장');
    const first = controller.save('a');
    controller.stage('a', 'ki', '전송 중 추가한 문장');
    complete(); await first;
    assert.deepEqual(f.drafts[titleStoryDraftKey('a')], { base_revision: 2, fields: { ki: '전송 중 추가한 문장' } });
    const second = controller.save('a'); complete(); await second;
    assert.deepEqual(f.requests.map(request => request.payload.revision), [1, 2]);
    assert.equal(f.server.get('a').data.synopsis.ki, '전송 중 추가한 문장');
    assert.equal(f.drafts[titleStoryDraftKey('a')], undefined);
  } finally { controller.dispose(); }
});

test('network failure retains recoverable drafts and discard cancels the queued write', async () => {
  const f = fixture([title('a')]); f.controller.dispose();
  const controller = createTitleStoryController({ ...f.options, api: async () => { throw new Error('연결 실패'); } });
  try {
    controller.stage('a', 'gyeol', '긴 결말\n'.repeat(3000));
    await assert.rejects(controller.save('a'), /연결 실패/);
    assert.equal(f.persisted()[titleStoryDraftKey('a')].fields.gyeol, '긴 결말\n'.repeat(3000));
    assert.equal(f.persisted()[titleStoryDraftKey('a')].base_revision, 1);
    controller.discard('a');
    assert.equal(f.drafts[titleStoryDraftKey('a')], undefined);
    assert.equal(f.timers.size, 0);
  } finally { controller.dispose(); }
  assert.throws(() => titleStoryPayload({ unexpected: 'x' }, 1), /항목|텍스트/);
});
