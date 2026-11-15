import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const encode = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const readWeb = name => readFile(new URL('../web/' + name, import.meta.url), 'utf8');
const data = encode(await readWeb('atlas-data.js'));
const navigation = encode(await readWeb('atlas-navigation.js'));
const passages = encode(await readWeb('atlas-passages.js'));
const passageView = encode((await readWeb('atlas-passage-view.js')).replace("'./atlas-passages.js'", JSON.stringify(passages)));
let source = await readWeb('atlas-view.js');
for (const [from, to] of [
  ["'/atlas-data.js'", data], ["'/atlas-navigation.js'", navigation],
  ["'/atlas-passages.js'", passages], ["'/atlas-passage-view.js'", passageView],
  ["'/atlas-renderer.js'", encode('export const createRenderer=(...args)=>globalThis.__nov15AtlasRenderer(...args);')],
  ["'/atlas-geometry.js'", encode('export const buildDemoScene=()=>({});')],
  ["'/atlas-city-map.js'", encode('export const mountCityMap=()=>({dispose(){}});')],
]) source = source.replace(from, JSON.stringify(to));
const { createAtlasFullscreen, renderAtlasRecordDetails, mountAtlas } = await import(encode(source));

// These exercise native/fullscreen lifecycle contracts and archive projection.
// Actual browser permissions, CSS layout and WebGL are separate browser checks.
class Events {
  constructor() { this.events = new Map(); }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  fire(type, value = {}) { for (const fn of [...(this.events.get(type) || [])]) fn(value); }
  listenerCount() { return [...this.events.values()].reduce((sum, set) => sum + set.size, 0); }
}
function fixture({ reject = false, native = true, pending = null } = {}) {
  const doc = new Events(), win = new Events(), classes = new Set(), attributes = {};
  doc.body = { style: { overflow: 'scroll' } }; doc.fullscreenElement = null; doc.defaultView = win;
  const observed = [];
  win.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observed.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  };
  const element = {
    ownerDocument: doc,
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); return enabled; },
      remove(...names) { for (const name of names) classes.delete(name); },
    },
    setAttribute(name, value) { attributes[name] = value; },
  };
  let enterCalls = 0, exitCalls = 0;
  if (native) element.requestFullscreen = async () => {
    enterCalls++;
    if (pending) await pending;
    if (reject) throw Error('NotAllowedError');
    doc.fullscreenElement = element; doc.fire('fullscreenchange');
  };
  doc.exitFullscreen = async () => { exitCalls++; doc.fullscreenElement = null; doc.fire('fullscreenchange'); };
  return { doc, win, element, observed, classes, attributes, calls: () => ({ enterCalls, exitCalls }) };
}

test('native fullscreen and external Escape exit preserve viewer state and use resize without recreating rendering', async () => {
  const f = fixture(), camera = { yaw: 0.7, distance: 13, selected: 'planet-existing' }, before = structuredClone(camera);
  let resizes = 0, last;
  const control = createAtlasFullscreen(f.element, { onResize() { resizes++; }, onChange(state) { last = state; } });
  assert.equal(await control.enter(), true);
  assert.deepEqual(last, { active: true, mode: 'native' });
  assert.equal(f.doc.fullscreenElement, f.element);
  assert.ok(f.classes.has('atlas-maximized'));
  f.observed[0].callback(); f.win.fire('resize');
  assert.ok(resizes >= 3);
  assert.deepEqual(camera, before, 'resize lifecycle never rewrites the camera/selection');
  f.doc.fullscreenElement = null; f.doc.fire('fullscreenchange');
  assert.deepEqual(control.state(), { active: false, mode: null, pending: false });
  assert.equal(f.classes.has('atlas-maximized'), false);
  assert.equal(f.doc.body.style.overflow, 'scroll');
  control.dispose();
  assert.equal(f.doc.listenerCount(), 0); assert.equal(f.win.listenerCount(), 0);
  assert.equal(f.observed[0].disconnected, true);
  const saved = resizes; f.observed[0].callback();
  assert.equal(resizes, saved, 'disposed resize observer callback does no work');
});

test('denied or unavailable Fullscreen API uses in-page maximize and Escape restores scroll/layout', async () => {
  for (const options of [{ reject: true }, { native: false }]) {
    const f = fixture(options), changes = [];
    const control = createAtlasFullscreen(f.element, { onChange: state => changes.push(state) });
    assert.equal(await control.enter(), true);
    assert.equal(control.state().mode, 'fallback');
    assert.equal(f.doc.body.style.overflow, 'hidden');
    let prevented = false;
    f.doc.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
    await Promise.resolve();
    assert.equal(prevented, true);
    assert.equal(control.state().active, false);
    assert.equal(f.doc.body.style.overflow, 'scroll');
    assert.equal(f.classes.has('atlas-maximized'), false);
    assert.equal(f.calls().exitCalls, 0, 'fallback exit does not exit another element full screen');
    assert.equal(changes.at(-1).active, false);
    control.dispose();
  }
});

test('disposing during a pending native request prevents late activation and removes all observers/listeners', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ pending }), states = [];
  const control = createAtlasFullscreen(f.element, { onChange: state => states.push(state) });
  const opening = control.enter();
  assert.equal(await control.enter(), false, 'rapid repeat does not issue another request');
  control.dispose(); control.dispose();
  release();
  assert.equal(await opening, false);
  assert.equal(f.doc.fullscreenElement, null, 'late fullscreen is immediately exited');
  assert.equal(f.classes.has('atlas-maximized'), false);
  assert.equal(states.length, 0, 'late promise cannot update an unmounted viewer');
  assert.deepEqual(f.calls(), { enterCalls: 1, exitCalls: 1 });
  assert.equal(f.doc.listenerCount(), 0); assert.equal(f.win.listenerCount(), 0);
  assert.equal(f.observed[0].disconnected, true);
});

test('read-only real spatial details expose stored facts and direct references without mutations, fake coordinates or demo leakage', () => {
  const entities = [
    { id: 'g', kind: 'space', name: '실제 은하', data: { subtype: 'galaxy' } },
    { id: 'p', kind: 'planet', name: '선택 행성', description: '<script>원문</script>', data: { parent_id: 'g', civilization_id: 'civil', environment: '기록된 기후', unconfirmed: null } },
    { id: 'person', kind: 'character', name: '관련 인물', data: { origin_planet_id: 'p' } },
    { id: 'org', kind: 'organization', name: '관련 집단', data: {} },
    { id: 'civil', kind: 'civilization', name: '기록된 문명', data: {} },
    { id: 'unrelated', kind: 'character', name: '연결 없는 인물', data: {} },
  ];
  const context = { entities, relations: [{ id: 'r', source_id: 'p', target_id: 'org', type: 'governs' }], groups: [{ id: 'grp', name: '연결 그룹' }], memberships: [{ id: 'm', entity_id: 'p', group_id: 'grp' }] };
  const before = structuredClone(context), html = renderAtlasRecordDetails({ id: 'p', type: 'planet', coords: null, demo: false }, context);
  for (const text of ['읽기 전용', '선택 행성', '실제 은하', '관련 인물', '관련 집단', '기록된 문명', '연결 그룹', '기록된 기후', '좌표 미등록']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('&lt;script&gt;원문&lt;/script&gt;'));
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('연결 없는 인물'), false);
  assert.doesNotMatch(html, /<(input|textarea|select)\b|contenteditable|data-action="(?:new|edit|delete)/);
  assert.deepEqual(context, before);
  assert.equal(renderAtlasRecordDetails({ id: 'demo:p', demo: true }, context), '', 'demo nodes do not borrow real archive facts');
  const unknown = renderAtlasRecordDetails({ id: 'g', type: 'galaxy' }, context);
  assert.ok(unknown.includes('미등록'));
  assert.equal(unknown.includes('가상'), false);
});

test('mounted Atlas opens real reference selections and fullscreen retains their scene, camera and readonly facts', async () => {
  const f = fixture(), controls = new Map(), classes = new Set();
  const root = new Events();
  Object.assign(root, {
    ownerDocument: f.doc, innerHTML: '',
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      toggle(name, value) { const next = value ?? !classes.has(name); next ? classes.add(name) : classes.delete(name); return next; },
    },
    setAttribute() {},
    async requestFullscreen() { f.doc.fullscreenElement = root; f.doc.fire('fullscreenchange'); },
    querySelector(selector) {
      if (!controls.has(selector)) {
        const control = new Events();
        Object.assign(control, { innerHTML: '', textContent: '', value: selector === '#atlas-density' ? 'standard' : selector === '#passage-status' ? 'all' : '', checked: true, children: [], style: {}, attributes: {}, replaceChildren() { this.children = []; }, setAttribute(key, value) { this.attributes[key] = value; } });
        controls.set(selector, control);
      }
      return controls.get(selector);
    },
    querySelectorAll() { return [{ dataset: { atlas: 'real' }, setAttribute() {} }, { dataset: { atlas: 'demo' }, setAttribute() {} }]; },
    click(action, id) {
      const control = this.querySelector(id ? '[data-atlas-select="' + id + '"]' : '[data-atlas="' + action + '"]');
      control.dataset = id ? { atlasSelect: id } : { atlas: action };
      control.closest = selector => selector === (id ? '[data-atlas-select]' : '[data-atlas]') ? control : null;
      this.fire('click', { target: control });
    },
  });
  const old = globalThis.__nov15AtlasRenderer;
  let renderer, created = 0;
  globalThis.__nov15AtlasRenderer = () => {
    created++;
    renderer = { scenes: 0, resizes: 0, disposed: false, camera: { yaw: 0.2, distance: 13 }, setScene() { this.scenes++; }, setLineHighlights() {}, resize() { this.resizes++; }, dispose() { this.disposed = true; } };
    return renderer;
  };
  try {
    const archive = [{ id: 'galaxy', kind: 'space', name: '원본 은하', description: '저장된 설명', data: { subtype: 'galaxy' } }];
    const original = structuredClone(archive), dispose = mountAtlas(root, archive, [], { initialSelectionId: 'galaxy' });
    assert.match(root.querySelector('#atlas-path').textContent, /원본 은하$/);
    assert.equal(renderer.scenes, 1, 'initial reference selection avoids a throwaway root scene');
    renderer.camera = { yaw: 0.85, distance: 21 };
    const sceneCount = renderer.scenes, camera = structuredClone(renderer.camera), path = root.querySelector('#atlas-path').textContent;
    assert.match(root.querySelector('#atlas-detail').innerHTML, /저장된 설명/);
    root.click('fullscreen'); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.doc.fullscreenElement, root);
    assert.equal(root.querySelector('[data-atlas="fullscreen"]').textContent, '전체 화면 종료');
    root.click('info-toggle');
    assert.equal(classes.has('atlas-info-collapsed'), true);
    root.click('info-toggle');
    assert.equal(classes.has('atlas-info-collapsed'), false);
    f.observed[0].callback();
    assert.ok(renderer.resizes > 0);
    assert.equal(renderer.scenes, sceneCount, 'fullscreen/panel resizing never calls setScene');
    assert.equal(created, 1, 'fullscreen cannot create another renderer or animation loop');
    assert.deepEqual(renderer.camera, camera);
    assert.equal(root.querySelector('#atlas-path').textContent, path);
    f.doc.fire('keydown', { key: 'Escape' }); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.doc.fullscreenElement, null);
    assert.equal(root.querySelector('[data-atlas="fullscreen"]').textContent, '전체 화면');
    assert.deepEqual(archive, original);
    dispose(); dispose();
    assert.equal(renderer.disposed, true); assert.equal(root.listenerCount(), 0);
    assert.equal(f.doc.listenerCount(), 0); assert.equal(f.observed[0].disconnected, true);
    const cityArchive = [...archive,
      { id: 'planet', kind: 'planet', name: '원본 행성', data: { parent_id: 'galaxy' } },
      { id: 'city', kind: 'space', name: '원본 도시', description: '원본 도시 설명', data: { subtype: 'city', parent_id: 'planet' } },
    ];
    const cityBefore = structuredClone(cityArchive), rendererCount = created;
    const disposeCity = mountAtlas(root, cityArchive, [], { initialSelectionId: 'city' });
    assert.match(root.querySelector('#atlas-path').textContent, /원본 은하.*원본 행성.*원본 도시$/);
    assert.equal(root.querySelector('#atlas-city-root').hidden, false, 'a direct city reference enters the existing 2D city view');
    assert.equal(created, rendererCount, 'direct city entry does not briefly create a 3D renderer');
    assert.match(root.querySelector('#atlas-detail').innerHTML, /원본 도시 설명/);
    assert.match(root.querySelector('#atlas-detail').innerHTML, /원본 행성/);
    assert.deepEqual(cityArchive, cityBefore);
    disposeCity();
    const disposeUnknown = mountAtlas(root, archive, [], { initialSelectionId: 'demo:gal-01' });
    assert.equal(root.querySelector('#atlas-path').textContent, '우주', 'an unregistered demo reference cannot enter real archive navigation');
    assert.match(root.querySelector('#atlas-mode').textContent, /실제 자료/);
    assert.deepEqual(archive, original);
    disposeUnknown();
  } finally {
    if (old === undefined) delete globalThis.__nov15AtlasRenderer; else globalThis.__nov15AtlasRenderer = old;
  }
});
