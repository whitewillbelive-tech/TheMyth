// Read-only city data and 2D presentation. No coordinates are inferred for
// archive data: unknown locations are listed instead of being plotted.
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cityData(city, { mode, entities = [], relations = [] }) {
  if(mode==='demo' && city.demo===true) {
    const landmarks=(city.visual?.region?.landmarks || []).map((l,i)=>({id:`${city.id}:place-${i}`,name:l.name,kind:'가상 장소',x:400+l.x*110,y:250+l.z*80}));
    const places=landmarks.length ? landmarks : [{id:`${city.id}:place-0`,name:'가상 광장',kind:'가상 장소',x:400,y:250}];
    const facilities=(city.visual?.region?.gateFacilities || []).filter(g=>g && typeof g.id==='string' && typeof g.name==='string' && typeof g.passageId==='string' && Number.isFinite(g.x) && Number.isFinite(g.z)).map(g=>({id:g.id,name:g.name,kind:g.kind==='transport_office'?'가상 교통국 지부':'가상 관문 시설',passageId:g.passageId,x:400+g.x*110,y:250+g.z*80}));
    return {demo:true, places, facilities, related:[{id:`${city.id}:event`,name:'가상 축제',kind:'가상 사건',relation:`${places[0].name} 관련`,sourceId:`${city.id}:event`,targetId:places[0].id}], regions:[{id:'demo:district-west',name:'가상 서부 구역',kind:'가상 구역',x:215,y:180},{id:'demo:district-east',name:'가상 동부 구역',kind:'가상 구역',x:600,y:325}]};
  }
  const byId=new Map(entities.filter(x=>!x.deleted_at).map(x=>[x.id,x])), inside=new Set([city.id]);
  let changed=true;
  while(changed){changed=false;for(const e of byId.values())if(['space','planet'].includes(e.kind)&&!inside.has(e.id)&&inside.has(e.data?.parent_id)){inside.add(e.id);changed=true;}}
  const related=[];
  for(const id of inside){if(id===city.id)continue;const e=byId.get(id);if(e)related.push({id:e.id,objectId:e.id,name:e.name || '(이름 없음)',kind:e.kind === 'event'?'사건':'하위 장소·공간',relation:'상위 공간 연결'});}
  for(const rel of relations.filter(r=>!r.deleted_at)) {
    const left=inside.has(rel.source_id),right=inside.has(rel.target_id);
    if(!left&&!right) continue;
    const otherId=left?rel.target_id:rel.source_id, other=byId.get(otherId), source=byId.get(rel.source_id),target=byId.get(rel.target_id);
    if(!source || !target || !other)continue;
    const note=rel.data?.note ? ` · ${rel.data.note}` : '';
    const time=rel.start || rel.end ? ` · 시점: ${JSON.stringify({start:rel.start||null,end:rel.end||null})}` : '';
    related.push({id:rel.id,name:other.name || '(이름 없음)',kind:other.kind==='event'?'사건':'연결된 기록',relation:`${source.name} (${source.id}) → ${target.name} (${target.id}) · ${rel.type || '관계'} · 관계 ID: ${rel.id}${note}${time}`,sourceId:rel.source_id,targetId:rel.target_id,objectId:otherId});
  }
  return {demo:false,places:[],regions:[],facilities:[],related};
}
export function mountCityMap(root, city, options={}) {
  const model=cityData(city,options); let scale=1,offsetX=0,offsetY=0,drag=null,suppressClick=false;
  const facilityMarkers=model.facilities.map(f=>`<g data-city-place="${esc(f.id)}" role="button" tabindex="0" aria-label="${esc(f.name)} · ${esc(f.kind)}"><rect x="${f.x-10}" y="${f.y-10}" width="20" height="20" rx="4" fill="${f.kind==='가상 교통국 지부'?'#286777':'#6042a0'}" stroke="#fff" stroke-width="3"/><text x="${f.x+16}" y="${f.y+5}" font-size="15" fill="#233733">${esc(f.name)}</text></g>`).join('');
  const facilityRows=model.facilities.map(f=>`<div class="city-record"><button type="button" data-city-record="${esc(f.id)}"><span>${esc(f.name)}</span><small>${esc(f.kind)} · 시설 ID: ${esc(f.id)} · 통로 ID: ${esc(f.passageId)}</small></button></div>`).join('');
  const shapes=model.demo ? `<rect width="800" height="500" fill="#e6e0ca"/><path d="M0 0H310L260 170 0 215Z" fill="#a3c5ad"/><path d="M470 0H800V180L620 225 450 145Z" fill="#d0c7aa"/><path d="M0 340Q210 260 385 365T800 320V500H0Z" fill="#a6c8c3"/><path d="M0 247L800 240M390 0L400 500M80 80L720 420M45 380L700 60" stroke="#fff9e9" stroke-width="19" fill="none"/><path d="M0 247L800 240M390 0L400 500M80 80L720 420M45 380L700 60" stroke="#c2ad8e" stroke-width="1.2" fill="none"/>${model.regions.map(r=>`<g data-city-place="${esc(r.id)}" role="button" tabindex="0" aria-label="${esc(r.name)}"><text x="${r.x}" y="${r.y}" fill="#55715f" font-size="17">${esc(r.name)}</text></g>`).join('')}${model.places.map(p=>`<g data-city-place="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc(p.name)}"><circle cx="${p.x}" cy="${p.y}" r="11" fill="#d1724d" stroke="#fff" stroke-width="3"/><text x="${p.x+16}" y="${p.y+5}" font-size="16" fill="#233733">${esc(p.name)}</text></g>`).join('')}` : `<defs><pattern id="city-empty-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#d0d7d0" stroke-width="1"/></pattern></defs><rect width="800" height="500" fill="#edf0eb"/><rect width="800" height="500" fill="url(#city-empty-grid)"/><text x="400" y="225" text-anchor="middle" fill="#515e58" font-size="20">임시 2D 지도 · 실제 지형 미확정</text><text x="400" y="255" text-anchor="middle" fill="#69756f" font-size="15">좌표 미설정 · 관련 기록은 목록에서 확인하세요.</text>`;
  root.innerHTML=`<div class="city-map-toolbar"><strong>${esc(city.name)} · ${model.demo?'가상 2D 지도':'좌표 미설정'}</strong><span><button type="button" data-city-zoom="out" aria-label="지도 축소">−</button><button type="button" data-city-zoom="in" aria-label="지도 확대">+</button><button type="button" data-city-zoom="reset">초기화</button></span></div><svg class="city-map-svg" viewBox="0 0 800 500" role="group" aria-label="${esc(city.name)} 평면 지도">${shapes}${facilityMarkers}</svg><p class="city-map-note">${model.demo?'시연용 가상 구역과 장소입니다. 실제 설정에 저장되지 않습니다.':'표시 가능한 승인 좌표가 없어 지도에 위치를 생성하지 않았습니다.'} 드래그 이동 · 휠 확대/축소</p><div class="city-map-records"><strong>관문·교통 시설</strong>${facilityRows || '<p>관문 시설 자료 없음 또는 확인 불가</p>'}</div><div class="city-map-records"><strong>관련 장소와 사건</strong>${[...model.regions,...model.places,...model.related].map(p=>`<div class="city-record"><button type="button" data-city-record="${esc(p.id)}"><span>${esc(p.name)}</span><small>${esc(p.kind)}${p.relation?' · '+esc(p.relation):''}</small></button>${!model.demo && p.objectId ? `<button type="button" data-action="open" data-id="${esc(p.objectId)}">기존 기록 열기 ↗</button>` : ''}</div>`).join('') || '<p>연결된 기록이 없습니다.</p>'}</div>`;
  const svg=root.querySelector('svg'), clean=[];
  const listen=(el,type,fn,opts)=>{el.addEventListener(type,fn,opts);clean.push(()=>el.removeEventListener(type,fn,opts));};
  const apply=()=>svg.setAttribute('viewBox',`${offsetX} ${offsetY} ${800/scale} ${500/scale}`);
  const zoom=(factor)=>{const old=scale;scale=Math.min(5,Math.max(.75,scale*factor));offsetX+=(800/old-800/scale)/2;offsetY+=(500/old-500/scale)/2;apply();};
  listen(svg,'wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.001));},{passive:false});
  listen(svg,'pointerdown',e=>{suppressClick=false;drag={x:e.clientX,y:e.clientY,ox:offsetX,oy:offsetY,moved:false,pointerId:e.pointerId};});
  listen(svg,'pointermove',e=>{if(!drag)return;const r=svg.getBoundingClientRect(),dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>4 && !drag.moved){drag.moved=true;svg.setPointerCapture?.(drag.pointerId);}if(!drag.moved)return;offsetX=drag.ox-dx*(800/scale)/Math.max(1,r.width);offsetY=drag.oy-dy*(500/scale)/Math.max(1,r.height);apply();});
  listen(svg,'pointerup',()=>{suppressClick=!!drag?.moved;drag=null;});listen(svg,'pointercancel',()=>{drag=null;});
  const select=id=>{const found=[...model.regions,...model.places,...model.facilities,...model.related].find(x=>x.id===id);if(found)options.onSelect?.(found);};
  listen(svg,'keydown',e=>{if(e.key!=='Enter' && e.key!==' ')return;const target=e.target.closest('[data-city-place]');if(target){e.preventDefault();select(target.dataset.cityPlace);}});
  listen(root,'click',e=>{if(suppressClick){suppressClick=false;if(svg.contains(e.target))return;}const zoomButton=e.target.closest('[data-city-zoom]');if(zoomButton){const v=zoomButton.dataset.cityZoom;if(v==='reset'){scale=1;offsetX=0;offsetY=0;apply();}else zoom(v==='in'?1.3:1/1.3);return;}const target=e.target.closest('[data-city-place], [data-city-record]');if(target)select(target.dataset.cityPlace || target.dataset.cityRecord);});
  return {model,dispose(){for(const remove of clean)remove();root.replaceChildren();}};
}
