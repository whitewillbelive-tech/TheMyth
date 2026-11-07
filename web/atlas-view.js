import { adaptWorld, makeDemo, childrenFor, sceneObjects, distanceBetween } from '/atlas-data.js';
import { createRenderer } from '/atlas-renderer.js';
import { buildDemoScene } from '/atlas-geometry.js';
import { ancestry, planetPathForCity } from '/atlas-navigation.js';
import { mountCityMap } from '/atlas-city-map.js';
import { adaptPassages, makeDemoPassages } from '/atlas-passages.js';
import { selectPassageRows, makePassageLines, highlightedPassageIds, limitPassageLines } from '/atlas-passage-view.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types = {galaxy:'은하',planet:'행성',continent:'대륙',region:'지역',city:'도시',other:'공간'};
const statusLabel = status => ({noncanon:'비정사',confirmed:'정사',draft:'초안',undecided:'미정'}[status] || status || '정사 여부 미정');

// Never invokes an API or changes the caller's archive state.
export function mountAtlas(root, entities, relations = []) {
  const real = adaptWorld(entities);
  let mode = 'real', nodes = real, path = [], renderer = null, cityMap = null, query = '', focusedId = null, surfaceOrigin = null, approach = null, projectedLabels = [];
  let error = '', passages=adaptPassages(real,[]), passageRows=[], selectedPassage=null, selectedObject=null, hoveredObject=null, lastScene=null;
  root.innerHTML = `<div class="atlas-bar"><div><strong>자료 출처</strong> <button type="button" data-atlas="real" aria-pressed="true">실제 자료</button> <button type="button" data-atlas="demo" aria-pressed="false">가상 데모</button></div><p id="atlas-mode"></p></div><div class="atlas-layout"><section class="atlas-view"><div class="atlas-view-top"><span id="atlas-path"></span><div><button type="button" data-atlas="planet-return" hidden>행성으로</button><button type="button" data-atlas="back">← 이전</button></div></div><div class="atlas-canvas-wrap"><canvas id="atlas-canvas" aria-label="3D 우주 지도. 객체는 오른쪽 목록에서도 선택할 수 있습니다."></canvas><div id="atlas-labels"></div></div><div id="atlas-city-root" hidden></div><div class="atlas-view-bottom"><span>드래그 회전 · 휠 확대/축소 · 점 선택 <strong id="atlas-hover"></strong></span><label>입자 <select id="atlas-density"><option value="standard">기본</option><option value="high">많이</option></select></label><button type="button" data-atlas="zoom-in" aria-label="3D 지도 확대">+</button><button type="button" data-atlas="zoom-out" aria-label="3D 지도 축소">−</button><button type="button" data-atlas="reset">시점 초기화</button></div><p id="atlas-performance" class="atlas-performance" role="status">그래픽을 준비하는 중…</p></section><section class="atlas-list"><label>이름 검색 <input id="atlas-search" placeholder="전체 공간 검색" autocomplete="off"></label><p id="atlas-list-label"></p><div id="atlas-rows"></div><div id="atlas-detail"></div><section class="passage-panel" aria-label="공간 통로"><h2>공간 통로</h2><p id="passage-caption"></p><label><input id="passage-enabled" type="checkbox" checked> 통로선 표시</label><div class="passage-filter"><label><input id="passage-galaxy" type="checkbox" checked> 은하 간</label><label><input id="passage-planet" type="checkbox" checked> 행성 간</label></div><label>상태 <select id="passage-status"><option value="all">전체</option><option value="open">개방</option><option value="restricted">제한</option><option value="closed">폐쇄</option><option value="unstable">불안정</option><option value="unknown">미확정</option></select></label><label>연결 강조 <select id="passage-object"><option value="">선택 안 함</option></select></label><small class="passage-legend"><span class="passage-open">● 개방</span> · <span class="passage-restricted">● 제한</span> · <span class="passage-closed">● 폐쇄</span> · <span class="passage-unstable">● 불안정</span> · <span class="passage-unknown">● 미확정</span><br>은하 간: 긴 점선 · 행성 간: 짧은 점선</small><div id="passage-list"></div><div id="passage-detail"></div></section></section></div>`;
  const $ = s => root.querySelector(s);
  function cancelApproach() { if(approach){const a=approach;approach=null;a.onfinish=null;a.cancel();} }
  const passageNames={open:'개방',restricted:'제한',closed:'폐쇄',unstable:'불안정',unknown:'미확정'};
  const passageArrow=p=>p.direction==='both'?'↔':p.direction==='one-way'?'→':'—';
  const nodeName=id=>nodes.find(n=>n.id===id)?.name || id;
  function updatePassageHighlight() {
    const ids=highlightedPassageIds(passageRows,hoveredObject || selectedObject,selectedPassage);
    renderer?.setLineHighlights(ids);
  }
  function drawPassagePanel(scene=lastScene, applyLines=false) {
    const levels={galaxy:$('#passage-galaxy').checked,planet:$('#passage-planet').checked};
    passageRows=selectPassageRows(passages,nodes,path.at(-1)||null,{levels,status:$('#passage-status').value||'all'});
    if(selectedPassage && !passageRows.some(p=>p.id===selectedPassage))selectedPassage=null;
    const objects=scene?.objects || [];
    if(selectedObject && !objects.some(o=>o.id===selectedObject))selectedObject=null;
    $('#passage-object').innerHTML='<option value="">선택 안 함</option>'+objects.map(o=>`<option value="${escape(o.id)}">${escape(o.name)}</option>`).join('');
    $('#passage-object').value=selectedObject || '';
    const allLines=makePassageLines(passageRows,scene,{enabled:$('#passage-enabled').checked,highlightNode:hoveredObject||selectedObject,selectedId:selectedPassage});
    // Bound work for dense worlds; selected and directly connected lines win.
    const lines=limitPassageLines(allLines), visibleIds=new Set(lines.map(l=>l.id));
    if(scene)scene.lines=lines;
    $('#passage-caption').textContent=mode==='demo' ? `가상 통로 · 연결 상태는 이동 가능 여부를 보장하지 않습니다.${allLines.length>200 ? ` 선 ${allLines.length-200}개 생략` : ''}` : '실제 통로 자료 없음 또는 확인 불가 · 기존 관계에서 통로를 추정하지 않습니다.';
    $('#passage-list').innerHTML=passageRows.length ? passageRows.map(p=>`<button type="button" class="passage-row" data-passage-id="${escape(p.id)}" aria-pressed="${p.id===selectedPassage}"><strong>${escape(nodeName(p.sourceId))} ${passageArrow(p)} ${escape(nodeName(p.targetId))}</strong><small>${escape(passageNames[p.status||'unknown'])} · ${escape(p.level==='galaxy'?'은하 간':'행성 간')}${!visibleIds.has(p.id)?' · 현재 화면에 선 미표시':''}</small></button>`).join('') : '<p>현재 조건에서 표시할 통로가 없습니다.</p>';
    const chosen=passageRows.find(p=>p.id===selectedPassage);
    const dir=chosen?.direction==='both'?'양방향':chosen?.direction==='one-way'?'단방향 (출발 → 도착)':`방향 미확정${chosen?.rawDirection ? ` (원본: ${chosen.rawDirection})` : ''}`;
    const state=chosen?.status ? passageNames[chosen.status] : `미확정${chosen?.rawStatus ? ` (원본: ${chosen.rawStatus})` : ''}`;
    const when=chosen ? [chosen.time?.text,chosen.time?.start!=null?`시작 ${chosen.time.start}`:null,chosen.time?.end!=null?`종료 ${chosen.time.end}`:null].filter(x=>x!==null&&x!==undefined&&x!=='').join(' · ') || '미확정' : '';
    $('#passage-detail').innerHTML=chosen ? `<div class="passage-detail"><strong>통로 상세</strong><p>${escape(nodeName(chosen.sourceId))} ${passageArrow(chosen)} ${escape(nodeName(chosen.targetId))}</p><p>상태: ${escape(state)} · ${escape(dir)}</p><p>관리 기관: ${escape(chosen.operator||'미확정')}<br>시대: ${escape(when)}</p><p>${escape(chosen.description||'설명 없음')}</p><small>ID: ${escape(chosen.id)} · 출발: ${escape(chosen.sourceId)} · 도착: ${escape(chosen.targetId)}</small></div>` : '';
    if(applyLines && renderer)renderer.setLines(lines);
    updatePassageHighlight();
  }
  function visibleChildren(parentId) {
    const direct = childrenFor(nodes,parentId);
    const parent = nodes.find(n => n.id === parentId);
    // Planet navigation shows the continent and its cities at the same scale.
    if (parent?.type !== 'planet') return direct;
    const descendants = [], seen = new Set(direct.map(n=>n.id));
    const queue = direct.filter(n => ['continent','region'].includes(n.type));
    for (let i=0;i<queue.length;i++) for(const n of childrenFor(nodes,queue[i].id)) {
      if (seen.has(n.id)) continue; seen.add(n.id); descendants.push(n);
      if (['continent','region'].includes(n.type)) queue.push(n);
    }
    return [...direct,...descendants];
  }
  function drawList() {
    const parentId = path.at(-1) || null;
    const visible = query ? nodes.filter(n => n.name.toLowerCase().includes(query.toLowerCase())) : visibleChildren(parentId);
    $('#atlas-list-label').textContent = query ? `전체 검색 결과 ${visible.length}건` : `현재 단계 ${visible.length}건`;
    $('#atlas-rows').innerHTML = visible.length ? visible.map(n => `<button type="button" class="atlas-row" data-atlas-select="${escape(n.id)}"><span><strong>${escape(n.name)}</strong><small>${escape(types[n.type] || n.type)} · ${escape(n.demo ? '시험 데이터' : statusLabel(n.canonStatus))}${n.warning ? ` · ${escape(n.warning)}` : ''}</small></span><span>${n.coords ? '좌표 있음' : '좌표 미설정'} ›</span></button>`).join('') : '<p class="atlas-empty">표시할 공간이 없습니다.</p>';
    const selected = nodes.find(n => n.id === (focusedId || parentId));
    const distances = selected && selected.demo && selected.type === 'galaxy' ? nodes.map(n => ({ n, distance: distanceBetween(selected, n) })).filter(x => x.distance) : [];
    const landmarks = selected?.demo ? selected.visual?.region?.landmarks || [] : [];
    $('#atlas-detail').innerHTML = selected ? `<div class="atlas-selected"><strong>${escape(selected.name)}</strong><p>${escape(types[selected.type] || selected.type)} · ${escape(selected.demo ? '시험 데이터' : statusLabel(selected.canonStatus))}</p><small>${selected.coords ? `좌표 단위: ${escape(selected.unit || '미정')}` : '좌표·외형 미설정 · 지도상 위치를 표시하지 않습니다.'}</small>${focusedId ? '<p>행성에서 이 도시를 확대해 보고 있습니다.</p><button type="button" data-atlas="city-enter">가상 도시로 이동</button>' : ''}${distances.length ? `<p>가상 은하 간 거리</p>${distances.map(({n,distance}) => `<div>${escape(n.name)}: ${Math.round(distance.value).toLocaleString('ko-KR')} ${escape(distance.unit)}</div>`).join('')}` : ''}${landmarks.length ? `<p>가상 랜드마크</p>${landmarks.map(l=>`<div>${escape(l.name)}</div>`).join('')}` : ''}</div>` : '';
  }
  function update() {
    const parentId = path.at(-1) || null;
    const parts = path.map(id => nodes.find(n => n.id === id)?.name).filter(Boolean);
    $('#atlas-path').textContent = ['우주',...parts,...(focusedId ? [nodes.find(n=>n.id===focusedId)?.name || ''] : [])].join('  ›  ');
    $('#atlas-mode').textContent = mode === 'demo' ? '가상 데모 · 표시 간격은 시각화용이며 거리는 원본 가상 좌표로 계산합니다.' : '실제 자료 · 좌표 형식이 확정되지 않아 목록에만 표시합니다.';
    root.querySelectorAll('[data-atlas="real"], [data-atlas="demo"]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.atlas===mode)));
    root.querySelector('[data-atlas="back"]').disabled = !path.length;
    const objects = selectedObjects();
    const selected = nodes.find(n => n.id === parentId);
    const inCity=selected?.type==='city';
    root.querySelector('[data-atlas="planet-return"]').hidden = !inCity || !planetPathForCity(nodes,parentId);
    if (inCity) {
      renderer?.dispose(); renderer=null;
      $('#atlas-labels').replaceChildren(); $('#atlas-labels').hidden=true;
      $('.atlas-canvas-wrap').hidden=true; $('.atlas-view-bottom').hidden=true;
      $('#atlas-city-root').hidden=false;
      cityMap?.dispose();
      cityMap=mountCityMap($('#atlas-city-root'),selected,{mode,entities,relations,onSelect:record=>{
        const linked=record.passageId && passages.find(p=>p.id===record.passageId);
        if(linked){selectedPassage=linked.id;$('#passage-status').value='all';$('#passage-'+linked.level).checked=true;drawPassagePanel(null);}
        $('#atlas-detail').innerHTML=`<div class="atlas-selected"><strong>${escape(record.name)}</strong><p>${escape(record.kind || '')}</p><small>ID: ${escape(record.objectId || record.id)}<br>${escape(record.relation || '')}${record.passageId ? `<br>연결 통로 ID: ${escape(record.passageId)}${linked?' · 통로 상세를 확인하세요':' · 연결 자료 없음 또는 확인 불가'}` : ''}</small></div>`;
      }});
      $('#atlas-performance').textContent='2D 지도 · 3D 렌더링 중지';
      lastScene=null;hoveredObject=null;drawPassagePanel(null);
      drawList(); return;
    }
    cityMap?.dispose(); cityMap=null; $('#atlas-city-root').hidden=true;
    $('.atlas-canvas-wrap').hidden=false; $('.atlas-view-bottom').hidden=false;
    if (!renderer && !error) initializeRenderer();
    const type = !selected ? 'universe' : selected.type === 'galaxy' ? 'galaxy' : selected.type === 'planet' ? 'planet' : 'surface';
    const scene = mode === 'demo' ? buildDemoScene({type, objects, visual:selected?.visual || {}, density:$('#atlas-density').value, surfaceKind:selected?.type}) : {type:'unavailable', objects:[], meshes:[]};
    lastScene=scene;hoveredObject=null;drawPassagePanel(scene);
    $('#atlas-labels').innerHTML = renderer && !error ? objects.map(o => `<button type="button" class="atlas-label" data-atlas-marker="${escape(o.id)}">${escape(o.name)}</button>`).join('') : '';
    $('#atlas-labels').hidden = !renderer || !!error;
    try { renderer?.setScene(scene); }
    catch (e) {
      error = `3D 장면을 표시할 수 없습니다: ${e.message}. 목록 탐색은 가능합니다.`;
      renderer?.dispose(); renderer = null;
      $('#atlas-performance').textContent=error; $('#atlas-canvas').hidden=true;
      $('#atlas-labels').hidden=true; $('#atlas-labels').replaceChildren();
    }
    drawList();
  }
  function selectedObjects() {
    const id=path.at(-1)||null, parent=nodes.find(n=>n.id===id);
    if (parent?.type !== 'planet') return sceneObjects(nodes,id);
    return visibleChildren(id).filter(n=>Array.isArray(n.coords)&&n.coords.length===3&&n.coords.every(Number.isFinite)).map(n=>({id:n.id,name:n.name,type:n.type,x:n.coords[0],y:n.coords[1],z:n.coords[2],color:n.color||'#9bc9ff',size:14,...(n.demo&&n.visual?{visual:n.visual}:{})}));
  }
  function select(id, {marker = false, afterApproach = false, previousView = null} = {}) {
    const node = nodes.find(n => n.id === id); if (!node) return;
    if (!afterApproach) cancelApproach();
    if (!afterApproach && mode==='demo' && node.type==='galaxy' && !path.length && renderer) {
      const prior=renderer.getViewState(), wrap=$('.atlas-canvas-wrap'), p=projectedLabels.find(x=>x.id===id);
      if (typeof wrap.animate==='function') {
        const rect=wrap.getBoundingClientRect(), x=p?.x ?? rect.width/2, y=p?.y ?? rect.height/2;
        wrap.style.transformOrigin=`${x}px ${y}px`;
        const motion=wrap.animate([{transform:'translate(0,0) scale(1)'},{transform:`translate(${rect.width/2-x}px,${rect.height/2-y}px) scale(2.5)`}],{duration:450,easing:'ease-in-out',fill:'forwards'});
        approach=motion;motion.onfinish=()=>{if(approach!==motion)return;approach=null;motion.onfinish=null;motion.cancel();select(id,{marker,afterApproach:true,previousView:prior});};
        return;
      }
      previousView=prior;
    }
    surfaceOrigin=null;
    if (mode === 'demo' && node.type === 'city' && renderer) {
      const planetPath=planetPathForCity(nodes,id);
      if (planetPath) {
        if (path.join('\0') !== planetPath.join('\0')) {path=planetPath;focusedId=null;query='';$('#atlas-search').value='';update();}
        if (renderer?.focusObject(id)) {
          focusedId=id;
          if (marker) {
            // Enter immediately without a timer; keep the pending focus and
            // pre-focus camera so Back restores the planet context.
            surfaceOrigin={path:[...path],cityId:id,view:renderer.getViewState()};
            path=ancestry(nodes,id);focusedId=null;update();return;
          }
          $('#atlas-path').textContent=['우주',...path.map(x=>nodes.find(n=>n.id===x)?.name),node.name].join('  ›  ');drawList();return;
        }
      }
    }
    focusedId=null;
    if (query || node.parentId !== (path.at(-1) || null)) {
      path = ancestry(nodes,id); query = ''; $('#atlas-search').value = '';
    } else path.push(id);
    update();
    if(previousView && node.type==='galaxy' && renderer){const state=renderer.getViewState();renderer.setViewState({...state,yaw:previousView.yaw,pitch:previousView.pitch});}
  }
  function initializeRenderer() { try {
    renderer = createRenderer($('#atlas-canvas'), { onSelect: id=>select(id,{marker:true}), onLineSelect: id=>{selectedPassage=id;drawPassagePanel(lastScene,true);}, onLineHover: id=>{const item=passageRows.find(p=>p.id===id);$('#atlas-hover').textContent=item ? ` · 통로 ${nodeName(item.sourceId)} ${passageArrow(item)} ${nodeName(item.targetId)}` : '';}, onHover: id=>{hoveredObject=id;const item=nodes.find(n=>n.id===id);$('#atlas-hover').textContent=item ? ` · ${item.name}` : '';updatePassageHighlight();}, onLabels: labels => {
      projectedLabels=labels;
      const buttons = [...$('#atlas-labels').children];
      for (const b of buttons) { const p = labels.find(x => x.id === b.dataset.atlasMarker); if (!p) { b.hidden = true; continue; } b.hidden = false; b.style.left = `${p.x}px`; b.style.top = `${p.y + p.r + 3}px`; }
    }, onStatus: s => {
      if(s.error){error=s.error;$('#atlas-performance').textContent=error;$('#atlas-labels').hidden=true;$('#atlas-labels').replaceChildren();$('#atlas-canvas').hidden=true;renderer?.dispose();renderer=null;}
      else if(!error) $('#atlas-performance').textContent=`${s.fps} FPS · 점 ${s.vertices}개 · 그리기 ${s.drawCalls}회`;
    }});
  } catch (e) { error = `3D 화면을 사용할 수 없습니다: ${e.message}. 목록 탐색은 가능합니다.`; $('#atlas-performance').textContent = error; $('#atlas-canvas').hidden = true; } }
  root.addEventListener('click', e => {
    const route=e.target.closest('[data-passage-id]'); if(route){selectedPassage=route.dataset.passageId;drawPassagePanel(lastScene,true);return;}
    const marker=e.target.closest('[data-atlas-marker]'); if(marker){select(marker.dataset.atlasMarker,{marker:true});return;}
    const item=e.target.closest('[data-atlas-select]'); if(item){select(item.dataset.atlasSelect);return;}
    const action=e.target.closest('[data-atlas]')?.dataset.atlas;
    if(action)cancelApproach();
    if(action==='back'){if(focusedId){focusedId=null;renderer?.clearFocus();$('#atlas-path').textContent=['우주',...path.map(x=>nodes.find(n=>n.id===x)?.name)].join('  ›  ');drawList();}else if(surfaceOrigin && path.at(-1)===surfaceOrigin.cityId){const origin=surfaceOrigin;surfaceOrigin=null;path=origin.path;focusedId=origin.cityId;update();renderer?.setViewState(origin.view);}else{path.pop();update();}}
    if(action==='planet-return'){const target=planetPathForCity(nodes,path.at(-1));if(target){const origin=surfaceOrigin;surfaceOrigin=null;path=target;focusedId=origin?.cityId || null;update();if(origin)renderer?.setViewState(origin.view);}}
    if(action==='zoom-in')renderer?.zoomBy(.8);
    if(action==='zoom-out')renderer?.zoomBy(1.25);
    if(action==='reset'){focusedId=null;renderer?.resetView();update();}
    if(action==='city-enter' && focusedId){surfaceOrigin={path:[...path],cityId:focusedId,view:renderer?.getViewState()};path=ancestry(nodes,focusedId);focusedId=null;update();}
    if(action==='real'||action==='demo'){mode=action; nodes=mode==='demo'?makeDemo():real;passages=adaptPassages(nodes,mode==='demo'?makeDemoPassages():[]);selectedPassage=null;selectedObject=null;hoveredObject=null;path=[];focusedId=null;surfaceOrigin=null;query='';$('#atlas-search').value='';update();}
  });
  $('#atlas-search').addEventListener('input', e => {cancelApproach();query=e.target.value.trim();drawList();});
  $('#atlas-density').addEventListener('change', e => {cancelApproach();focusedId=null;renderer?.setDensity(e.target.value);update();});
  for(const id of ['passage-enabled','passage-galaxy','passage-planet','passage-status'])$('#'+id).addEventListener('change',()=>drawPassagePanel(lastScene,true));
  $('#passage-object').addEventListener('change',e=>{selectedObject=e.target.value || null;drawPassagePanel(lastScene,true);});
  update();
  return () => { cancelApproach();cityMap?.dispose();renderer?.dispose(); };
}
