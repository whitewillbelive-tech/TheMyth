// Sites dispatch owns authentication for this confirmed owner-private project.
// Browser identity headers are injected by dispatch. Official service bearer
// access is validated/consumed there and intentionally has no visitor identity.
// This boundary narrows browser writes; it does not introduce a public endpoint.
export function spatialWritesAllowed(request) {
  const h = request.headers;
  for (const [name] of h) if (name === 'origin' || name.startsWith('oai-authenticated-user-') || name.startsWith('sec-fetch-')) return false;
  return true;
}
const spatial = row => ['space','planet'].includes(row?.kind);
const equal = (a,b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v,i)=>equal(v,b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys=Object.keys(a); return keys.length===Object.keys(b).length && keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
  }
  return false;
};
export function spatialRecordsChanged(store) {
  const ids = new Set([...store.original.entities,...store.records.entities].filter(([,row])=>spatial(row)).map(([id])=>id));
  const protectedRecord = (table,row) => table === 'entities' ? spatial(row) : table === 'states' || table === 'memberships' ? ids.has(row.entity_id) : table === 'relations' && ids.has(row.source_id) && ids.has(row.target_id);
  return ['entities','states','memberships','relations'].some(table => {
    const before=new Map([...store.original[table]].filter(([,row])=>protectedRecord(table,row)));
    const after=new Map([...store.records[table]].filter(([,row])=>protectedRecord(table,row)));
    return before.size!==after.size || [...before].some(([id,row])=>!equal(row,after.get(id)));
  });
}
export function assertSpatialWriteAllowed(store) {
  if (store.spatialWritesAllowed !== false || !spatialRecordsChanged(store)) return;
  throw Object.assign(new Error('공간 데이터는 읽기 전용입니다. 공식 Work 관리 경로를 사용하세요.'), {status:403,detail:'공간 데이터는 읽기 전용입니다. 공식 Work 관리 경로를 사용하세요.'});
}
