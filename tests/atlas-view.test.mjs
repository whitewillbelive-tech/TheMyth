// Fake-DOM event tests only: no browser, hit-testing, WebGL, pixel output or GPU.
// Run: node tests/atlas-view.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base64 = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const readWeb = name => readFile(new URL(`../web/${name}`, import.meta.url), 'utf8');
const dataUrl = base64(await readWeb('atlas-data.js'));
const navigationUrl = base64(await readWeb('atlas-navigation.js'));
const passagesUrl = base64(await readWeb('atlas-passages.js'));
const passageViewUrl = base64((await readWeb('atlas-passage-view.js')).replace("'./atlas-passages.js'",JSON.stringify(passagesUrl)));
const mockRendererUrl = base64('export const createRenderer=(...args)=>globalThis.__atlasViewTest.createRenderer(...args);');
const mockGeometryUrl = base64('export const buildDemoScene=({type,objects})=>({type,objects,meshes:[]});');
const mockCityUrl = base64('export const mountCityMap=(...args)=>globalThis.__atlasViewTest.mountCityMap(...args);');
const code = (await readWeb('atlas-view.js'))
  .replace("'/atlas-data.js'", JSON.stringify(dataUrl))
  .replace("'/atlas-navigation.js'", JSON.stringify(navigationUrl))
  .replace("'/atlas-passages.js'", JSON.stringify(passagesUrl))
  .replace("'/atlas-passage-view.js'", JSON.stringify(passageViewUrl))
  .replace("'/atlas-renderer.js'", JSON.stringify(mockRendererUrl))
  .replace("'/atlas-geometry.js'", JSON.stringify(mockGeometryUrl))
  .replace("'/atlas-city-map.js'", JSON.stringify(mockCityUrl));
const { mountAtlas } = await import(base64(code));

class FakeElement {
  constructor() { this.innerHTML = ''; this.textContent = ''; this.value = ''; this.checked = false; this.children = []; this.hidden = false; this.style = {}; this.events = {}; this.attributes = {}; }
  addEventListener(name, callback) { this.events[name] = callback; }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
class FakeRoot extends FakeElement {
  constructor() {
    super(); this.elements = new Map();
    for (const key of ['#atlas-mode','#atlas-path','#atlas-labels','#atlas-canvas','#atlas-density','#atlas-performance','#atlas-search','#atlas-list-label','#atlas-rows','#atlas-detail','#atlas-hover','#atlas-city-root','#passage-caption','#passage-enabled','#passage-galaxy','#passage-planet','#passage-status','#passage-object','#passage-list','#passage-detail','.atlas-canvas-wrap','.atlas-view-bottom','[data-atlas="back"]','[data-atlas="planet-return"]']) this.elements.set(key,new FakeElement());
    this.elements.get('#atlas-density').value='standard';
    this.elements.get('#passage-status').value='all';
    for(const key of ['#passage-enabled','#passage-galaxy','#passage-planet'])this.elements.get(key).checked=true;
    const wrap=this.elements.get('.atlas-canvas-wrap');
    wrap.getBoundingClientRect=()=>({width:700,height:500});wrap.animations=[];
    wrap.animate=(keyframes,options)=>{const animation={keyframes,options,onfinish:null,cancelled:false,cancel(){this.cancelled=true;}};wrap.animations.push(animation);return animation;};
    this.modeButtons = [new FakeElement(),new FakeElement()];
    this.modeButtons[0].dataset={atlas:'real'}; this.modeButtons[1].dataset={atlas:'demo'};
  }
  querySelector(selector) { const el=this.elements.get(selector); assert.ok(el,`fake DOM needs selector ${selector}`); return el; }
  querySelectorAll(selector) { assert.equal(selector,'[data-atlas="real"], [data-atlas="demo"]'); return this.modeButtons; }
  click(kind, value) {
    const dataset = kind==='action'?{atlas:value}:kind==='marker'?{atlasMarker:value}:kind==='passage'?{passageId:value}:{atlasSelect:value};
    const expected = kind==='action'?'[data-atlas]':kind==='marker'?'[data-atlas-marker]':kind==='passage'?'[data-passage-id]':'[data-atlas-select]';
    const target={dataset,closest:selector=>selector===expected?target:null};
    this.events.click({target});
  }
}
let renderer;
const renderers=[];
const cityMaps=[];
globalThis.__atlasViewTest={createRenderer(_canvas, callbacks){
  renderer={callbacks, scene:null, focusCalls:[], restoreCalls:[], zoomCalls:[], clearCount:0, disposed:false, rafRunning:true, state:null,
    setScene(scene){this.scene=scene;this.state={type:scene.type,yaw:-.45,pitch:scene.type==='galaxy'?.8:.25,distance:scene.type==='galaxy'?13:18,focusOrigin:null,cameraTarget:null};},
    setLines(lines){this.scene.lines=lines;},setLineHighlights(ids){this.lineHighlights=ids;},
    focusObject(id){this.focusCalls.push(id);if(this.scene.type!=='planet'||!this.scene.objects.some(o=>o.id===id))return false;this.state={type:'planet',focused:id,original:'manual camera'};return true;},
    getViewState(){return this.state&&{...this.state};},
    setViewState(state){this.restoreCalls.push(state);this.state=state;return true;},
    clearFocus(){this.clearCount++;},resetView(){},setDensity(){},zoomBy(factor){this.zoomCalls.push(factor);},dispose(){this.disposed=true;this.rafRunning=false;},
  }; renderers.push(renderer);return renderer;
},mountCityMap(element,city,options){
  const map={element,city,options,disposed:false,dispose(){this.disposed=true;}};cityMaps.push(map);return map;
}};
const root=new FakeRoot();
const unmount=mountAtlas(root,[]);
root.click('action','demo');
assert.equal(renderer.scene.type,'universe');
assert.match(root.innerHTML,/data-atlas="zoom-in"/,'zoom-in button is present');
assert.match(root.innerHTML,/data-atlas="zoom-out"/,'zoom-out button is present');
root.click('action','zoom-in');root.click('action','zoom-out');
assert.deepEqual(renderer.zoomCalls,[.8,1.25],'zoom buttons call expected renderer factors');
renderer.state={type:'universe',yaw:1.13,pitch:-.36,distance:24,focusOrigin:null,cameraTarget:null};
renderer.callbacks.onLabels([{id:'demo:gal-01',x:450,y:190,r:12}]);
renderer.callbacks.onSelect('demo:gal-01');
assert.equal(renderer.scene.type,'universe','galaxy transition starts before scene replacement');
const approach=root.querySelector('.atlas-canvas-wrap').animations.at(-1);
assert.ok(approach,'galaxy approach animation starts');
assert.equal(approach.options.duration,450);
assert.equal(root.querySelector('.atlas-canvas-wrap').style.transformOrigin,'450px 190px','approach centers on selected object');
assert.equal(typeof approach.onfinish,'function');
approach.onfinish();
assert.equal(approach.cancelled,true,'finished animation is removed');
assert.equal(renderer.scene.type,'galaxy');
assert.equal(renderer.restoreCalls.at(-1)?.type,'galaxy','entering galaxy applies galaxy camera state');
assert.equal(renderer.restoreCalls.at(-1)?.yaw,1.13,'galaxy preserves universe yaw');
assert.equal(renderer.restoreCalls.at(-1)?.pitch,-.36,'galaxy preserves universe pitch');
assert.equal(renderer.restoreCalls.at(-1)?.distance,13,'galaxy retains its own default framing distance');
root.click('action','back');
assert.equal(renderer.scene.type,'universe');
root.click('item','demo:gal-01');
const interrupted=root.querySelector('.atlas-canvas-wrap').animations.at(-1);
const staleFinish=interrupted.onfinish;
root.click('action','real');
assert.equal(interrupted.cancelled,true,'switching mode cancels the pending transition');
staleFinish();
assert.equal(renderer.scene.type,'unavailable','canceled transition cannot switch scenes afterward');
root.click('action','demo');
renderer.state={type:'universe',yaw:-.78,pitch:.42,distance:20,focusOrigin:null,cameraTarget:null};
root.querySelector('.atlas-canvas-wrap').animate=undefined;
root.click('item','demo:gal-01');
assert.equal(renderer.scene.type,'galaxy','without animation support galaxy entry is immediate');
assert.equal(renderer.restoreCalls.at(-1)?.yaw,-.78,'fallback preserves yaw');
assert.equal(renderer.restoreCalls.at(-1)?.pitch,.42,'fallback preserves pitch');
root.click('item','demo:p-01');
assert.equal(renderer.scene.type,'planet');
assert.match(root.querySelector('#atlas-labels').innerHTML,/data-atlas-marker="demo:city-01"/, 'city label is a marker control');

root.click('item','demo:city-01');
assert.equal(renderer.scene.type,'planet','city list selection focuses without leaving planet');
assert.equal(renderer.focusCalls.at(-1),'demo:city-01');
assert.match(root.querySelector('#atlas-detail').innerHTML,/가상 도시로 이동/);
root.click('action','back');
assert.equal(renderer.scene.type,'planet','back clears list focus in place');
assert.equal(renderer.clearCount,1);

const planetRenderer=renderer;
planetRenderer.callbacks.onSelect('demo:city-01');
assert.equal(planetRenderer.disposed,true,'3D renderer is disposed when entering city');
assert.equal(planetRenderer.rafRunning,false,'mock 3D animation loop is stopped in city');
assert.equal(cityMaps.at(-1)?.city.id,'demo:city-01','canvas marker mounts the 2D city map');
assert.equal(cityMaps.at(-1)?.options.mode,'demo');
assert.equal(root.querySelector('#atlas-city-root').hidden,false);
assert.equal(root.querySelector('[data-atlas="planet-return"]').hidden,false,'planet return appears inside demo city');
assert.equal(root.querySelector('.atlas-canvas-wrap').hidden,true);
assert.equal(root.querySelector('.atlas-view-bottom').hidden,true);
assert.match(root.querySelector('#atlas-performance').textContent,/2D 지도/);
const firstMap=cityMaps.at(-1);
root.click('action','back');
assert.equal(firstMap.disposed,true,'city map is disposed on return');
assert.notEqual(renderer,planetRenderer,'return creates a new renderer');
assert.equal(renderer.scene.type,'planet','city back returns to planet');
assert.equal(renderer.rafRunning,true,'new mock 3D loop is active');
assert.equal(renderer.restoreCalls.at(-1)?.focused,'demo:city-01','city back restores city focus');
assert.equal(renderer.restoreCalls.at(-1)?.original,'manual camera','pre-focus camera context is preserved');
assert.equal(root.querySelector('#atlas-city-root').hidden,true);
assert.equal(root.querySelector('.atlas-canvas-wrap').hidden,false);
assert.match(root.querySelector('#atlas-detail').innerHTML,/가상 도시로 이동/);
root.click('action','back');
assert.equal(renderer.clearCount,1,'another back clears focus after returning from city');

const secondPlanetRenderer=renderer;
root.click('marker','demo:city-01');
assert.equal(secondPlanetRenderer.disposed,true,'DOM city label also disposes renderer');
assert.equal(secondPlanetRenderer.rafRunning,false);
assert.equal(cityMaps.at(-1)?.city.id,'demo:city-01','DOM city label enters 2D city');
const secondMap=cityMaps.at(-1);
root.click('action','planet-return');
assert.equal(secondMap.disposed,true);
assert.notEqual(renderer,secondPlanetRenderer);
assert.equal(renderer.scene.type,'planet');
assert.equal(renderer.restoreCalls.at(-1)?.focused,'demo:city-01');
assert.equal(root.querySelector('[data-atlas="planet-return"]').hidden,true,'planet return is hidden after leaving the city');
unmount();
assert.equal(renderer.disposed,true);
assert.equal(renderer.rafRunning,false);
assert.ok(renderers.every(item=>item.disposed),'all mocked renderers eventually disposed');
assert.ok(cityMaps.every(item=>item.disposed),'all mocked 2D maps eventually disposed');

// Actual records are deliberately coordinate-free; this checks the navigation
// fallback using synthetic fixtures, with no writes to the archive.
const realRoot=new FakeRoot();
const realEntities=[
  {id:'fixture-galaxy',kind:'space',name:'실제 목록 은하',data:{subtype:'은하'}},
  {id:'fixture-planet',kind:'planet',name:'실제 목록 행성',data:{parent_id:'fixture-galaxy'}},
  {id:'fixture-continent',kind:'space',name:'실제 목록 대륙',data:{subtype:'대륙',parent_id:'fixture-planet'}},
  {id:'fixture-city',kind:'space',name:'실제 목록 도시',data:{subtype:'도시',parent_id:'fixture-continent'}},
];
const unmountReal=mountAtlas(realRoot,realEntities);
assert.equal(realRoot.querySelector('[data-atlas="planet-return"]').hidden,true,'planet return is absent outside city');
realRoot.click('item','fixture-city');
assert.equal(cityMaps.at(-1)?.city.id,'fixture-city','coordinate-free city opens 2D fallback');
assert.equal(cityMaps.at(-1)?.options.mode,'real');
assert.equal(realRoot.querySelector('[data-atlas="planet-return"]').hidden,false,'planet return appears in coordinate-free city');
assert.match(realRoot.querySelector('#atlas-path').textContent,/실제 목록 도시/);
const realCityMap=cityMaps.at(-1);
realRoot.click('action','planet-return');
assert.equal(realCityMap.disposed,true,'leaving fallback disposes its 2D map');
assert.equal(renderer.scene.type,'unavailable','coordinate-free planet retains unavailable 3D fallback');
assert.match(realRoot.querySelector('#atlas-path').textContent,/실제 목록 행성$/,'returns directly to the correct planet');
assert.equal(realRoot.querySelector('[data-atlas="planet-return"]').hidden,true);
unmountReal();

// A5 integration: exercise panel events against real passage/data modules with a
// fake renderer and fake DOM. These checks do not verify actual line hit-testing.
const passageRoot=new FakeRoot();
const unmountPassage=mountAtlas(passageRoot,realEntities);
const control=id=>passageRoot.querySelector('#'+id);
const change=(id,value)=>{const el=control(id);if(typeof value==='boolean')el.checked=value;else el.value=value;el.events.change({target:el});};
passageRoot.click('action','demo');
assert.equal(renderer.scene.type,'universe');
assert.equal(renderer.scene.lines.length,1,'demo universe has one galaxy connection');
assert.match(control('passage-list').innerHTML,/demo:passage-gal-01/);
assert.doesNotMatch(control('passage-list').innerHTML,/demo:passage-planet-01/);
change('passage-enabled',false);
assert.equal(renderer.scene.lines.length,0,'hiding passage lines leaves the scene in place');
assert.match(control('passage-list').innerHTML,/demo:passage-gal-01/,'line toggle does not hide the network list');
change('passage-enabled',true);
assert.equal(renderer.scene.lines.length,1);
change('passage-galaxy',false);
assert.equal(renderer.scene.lines.length,0);
assert.doesNotMatch(control('passage-list').innerHTML,/demo:passage-gal-01/);
change('passage-galaxy',true);
change('passage-status','closed');
assert.equal(renderer.scene.lines.length,0);
assert.match(control('passage-list').innerHTML,/표시할 통로가 없습니다/);
change('passage-status','restricted');
assert.equal(renderer.scene.lines.length,1);
const sceneBeforePassage=renderer.scene, pathBeforePassage=control('atlas-path').textContent;
passageRoot.click('passage','demo:passage-gal-01');
assert.equal(renderer.scene,sceneBeforePassage,'network row selection does not transition');
assert.equal(control('atlas-path').textContent,pathBeforePassage);
assert.match(control('passage-detail').innerHTML,/가상 항로 관리국/);
assert.match(control('passage-detail').innerHTML,/demo:gal-01/);
assert.deepEqual(renderer.lineHighlights,['demo:passage-gal-01']);
renderer.callbacks.onLineSelect('demo:passage-gal-01');
assert.equal(renderer.scene,sceneBeforePassage,'line-selection callback does not transition');
assert.equal(control('atlas-path').textContent,pathBeforePassage);
assert.match(control('passage-detail').innerHTML,/양방향/);
renderer.callbacks.onLineHover('demo:passage-gal-01');
assert.match(control('atlas-hover').textContent,/가상 은하/);
change('passage-object','demo:gal-02');
assert.ok(renderer.lineHighlights.includes('demo:passage-gal-01'));
change('passage-status','all');
passageRoot.querySelector('.atlas-canvas-wrap').animate=undefined;
passageRoot.click('item','demo:gal-01');
assert.equal(renderer.scene.type,'galaxy');
assert.match(control('passage-list').innerHTML,/demo:passage-planet-01/,'galaxy list includes its planet passage');
assert.equal(renderer.scene.lines.length,1,'only endpoints in current frame get a line');
change('passage-planet',false);
assert.doesNotMatch(control('passage-list').innerHTML,/demo:passage-planet-01/);
assert.equal(renderer.scene.lines.length,0);
change('passage-planet',true);
change('passage-status','open');
assert.match(control('passage-list').innerHTML,/demo:passage-planet-01/);
assert.doesNotMatch(control('passage-list').innerHTML,/demo:passage-gal-01/);
change('passage-status','all');
passageRoot.click('item','demo:p-01');
assert.equal(renderer.scene.type,'planet');
assert.match(control('passage-list').innerHTML,/demo:passage-planet-01/,'planet sees explicitly connected network');
assert.equal(renderer.scene.lines.length,0,'planet screen is not a route-line frame');
passageRoot.click('passage','demo:passage-planet-01');
assert.match(control('passage-detail').innerHTML,/가상 관문 관리소/);
renderer.callbacks.onSelect('demo:city-01');
assert.equal(cityMaps.at(-1).city.id,'demo:city-01');
const gate=cityMaps.at(-1).city.visual.region.gateFacilities.find(f=>f.id==='demo:gate-city-01');
cityMaps.at(-1).options.onSelect({...gate,kind:'가상 관문 시설'});
assert.match(control('atlas-detail').innerHTML,/연결 통로 ID: demo:passage-planet-01/);
assert.match(control('passage-detail').innerHTML,/가상 관문 관리소/);
passageRoot.click('action','real');
assert.equal(renderer.scene.type,'unavailable');
assert.match(control('passage-caption').textContent,/실제 통로 자료 없음 또는 확인 불가/);
assert.doesNotMatch(control('passage-list').innerHTML,/demo:passage/);
assert.equal(renderer.scene.lines.length,0);
assert.equal(control('passage-detail').innerHTML,'');
unmountPassage();
delete globalThis.__atlasViewTest;
console.log('PASS: atlas view fake-DOM event tests (not a browser or GPU test)');
