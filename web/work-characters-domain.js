// One existing character collection, with work-scoped appearances and explicit
// identity links. Linking never redirects event IDs or merges entity records.
export const COMMON_FIELDS = Object.freeze([
  {key:'name',label:'이름',type:'text'},
  {key:'english_name',label:'영문 이름',type:'text'},
  {key:'aliases',label:'별칭',type:'aliases'},
  {key:'description',label:'기본 설명',type:'textarea'},
]);
export const WORK_FIELDS = Object.freeze([
  ...COMMON_FIELDS,
  {key:'role',label:'작품에서의 역할',type:'text'},
  {key:'occupation',label:'직역·정체성',type:'text'},
  {key:'goals',label:'목표',type:'textarea'},
  {key:'activities',label:'행적',type:'textarea'},
  {key:'condition',label:'작품·시점의 상태',type:'textarea'},
  {key:'ideology',label:'사상',type:'textarea'},
  {key:'notes',label:'작품별 메모',type:'textarea'},
  {key:'time',label:'작품 시점',type:'time'},
]);
const rows=(state,key)=>Array.isArray(state?.[key])?state[key]:[];
const active=row=>row&&!row.deleted_at;
const clone=value=>structuredClone(value);
const entity=(state,id)=>rows(state,'entities').find(row=>row.id===id);
export function commonWorkValues(character) {
  return Object.fromEntries(WORK_FIELDS.map(field=>{
    const raw=['name','description'].includes(field.key)?character?.[field.key]:character?.data?.[field.key];
    const value=field.key==='aliases'?(typeof raw==='string'?raw.split(',').map(v=>v.trim()).filter(Boolean):Array.isArray(raw)?raw.filter(v=>typeof v==='string'):[]):raw;
    return [field.key,clone(value??(field.type==='aliases'?[]:field.type==='time'?{mode:'unknown'}:''))];
  }));
}
export function characterWorks(state,characterId) {
  const result=new Map();
  const add=(record,kind,appearance=null)=>{if(active(record))result.set(record.id,{id:record.id,name:record.name,kind,overridden_fields:Object.keys(appearance?.data?.overrides??{})});};
  const localIds=new Set([characterId]);
  for(const link of rows(state,'relations').filter(active))if(link.type==='identity_link'&&link.target_id===characterId)localIds.add(link.source_id);
  for(const relation of rows(state,'relations').filter(active)) {
    if(relation.type==='work_appearance'&&localIds.has(relation.source_id)) {
      const identity=rows(state,'relations').find(r=>active(r)&&r.type==='identity_link'&&r.source_id===relation.source_id&&r.data?.work_id===relation.target_id);
      if(identity&&identity.target_id!==characterId)continue;
      add(rows(state,'documents').find(doc=>doc.id===relation.target_id),'story',relation);
    }
    if(['appearance','generation_appearance'].includes(relation.type)&&[relation.source_id,relation.target_id].includes(characterId)) {
      const other=entity(state,relation.source_id===characterId?relation.target_id:relation.source_id);
      if(other?.kind===(relation.type==='appearance'?'title':'generation'))add(other,other.kind,relation);
    }
  }
  return [...result.values()];
}
export function resolveWorkCharacter(state,localId,workId) {
  const local=entity(state,localId)??null;
  const appearances=rows(state,'relations').filter(r=>active(r)&&r.type==='work_appearance'&&r.source_id===localId&&r.target_id===workId);
  const identities=rows(state,'relations').filter(r=>active(r)&&r.type==='identity_link'&&r.source_id===localId&&r.data?.work_id===workId);
  const appearance=appearances.length===1?appearances[0]:null,identity=identities.length===1?identities[0]:null;
  const common=identity?entity(state,identity.target_id)??local:local;
  const values=commonWorkValues(common),sources=Object.fromEntries(WORK_FIELDS.map(field=>[field.key,'common']));
  const overrides=clone(appearance?.data?.overrides??{});
  for(const field of WORK_FIELDS)if(Object.hasOwn(overrides,field.key)){values[field.key]=clone(overrides[field.key]);sources[field.key]='override';}
  const affectedWorks=common?characterWorks(state,common.id):[];
  const honors=rows(state,'relations').filter(row=>active(row)&&row.type==='honor_assignment'&&row.source_id===localId&&row.data?.work_id===workId).map(assignment=>({letter:entity(state,assignment.target_id)?.data?.honor_letter??assignment.data?.honor_letter??'',status:assignment.data?.status??'undetermined',assignment,honor:entity(state,assignment.target_id)??null}));
  return {local,common,appearance,identity,values,sources,overrides,override_notes:clone(appearance?.data?.override_notes??{}),honors,affectedWorks,workIds:affectedWorks.map(work=>work.id),ambiguous:appearances.length>1||identities.length>1};
}
export function workCharacters(state,workId) {
  return rows(state,'relations').filter(r=>active(r)&&r.type==='work_appearance'&&r.target_id===workId&&active(entity(state,r.source_id))).map(r=>resolveWorkCharacter(state,r.source_id,workId)).sort((a,b)=>String(a.honors[0]?.letter??a.local?.data?.alphabet??a.values.english_name??'').localeCompare(String(b.honors[0]?.letter??b.local?.data?.alphabet??b.values.english_name??''),'en')||String(a.values.english_name??'').localeCompare(String(b.values.english_name??''),'en')||String(a.values.name).localeCompare(String(b.values.name),'ko'));
}
export function mainCharacterCandidates(state,query='') {
  const term=String(query).normalize('NFC').trim().toLocaleLowerCase();
  return rows(state,'entities').filter(row=>active(row)&&row.kind==='character').map(character=>({ ...character,values:commonWorkValues(character),works:characterWorks(state,character.id).filter(work=>['generation','title'].includes(work.kind)) })).filter(character=>character.works.length&&(!term||[character.name,character.values.english_name,...character.values.aliases].join(' ').normalize('NFC').toLocaleLowerCase().includes(term))).map(character=>({...character,affectedWorks:character.works}));
}
