// Read-only projections for the atlas. Never mutate, seed or write archive records.
// The archive has no approved coordinate contract yet. Its data is deliberately
// listed without coordinates until that contract and its units are established.
const ALIASES = new Map([
  ['우주', 'universe'], ['universe', 'universe'],
  ['은하', 'galaxy'], ['galaxy', 'galaxy'],
  ['항성계', 'star_system'], ['star system', 'star_system'], ['star_system', 'star_system'], ['stellar system', 'star_system'],
  ['대륙', 'continent'], ['continent', 'continent'],
  ['지역', 'region'], ['region', 'region'],
  ['도시', 'city'], ['city', 'city'],
]);

function category(entity) {
  if (entity.kind === 'planet') return 'planet';
  const value = String(entity.data?.subtype || '').trim().toLowerCase();
  return ALIASES.get(value) || 'other';
}

export function adaptWorld(entities = []) {
  const spatial = entities.filter(e => e && !e.deleted_at && ['space', 'planet'].includes(e.kind) && typeof e.id === 'string');
  const byId = new Map(spatial.map(e => [e.id, e]));
  const effectiveParent = (entity) => {
    // Detect malformed cycles even when every link is a visible object.
    let cursor = entity.id;
    const ancestry = new Set();
    while (cursor && byId.has(cursor)) {
      if (ancestry.has(cursor)) return { parentId: null, warning: '공간 관계 순환' };
      ancestry.add(cursor);
      cursor = byId.get(cursor).data?.parent_id || null;
    }
    let id = entity.data?.parent_id || null;
    const seen = new Set([entity.id]);
    while (id && byId.has(id)) {
      if (seen.has(id)) return { parentId: null, warning: '공간 관계 순환' };
      seen.add(id);
      const p = byId.get(id);
      const pType = category(p);
      // Universe is the navigation root. Stellar systems stay in the archive
      // but do not become a map level.
      if (pType === 'universe' || pType === 'star_system') {
        id = p.data?.parent_id || null;
        continue;
      }
      break;
    }
    if (id && !byId.has(id)) return { parentId: null, warning: '상위 공간 연결 확인 필요' };
    return { parentId: id, warning: null };
  };
  return spatial.filter(e => !['universe', 'star_system'].includes(category(e))).map(e => {
    const { parentId, warning } = effectiveParent(e);
    return {
      id: e.id, name: String(e.name || '(이름 없음)'), type: category(e), parentId,
      originalParentId: e.data?.parent_id || null, warning,
      coords: null, unit: null, status: 'unset',
      canonStatus: e.canon_status ?? e.data?.canon_status ?? null,
      demo: false,
    };
  });
}

// A-0's fictional data stays in memory and is only supplied to the viewer when
// the user deliberately chooses demo mode. Units are explicitly fictional.
export function makeDemo() {
  const row = (id, name, type, parentId, coords, unit, color, visual) => ({
    id: `demo:${id}`, name, type, parentId: parentId ? `demo:${parentId}` : null,
    originalParentId: parentId ? `demo:${parentId}` : null,
    coords, unit, color, visual, status: 'fixture', canonStatus: null, warning: null, demo: true,
  });
  const geo = (lat, lon) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return [4.57*Math.cos(a)*Math.cos(b), 4.57*Math.sin(a), 4.57*Math.cos(a)*Math.sin(b)]; };
  // These values describe illustrations in the isolated demo only. Continents
  // are angular patches, not real geography; landmarks use local scene units.
  const galaxy = galaxyShape => ({galaxyShape});
  const planet = (oceanColor, landColor, continents, earthLike) => ({planet: {oceanColor, landColor, continents, ...(earthLike ? {earthLike} : {})}});
  const region = (terrainColor, landmarks, gateFacilities) => ({region: {terrainColor, landmarks, ...(gateFacilities ? {gateFacilities} : {})}});
  return [
    row('gal-01','가상 은하 α','galaxy',null,[0,0,0],'광년 (가상)', '#90caff',galaxy('disk')),
    row('gal-02','가상 은하 β','galaxy',null,[245000,68000,-142000],'광년 (가상)', '#d6a7ff',galaxy('elliptical')),
    row('gal-03','가상 은하 γ','galaxy',null,[-182000,97000,204000],'광년 (가상)', '#ffd69b',galaxy('irregular')),
    row('gal-04','가상 은하 δ','galaxy',null,[105000,-164000,-221000],'광년 (가상)', '#83e8d6',galaxy('disk')),
    // Purely illustrative colours/opacity, not observations or measurements.
    row('p-01','가상 행성 A','planet','gal-01',[-4.3,1.6,0.7],'시험 좌표','#78d1ef',planet('#244f78','#7eb88f',[{lat:25,lon:-31,radius:34},{lat:4,lon:27,radius:23},{lat:-26,lon:12,radius:21}],{biomeGreen:'#648b55',biomeBrown:'#96775a',iceColor:'#e1eef3',cloudColor:'#f3f8ff',cloudOpacity:0.25,atmosphereColor:'#72b3ee',atmosphereOpacity:0.2,seed:3021})),
    row('p-02','가상 행성 B','planet','gal-01',[2.4,-1.7,2.1],'시험 좌표','#ffc29a',planet('#345b83','#d2ad7a',[{lat:36,lon:-24,radius:33},{lat:-18,lon:110,radius:28}])),
    row('p-03','가상 행성 C','planet','gal-01',[4.3,2.2,-2.5],'시험 좌표','#b4f0ae',planet('#265b65','#94ba78',[{lat:10,lon:0,radius:38},{lat:-35,lon:130,radius:21}])),
    row('p-04','가상 행성 D','planet','gal-02',[-2.8,1.7,1.8],'시험 좌표','#83c8fd',planet('#284e76','#9fb7a4',[{lat:20,lon:65,radius:32},{lat:-38,lon:-70,radius:25}])),
    row('p-05','가상 행성 E','planet','gal-02',[3.8,-1,0],'시험 좌표','#f8d69b',planet('#655c72','#d5ae7d',[{lat:10,lon:-30,radius:36},{lat:-30,lon:120,radius:22}])),
    row('p-06','가상 행성 F','planet','gal-03',[-2.2,-1.8,2.5],'시험 좌표','#ffa9c4',planet('#504a75','#c99eaa',[{lat:30,lon:40,radius:29},{lat:-22,lon:-100,radius:31}])),
    row('p-07','가상 행성 G','planet','gal-03',[3.9,1.8,-0.7],'시험 좌표','#cbd0ff',planet('#485778','#adb8ca',[{lat:8,lon:0,radius:32},{lat:-35,lon:115,radius:23}])),
    row('p-08','가상 행성 H','planet','gal-04',[0.4,1.1,0],'시험 좌표','#95d9da',planet('#235f70','#8cbcb2',[{lat:20,lon:-50,radius:35},{lat:-20,lon:120,radius:25}])),
    // Position markers near (but distinct from) their cities, within the
    // corresponding imaginary continent patches on each demo planet.
    row('continent-01','가상 대륙 북부','continent','p-01',geo(30,-45),'시험 위경도','#9dd6ad',region('#5a8d79',[{name:'가상 산맥',type:'ridge',x:-1,z:0,height:1.7}])),
    row('continent-02','가상 대륙 동부','continent','p-01',geo(4,40),'시험 위경도','#c8b6e2',region('#777497',[{name:'가상 언덕',type:'ridge',x:1,z:0,height:1.1}])),
    row('continent-03','가상 대륙 남부','continent','p-01',geo(-31,25),'시험 위경도','#d3e998',region('#8a9870',[{name:'가상 고원',type:'ridge',x:0,z:1,height:1.3}])),
    row('continent-04','가상 대륙 서부','continent','p-02',geo(45,-38),'시험 위경도','#e6ca9d',region('#ad8e70',[{name:'가상 절벽',type:'ridge',x:0,z:-1,height:1.5}])),
    row('city-01','가상 도시 Ⅰ','city','continent-01',geo(25,-31),'시험 위경도','#a7f9ff',region('#5a8d79',[{name:'가상 관측탑',type:'tower',x:0,z:0,height:2.4},{name:'가상 항구',type:'harbor',x:2,z:-1,height:.7}],[{id:'demo:gate-city-01',name:'가상 행성 관문',passageId:'demo:passage-planet-01',x:-1,z:1},{id:'demo:gate-city-02',name:'가상 은하 관문',passageId:'demo:passage-gal-01',x:1,z:-1},{id:'demo:transport-office-01',name:'가상 교통국 지부',kind:'transport_office',passageId:'demo:passage-planet-01',x:-1,z:-1.5}])),
    row('city-02','가상 도시 Ⅱ','city','continent-02',geo(4,27),'시험 위경도','#e9ccff',region('#777497',[{name:'가상 도서관',type:'hall',x:-1,z:0,height:1.4},{name:'가상 광장',type:'plaza',x:1,z:1,height:.2}])),
    row('city-03','가상 도시 Ⅲ','city','continent-03',geo(-26,12),'시험 위경도','#eaff9c',region('#8a9870',[{name:'가상 전망대',type:'tower',x:0,z:1,height:1.9},{name:'가상 시장',type:'hall',x:-2,z:-1,height:.8}])),
    row('city-04','가상 도시 Ⅳ','city','continent-04',geo(36,-24),'시험 위경도','#a7f9ff',region('#ad8e70',[{name:'가상 성문',type:'gate',x:0,z:0,height:1.5},{name:'가상 광장',type:'plaza',x:2,z:-1,height:.2}])),
  ];
}

export function childrenFor(nodes, parentId = null) {
  return nodes.filter(n => n.parentId === parentId);
}

export function sceneObjects(nodes, parentId = null) {
  return childrenFor(nodes, parentId).filter(n => Array.isArray(n.coords) && n.coords.length === 3 && n.coords.every(Number.isFinite)).map(n => ({
    id: n.id, name: n.name, x: n.coords[0], y: n.coords[1], z: n.coords[2], color: n.color || '#9bc9ff', size: 14,
    ...(n.demo && n.visual ? {visual: n.visual} : {}),
  }));
}

// Only compare points known to share both a parent coordinate frame and unit.
export function distanceBetween(a, b) {
  if (!a || !b || a.id === b.id || a.parentId !== b.parentId || !a.unit || a.unit !== b.unit || !Array.isArray(a.coords) || !Array.isArray(b.coords) || a.coords.length !== 3 || b.coords.length !== 3 || ![...a.coords, ...b.coords].every(Number.isFinite)) return null;
  return { value: Math.hypot(...a.coords.map((x, i) => x - b.coords[i])), unit: a.unit };
}
