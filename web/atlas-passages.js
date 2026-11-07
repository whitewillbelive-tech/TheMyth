// Independent, read-only A5 passage model. This module does not read or
// interpret the application's generic relations and performs no persistence.
const levels = new Set(['galaxy','planet']);
const statuses = new Set(['open','restricted','closed','unstable']);
const directions = new Set(['both','one-way']);
const rawText = value => typeof value === 'string' ? value : null;
const timeValue = value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;

// Only explicit records supplied through this independent contract are
// accepted. Missing input is an empty list, not an inferred connection.
export function adaptPassages(nodes = [], passageRecords = []) {
  const byId = new Map(nodes.map(node => [node.id,node]));
  const ids = new Set(), output = [];
  for (const p of passageRecords) {
    if (!p || p.deleted_at || typeof p.id !== 'string' || !p.id || ids.has(p.id) || !levels.has(p.level)) continue;
    const source = byId.get(p.sourceId), target = byId.get(p.targetId);
    if (!source || !target || source.id === target.id || source.type !== p.level || target.type !== p.level || Boolean(source.demo) !== Boolean(target.demo)) continue;
    ids.add(p.id);
    const originalTime = p.time && typeof p.time === 'object' ? p.time : {};
    output.push({
      id:p.id, sourceId:p.sourceId, targetId:p.targetId, level:p.level,
      status:statuses.has(p.status) ? p.status : null,
      rawStatus:rawText(p.status),
      operator:rawText(p.operator),
      direction:directions.has(p.direction) ? p.direction : null,
      rawDirection:rawText(p.direction),
      description:rawText(p.description),
      time:{text:timeValue(originalTime.text),start:timeValue(originalTime.start),end:timeValue(originalTime.end)},
    });
  }
  return output;
}

// In-memory fixtures only, never mixed into real-world archives.
export function makeDemoPassages() {
  return [
    {id:'demo:passage-gal-01',sourceId:'demo:gal-01',targetId:'demo:gal-02',level:'galaxy',status:'restricted',operator:'가상 항로 관리국',direction:'both',description:'두 가상 은하를 연결하는 시험용 통로',time:{text:'가상 시대 · 시험용',start:null,end:null}},
    {id:'demo:passage-planet-01',sourceId:'demo:p-01',targetId:'demo:p-02',level:'planet',status:'open',operator:'가상 관문 관리소',direction:'both',description:'가상 행성 A와 B 사이의 시험용 통로',time:{text:'가상 시대 · 시험용',start:null,end:null}},
  ];
}

// sceneParentId=null denotes the universe; a galaxy id denotes that galaxy.
// Both endpoints must belong to the displayed coordinate frame.
export function passagesForScene(passages = [], nodes = [], sceneParentId = null) {
  const byId = new Map(nodes.map(node => [node.id,node]));
  return passages.filter(p => {
    const source=byId.get(p.sourceId), target=byId.get(p.targetId);
    if (!source || !target || source.type!==p.level || target.type!==p.level) return false;
    if (sceneParentId === null) return p.level === 'galaxy' && source.parentId===null && target.parentId===null;
    return p.level==='planet' && byId.get(sceneParentId)?.type==='galaxy' && source.parentId===sceneParentId && target.parentId===sceneParentId;
  });
}
