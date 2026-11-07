import { passagesForScene } from './atlas-passages.js';
// Views are derived from the independent records only; no connection is inferred.
export function selectPassageRows(passages, nodes, parentId, {levels={galaxy:true,planet:true},status='all'}={}) {
  const parent=nodes.find(n=>n.id===parentId);
  const directlyRelated=passages.filter(p=>p.sourceId===parentId||p.targetId===parentId);
  const spatial=passagesForScene(passages,nodes,parentId);
  const facilityIds=new Set((parent?.visual?.region?.gateFacilities || []).map(f=>f.passageId).filter(Boolean));
  const scope=parent?.type==='planet' ? directlyRelated : parent?.type==='city' ? passages.filter(p=>facilityIds.has(p.id)) : parent?.type==='galaxy' ? [...spatial,...directlyRelated.filter(p=>!spatial.some(s=>s.id===p.id))] : spatial;
  return scope.filter(p=>levels[p.level] && (status==='all' || (p.status || 'unknown')===status));
}
export function makePassageLines(rows,scene,{enabled=true,highlightNode=null,selectedId=null}={}) {
  if(!enabled || !['universe','galaxy'].includes(scene?.type))return [];
  const objects=new Map((scene.objects || []).map(o=>[o.id,o]));
  return rows.flatMap(p=>{
    const a=objects.get(p.sourceId),b=objects.get(p.targetId);
    if(!a||!b||![a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isFinite))return [];
    return [{id:p.id,source:[a.x,a.y,a.z],target:[b.x,b.y,b.z],level:p.level,status:p.status||'unknown',direction:p.direction,highlighted:p.id===selectedId || !!highlightNode && [p.sourceId,p.targetId].includes(highlightNode)}];
  });
}
export function highlightedPassageIds(rows,nodeId,selectedId) {
  return rows.filter(p=>p.id===selectedId || !!nodeId && (p.sourceId===nodeId||p.targetId===nodeId)).map(p=>p.id);
}
export function limitPassageLines(lines,max=200) {
  return [...lines].sort((a,b)=>Number(b.highlighted)-Number(a.highlighted)).slice(0,max);
}
