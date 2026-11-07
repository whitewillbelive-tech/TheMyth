// Mock-only renderer checks. This does not compile shaders or exercise a GPU,
// browser rendering, graphics drivers, visual appearance, or real performance.
// Run: node tests/atlas-renderer.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../web/atlas-renderer.js', import.meta.url), 'utf8');
const { createRenderer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let nextFrame = null;
let nextId = 1;
globalThis.requestAnimationFrame = fn => { nextFrame = fn; return nextId++; };
globalThis.cancelAnimationFrame = () => { nextFrame = null; };
globalThis.window = { devicePixelRatio: 1 };

let allocations = 0;
let deletions = 0;
const drawCalls = [];
let lastUpload = null;
const gl = new Proxy({
  TRIANGLES: 4, POINTS: 0,
  bufferData: (_target,data) => { if(data instanceof Float32Array)lastUpload=Float32Array.from(data); },
  drawArrays: (mode,first,count) => drawCalls.push({mode,first,count,data:mode===4?lastUpload:null}),
  isContextLost: () => false,
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  createShader: () => ({}),
  createProgram: () => ({}),
  createVertexArray: () => { allocations++; return {}; },
  createBuffer: () => { allocations++; return {}; },
  deleteVertexArray: () => { deletions++; },
  deleteBuffer: () => { deletions++; },
}, { get: (target, prop) => prop in target ? target[prop] : typeof prop === 'string' && prop === prop.toUpperCase() ? 1 : () => {} });

const events = {};
const canvas = {
  width: 0, height: 0,
  getContext: () => gl,
  getBoundingClientRect: () => ({ width: 700, height: 500, left: 0, top: 0 }),
  setPointerCapture: () => {},
  addEventListener: (name, callback) => { events[name] = callback; },
  removeEventListener: name => { delete events[name]; },
};
let labels = [];
const errors = [];
const hoverEvents = [];
const selections = [];
const lineHovers = [];
const lineSelections = [];
const renderer = createRenderer(canvas, {
  onLabels: value => { labels = value; },
  onStatus: value => { if (value.error) errors.push(value.error); },
  onHover: id => hoverEvents.push(id),
  onSelect: id => selections.push(id),
  onLineHover: id => lineHovers.push(id),
  onLineSelect: id => lineSelections.push(id),
});
let time = 0;
function tick(count) {
  for (let i = 0; i < count; i++) {
    const callback = nextFrame;
    assert.ok(callback, 'frame callback exists');
    callback(time += 16);
  }
}

renderer.setScene({
  type: 'planet', occluder: { center: [0, 0, 0], radius: 2.7 },
  objects: [{ id: 'back', x: 0, y: 0, z: -2.77 }],
  meshes: [{ positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]), normals: new Float32Array([0,0,1, 0,0,1, 0,0,1]), color: [1,1,1,.2] }],
  pointSprites: [{ positions: new Float32Array([0,0,0]), colors: new Float32Array([1,1,1,1]), sizes: new Float32Array([4]) }],
});
tick(2);
assert.equal(labels.length, 0, 'back label starts hidden');
assert.equal(renderer.focusObject('missing'), false);
assert.equal(renderer.focusObject('back'), true);
tick(180);
assert.equal(labels[0]?.id, 'back', 'focus brings back marker to front');
renderer.clearFocus();
tick(180);
assert.equal(labels.length, 0, 'clearing focus restores the original occlusion');

const planet = {
  type: 'planet', occluder: { center: [0,0,0], radius: 2.7 },
  objects: [{ id: 'city', type: 'city', x: 0, y: 0, z: -2.77 }, { id: 'other', type: 'city', x: 2.77, y: 0, z: 0 }],
  meshes: [], pointSprites: [],
};
renderer.setScene(planet);
const initialDistance=renderer.getViewState().distance;
assert.equal(renderer.zoomBy(.8),true);
assert.ok(Math.abs(renderer.getViewState().distance-initialDistance*.8)<1e-8,'factor below 1 zooms in');
assert.equal(renderer.zoomBy(1.25),true);
assert.ok(Math.abs(renderer.getViewState().distance-initialDistance)<1e-8,'factor above 1 zooms out');
for(const invalid of [0,-1,NaN,Infinity])assert.equal(renderer.zoomBy(invalid),false,'invalid zoom factor is rejected');
assert.equal(renderer.getViewState().distance,initialDistance,'invalid factor does not change camera');
assert.equal(renderer.zoomBy(1e-100),true);
assert.equal(renderer.getViewState().distance,4.2,'planet camera distance is clamped at minimum');
assert.equal(renderer.zoomBy(1e100),true);
assert.equal(renderer.getViewState().distance,60,'camera distance is clamped at maximum');
renderer.resetView();
let prevented=false;
events.wheel({deltaY:Math.log(1.25)*1000,preventDefault(){prevented=true;}});
assert.ok(prevented,'wheel default is prevented');
assert.ok(Math.abs(renderer.getViewState().distance-initialDistance*1.25)<1e-8,'wheel and button factors follow same zoom rule');
renderer.resetView();
tick(1);
assert.equal(labels[0]?.id, 'city', 'first city is visible initially');
const cityPoint = labels.find(label => label.id === 'city');
assert.ok(cityPoint);
const cityEvent = { clientX: cityPoint.x, clientY: cityPoint.y, pointerId: 1, pointerType: 'mouse' };
events.pointermove(cityEvent);
assert.equal(hoverEvents.at(-1), 'city', 'hover identifies the projected city');
const hoverCount = hoverEvents.length;
events.pointermove(cityEvent);
assert.equal(hoverEvents.length, hoverCount, 'hover events are emitted only on change');
events.pointerleave({});
assert.equal(hoverEvents.at(-1), null, 'leaving canvas clears hover');
events.pointermove(cityEvent);
events.pointerdown(cityEvent);
assert.equal(hoverEvents.at(-1), null, 'pointer down clears hover during drag');
events.pointerup(cityEvent);
assert.equal(selections.at(-1), 'city', 'point click selects the same visible object');
events.pointermove(cityEvent);
renderer.setScene(planet);
assert.equal(hoverEvents.at(-1), null, 'scene change clears active hover');
tick(1);
events.pointerdown({ clientX: 10, clientY: 10, pointerId: 1 });
events.pointermove({ clientX: 50, clientY: 20 });
events.pointerup({ clientX: 50, clientY: 20 });
const before = renderer.getViewState();
assert.equal(renderer.focusObject('other'), true);
tick(150);
const saved = renderer.getViewState();
renderer.setScene(planet);
assert.equal(renderer.setViewState(saved), true);
renderer.clearFocus();
tick(180);
const restored = renderer.getViewState();
const angleDiff = Math.atan2(Math.sin(restored.yaw - before.yaw), Math.cos(restored.yaw - before.yaw));
assert.ok(Math.abs(angleDiff) < .003 && Math.abs(restored.pitch - before.pitch) < .003 && Math.abs(restored.distance - before.distance) < .003, 'restores pre-focus camera across navigation');
assert.deepEqual(errors, []);

// Lines share scene coordinates with points; screen hit tests use the same
// projection in this mock, without asserting actual GPU output.
const validPassage={id:'passage-a',source:[-2,0,0],target:[2,0,0],status:'open',direction:'two-way'};
const endpoints=[{id:'west',x:-2,y:0,z:0},{id:'east',x:2,y:0,z:0}];
renderer.setScene({type:'galaxy',objects:endpoints,meshes:[],pointSprites:[],lines:[validPassage,{id:'invalid',source:[NaN,0,0],target:[2,0,0]},{id:'same-point',source:[0,0,0],target:[0,0,0]}]});
tick(1);
const west=labels.find(p=>p.id==='west'),east=labels.find(p=>p.id==='east');
assert.ok(west&&east);
const midpoint={clientX:(west.x+east.x)/2,clientY:(west.y+east.y)/2,pointerType:'mouse',pointerId:1};
events.pointermove(midpoint);
assert.equal(lineHovers.at(-1),'passage-a','hover selects a visible connection');
events.pointerdown(midpoint);events.pointerup(midpoint);
assert.equal(lineSelections.at(-1),'passage-a','click selects a visible connection');
const lineCount=lineSelections.length;
const markerEvent={clientX:west.x,clientY:west.y,pointerType:'mouse',pointerId:1};
events.pointerdown(markerEvent);events.pointerup(markerEvent);
assert.equal(selections.at(-1),'west','point selection wins when line and marker overlap');
assert.equal(lineSelections.length,lineCount,'marker click does not also select the connection');
const savedCamera=renderer.getViewState(),createdBefore=allocations;
renderer.setLineHighlights(['passage-a']);tick(1);
assert.equal(allocations,createdBefore,'highlighting avoids recreating GPU resources');
assert.deepEqual(renderer.getViewState(),savedCamera,'highlighting preserves camera state');
renderer.setLines([]);tick(1);
events.pointermove(midpoint);events.pointerdown(midpoint);events.pointerup(midpoint);
assert.equal(lineSelections.length,lineCount,'removed or malformed connections cannot be selected');
renderer.setLines([validPassage]);tick(1);
events.pointermove(midpoint);
assert.equal(lineHovers.at(-1),'passage-a','a connection can be restored without changing the scene');

renderer.setScene({type:'planet',objects:[],meshes:[],pointSprites:[],occluder:{center:[0,0,0],radius:2.7},lines:[{id:'hidden',source:[-.4,0,-2.77],target:[.4,0,-2.77]}]});
assert.equal(renderer.setViewState({type:'planet',yaw:0,pitch:0,distance:9.5,focusOrigin:null,cameraTarget:null}),true);
tick(1);events.pointermove({clientX:350,clientY:250,pointerType:'mouse'});
assert.notEqual(lineHovers.at(-1),'hidden','connection behind a planet is not hoverable');
const hiddenCount=lineSelections.length;
events.pointerdown({clientX:350,clientY:250,pointerId:1});events.pointerup({clientX:350,clientY:250,pointerId:1});
assert.equal(lineSelections.length,hiddenCount,'connection behind a planet is not selectable');

renderer.setScene({type:'planet',objects:[],meshes:[],pointSprites:[],lines:[{id:'clipped',source:[0,0,10],target:[3,0,0]}]});
assert.equal(renderer.setViewState({type:'planet',yaw:0,pitch:0,distance:9.5,focusOrigin:null,cameraTarget:null}),true);
drawCalls.length=0;tick(1);
assert.ok(drawCalls.some(call=>call.mode===gl.TRIANGLES&&call.count>0),'connection crossing near plane retains visible projected portion');

// The mocked triangle upload lets us check silhouette spacing and color;
// it does not prove how any browser/GPU will draw the triangles.
renderer.setScene({type:'galaxy',objects:[],meshes:[],pointSprites:[],lines:[]});
assert.equal(renderer.setViewState({type:'galaxy',yaw:0,pitch:0,distance:13,focusOrigin:null,cameraTarget:null}),true);
function inspectPassage(level,status='open',highlighted=false){
  renderer.setLines([{...validPassage,level,status,highlighted}]);drawCalls.length=0;tick(1);
  const data=drawCalls.find(call=>call.mode===gl.TRIANGLES&&call.count>0)?.data;
  assert.ok(data&&data.length>42,'visible line triangles were uploaded');
  const width=Math.abs(data[1]-data[8])*250;
  let previousEnd=null,maxGap=0;
  for(let i=0;i<data.length;i+=42){const start=(data[i]+data[i+7])/2,end=(data[i+14]+data[i+28])/2;if(previousEnd!==null)maxGap=Math.max(maxGap,(start-previousEnd)*350);previousEnd=end;}
  return {width,maxGap,color:Array.from(data.slice(3,7))};
}
const galaxyStyle=inspectPassage('galaxy'),planetStyle=inspectPassage('planet');
assert.ok(galaxyStyle.width>planetStyle.width+.8,'galaxy line is thicker than planet line');
assert.ok(galaxyStyle.maxGap>planetStyle.maxGap+2,'galaxy line has a larger dash gap');
assert.deepEqual(galaxyStyle.color,planetStyle.color,'identical status has identical color across levels');
const restrictedStyle=inspectPassage('planet','restricted');
assert.notDeepEqual(restrictedStyle.color,planetStyle.color,'distinct statuses retain distinct colors');
const highlightedStyle=inspectPassage('planet','open',true);
assert.ok(highlightedStyle.width>planetStyle.width,'highlighting remains visible for a planet line');

renderer.setScene({ type: 'universe', objects: [], meshes: [], pointSprites: [] });
renderer.zoomBy(1e-100);
assert.equal(renderer.getViewState().distance,7,'universe camera distance is clamped at minimum');
renderer.dispose();
assert.equal(allocations, deletions, 'mocked buffers and vertex arrays freed');
assert.equal(nextFrame, null, 'animation callback canceled');
assert.equal(Object.keys(events).length, 0, 'listeners removed');
console.log('PASS: renderer mock tests (not a browser or GPU test)');
