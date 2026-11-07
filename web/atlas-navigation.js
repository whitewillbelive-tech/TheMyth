// Read-only helpers: navigation never updates archive objects.
export function ancestry(nodes, id) {
  const byId=new Map(nodes.map(n=>[n.id,n])), result=[], seen=new Set();
  let node=byId.get(id);
  while(node && !seen.has(node.id)){seen.add(node.id);result.unshift(node.id);node=byId.get(node.parentId);}
  return result;
}
export function planetPathForCity(nodes,id) {
  const chain=ancestry(nodes,id), byId=new Map(nodes.map(n=>[n.id,n]));
  if (byId.get(id)?.type!=='city') return null;
  const lastPlanet=chain.findLastIndex(x=>byId.get(x)?.type==='planet');
  return lastPlanet<0 ? null : chain.slice(0,lastPlanet+1);
}
