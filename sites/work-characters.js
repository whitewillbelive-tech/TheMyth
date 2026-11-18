import { COMMON_FIELDS, WORK_FIELDS, commonWorkValues, resolveWorkCharacter, workCharacters, mainCharacterCandidates, characterWorks } from '../web/work-characters-domain.js';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const commonKeys=new Set(COMMON_FIELDS.map(field=>field.key));
const workFields=new Map(WORK_FIELDS.map(field=>[field.key,field]));
const fail=(detail,status=422)=>{throw Object.assign(new Error(typeof detail==='string'?detail:JSON.stringify(detail)),{detail,status});};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const active=row=>row&&!row.deleted_at;
function story(store,workId,{allowArchived=false}={}) {
  const work=store.get('documents',workId,false);
  if(work?.kind!=='story'||(!allowArchived&&work.deleted_at))fail('활성 외전을 선택하세요.',allowArchived?422:404);
  return work;
}
function person(store,id,{allowArchived=false}={}) {
  const record=store.get('entities',id);
  if(record.kind!=='character'||(!allowArchived&&record.deleted_at))fail('활성 인물을 선택하세요.',404);
  return record;
}
function envelope(store,records) {
  return {expected_write_revision:store.revision,revisions:Object.fromEntries(records.filter(Boolean).map(record=>[record.id,record.revision]))};
}
function guard(store,payload,records) {
  if(!object(payload)||typeof payload.expected_write_revision!=='string'||!object(payload.revisions))fail('최신 화면의 저장 번호와 자료 수정 번호가 필요합니다. 다시 불러오세요.');
  if(payload.expected_write_revision!==store.revision)fail({message:'다른 화면에서 자료가 변경되었습니다. 최신값과 내 수정을 비교한 뒤 다시 적용하세요.',expected_write_revision:store.revision},409);
  for(const record of records.filter(Boolean)) {
    if(!Number.isInteger(payload.revisions[record.id]))fail('비교한 모든 자료의 수정 번호가 필요합니다. 다시 불러오세요.');
    if(payload.revisions[record.id]!==record.revision)fail({message:'비교 이후 자료가 변경되었습니다. 최신값을 다시 확인하세요.',record_id:record.id,revision:record.revision},409);
  }
}
function profile(store,localId,workId) {
  const document=story(store,workId),local=person(store,localId),resolved=resolveWorkCharacter(store.state(),localId,workId);
  if(resolved.ambiguous)fail('외전 등장 또는 동일인 연결이 중복되어 있습니다. 자동으로 선택하지 않습니다.',409);
  if(!resolved.appearance)fail('이 외전에 등록된 인물이 아닙니다.',404);
  if(!resolved.common||resolved.common.kind!=='character')fail('공통 인물 연결을 확인하세요.',409);
  return {...resolved,document,records:[document,local,resolved.common,resolved.appearance,resolved.identity]};
}
export function getWorkContext(store,workId) {
  const document=story(store,workId);
  return {document,...envelope(store,[document])};
}
export function getWorkCharacter(store,localId,workId) {
  const result=profile(store,localId,workId),{records,...projection}=result;
  return {...projection,...envelope(store,records)};
}
export function listWorkCharacters(store,workId) {story(store,workId);return {characters:workCharacters(store.state(),workId),...getWorkContext(store,workId)};}
export function findMainCharacters(store,query='') {return mainCharacterCandidates(store.state(),query);}
function validateFields(store,values,{commonOnly=false}={}) {
  if(!object(values))fail('인물 정보는 항목별 객체여야 합니다.');
  for(const [key,value] of Object.entries(values)) {
    const field=workFields.get(key);
    if(!field||(commonOnly&&!commonKeys.has(key)))fail('지원하지 않는 인물 정보 항목입니다.');
    if(field.type==='aliases'){if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))fail('별칭은 문자열 목록이어야 합니다.');}
    else if(field.type==='time'){if(!object(value))fail('시점은 미정 또는 시간 정보여야 합니다.');store.time(value);}
    else if(typeof value!=='string')fail(`${field.label}은 텍스트여야 합니다.`);
    if(key==='name'&&!value.trim())fail('이름 또는 이름 미정을 입력하세요.');
  }
}
function validateInherit(inherit) {if(!Array.isArray(inherit)||inherit.some(key=>!workFields.has(key))||new Set(inherit).size!==inherit.length)fail('공통 정보 사용 항목을 확인하세요.');}
function validateNotes(notes) {if(!object(notes)||Object.entries(notes).some(([key,value])=>!workFields.has(key)||typeof value!=='string'))fail('차이 메모는 항목별 텍스트여야 합니다.');}
// Called for generic record writes and backup restoration as well as new routes.
export function validateWorkCharacterRecord(store,table,record) {
  if(table!=='relations'||!['work_appearance','identity_link'].includes(record.type))return;
  const source=store.get('entities',record.source_id,false),target=store.get(record.type==='work_appearance'?'documents':'entities',record.target_id,false);
  if(source?.kind!=='character')fail('외전 인물 연결의 시작은 인물이어야 합니다.');
  if(record.type==='work_appearance') {
    if(target?.kind!=='story')fail('외전 등장 정보는 인물과 외전을 연결해야 합니다.');
    if(record.data?.profile_schema!==1)fail('외전 등장 정보의 형식을 확인하세요.');
    validateFields(store,record.data.overrides??{});validateInherit(record.data.inherit_fields??[]);validateNotes(record.data.override_notes??{});
    if((record.data.inherit_fields??[]).some(key=>Object.hasOwn(record.data.overrides??{},key)))fail('같은 항목에 작품별 값과 공통값 사용을 함께 지정할 수 없습니다.');
  } else {
    if(target?.kind!=='character'||!record.data?.work_id)fail('동일인 연결은 인물과 인물 및 적용 외전을 지정해야 합니다.');
    story(store,record.data.work_id,{allowArchived:true});
  }
  if(!record.deleted_at&&store.all('relations').some(row=>active(row)&&row.id!==record.id&&row.type===record.type&&row.source_id===record.source_id&&(record.type==='work_appearance'?row.target_id===record.target_id:row.data?.work_id===record.data.work_id)))fail('같은 외전에 중복 연결할 수 없습니다.',409);
}
function writeCommon(store,character,values,label) {
  validateFields(store,values,{commonOnly:true});
  const patch={data:{...character.data}};
  for(const [key,value] of Object.entries(values))if(['name','description'].includes(key))patch[key]=value;else patch.data[key]=clone(value);
  return store.update('entities',character.id,{revision:character.revision,...patch},label);
}
function writeAppearance(store,appearance,values,label) {return store.update('relations',appearance.id,{revision:appearance.revision,data:{...appearance.data,...values}},label);}
export function createWorkCharacter(store,workId,payload) {
  const document=story(store,workId);guard(store,payload,[document]);
  const common=payload.common??{},overrides=payload.overrides??{},notes=payload.override_notes??{};
  validateFields(store,common,{commonOnly:true});validateFields(store,overrides);validateNotes(notes);
  let character;
  if(payload.character_id) {
    character=person(store,payload.character_id);guard(store,payload,[document,character]);
    if(Object.keys(common).length)fail('기존 인물 연결 시 공통 정보는 별도 비교 화면에서 수정하세요.');
  } else character=store.create('entities',{kind:'character',name:common.name??'이름 미정',description:common.description??'',data:{english_name:common.english_name??'',aliases:common.aliases??[],generation_model_version:1}});
  store.create('relations',{type:'work_appearance',source_id:character.id,target_id:document.id,data:{profile_schema:1,overrides:clone(overrides),inherit_fields:[],override_notes:clone(notes)}});
  return getWorkCharacter(store,character.id,workId);
}
export function updateWorkProfile(store,localId,workId,payload) {
  const p=profile(store,localId,workId);guard(store,payload,p.records);
  const patch=payload.overrides??{},inherit=payload.inherit_fields??[],notes=payload.override_notes??{};
  validateFields(store,patch);validateInherit(inherit);validateNotes(notes);
  if(inherit.some(key=>Object.hasOwn(patch,key)))fail('같은 항목을 공통값과 작품별 값으로 동시에 선택할 수 없습니다.');
  const overrides={...p.overrides,...clone(patch)},override_notes={...p.override_notes,...clone(notes)};
  for(const key of inherit){delete overrides[key];delete override_notes[key];}
  const inherit_fields=[...new Set([...(p.appearance.data.inherit_fields??[]),...inherit])].filter(key=>!Object.hasOwn(overrides,key));
  writeAppearance(store,p.appearance,{overrides,inherit_fields,override_notes},'외전 작품별 정보 수정 전');
  return getWorkCharacter(store,localId,workId);
}
export function updateCommonCharacter(store,localId,workId,payload) {
  const p=profile(store,localId,workId);guard(store,payload,p.records);person(store,p.common.id);
  writeCommon(store,p.common,payload.fields??{},'연결 작품 공통 정보 수정 전');
  return getWorkCharacter(store,localId,workId);
}
export function promoteWorkFields(store,localId,workId,payload) {
  const p=profile(store,localId,workId);guard(store,payload,p.records);person(store,p.common.id);
  if(!Array.isArray(payload.fields)||!payload.fields.length||payload.fields.some(key=>!commonKeys.has(key))||new Set(payload.fields).size!==payload.fields.length)fail('공통 정보에 반영할 항목을 선택하세요.');
  const values=Object.fromEntries(payload.fields.map(key=>[key,clone(p.values[key])]));
  writeCommon(store,p.common,values,'외전 정보의 공통 반영 전');
  const overrides={...p.overrides},notes={...p.override_notes};for(const key of payload.fields){delete overrides[key];delete notes[key];}
  writeAppearance(store,p.appearance,{overrides,override_notes:notes,inherit_fields:[...new Set([...(p.appearance.data.inherit_fields??[]),...payload.fields])]},'공통 반영 후 작품별 상속 변경 전');
  return getWorkCharacter(store,localId,workId);
}
export function previewIdentityLink(store,localId,workId,targetId) {
  const p=profile(store,localId,workId),target=person(store,targetId);
  if(p.identity)fail('현재 연결을 먼저 해제한 뒤 다른 본편 인물을 선택하세요.',409);
  if(target.id===localId)fail('자기 자신은 연결 대상이 아닙니다.');
  if(!mainCharacterCandidates(store.state()).some(row=>row.id===targetId))fail('본편에 실제 등장하는 인물을 선택하세요.');
  if(workCharacters(store.state(),workId).some(row=>row.local.id!==localId&&row.common?.id===targetId))fail('이 본편 인물은 이미 해당 외전에 연결되어 있습니다. 기존 외전 등장 정보를 확인하세요.',409);
  const local_values=commonWorkValues(p.local),common_values=commonWorkValues(target);
  const conflicts=COMMON_FIELDS.filter(field=>!equal(local_values[field.key],common_values[field.key])).map(field=>({field:field.key,label:field.label,local:clone(local_values[field.key]),common:clone(common_values[field.key])}));
  return {local:p.local,target,local_values,common_values,conflicts,affectedWorks:characterWorks(store.state(),target.id),...envelope(store,[...p.records,target])};
}
export function linkWorkIdentity(store,localId,workId,payload) {
  if(typeof payload?.target_id!=='string')fail('연결할 본편 인물을 선택하세요.');
  const preview=previewIdentityLink(store,localId,workId,payload.target_id),p=profile(store,localId,workId);
  guard(store,payload,[...p.records,preview.target]);
  const choices=payload.field_choices??{};
  if(!object(choices)||Object.entries(choices).some(([key,value])=>!commonKeys.has(key)||!['common','local'].includes(value)))fail('공통 정보의 충돌 선택을 확인하세요.');
  for(const conflict of preview.conflicts)if(!['common','local'].includes(choices[conflict.field]))fail('모든 충돌 항목에서 사용할 값을 선택하세요.',409);
  const selected=Object.fromEntries(COMMON_FIELDS.filter(field=>choices[field.key]==='local').map(field=>[field.key,preview.local_values[field.key]]));
  if(Object.keys(selected).length)writeCommon(store,preview.target,selected,'동일인 연결 시 공통 정보 선택 전');
  store.create('relations',{type:'identity_link',source_id:localId,target_id:preview.target.id,data:{work_id:workId,link_kind:'identity_reference',common_field_choices:clone(choices),source_values_at_link:Object.fromEntries(COMMON_FIELDS.map(field=>[field.key,clone(preview.local_values[field.key])]))}});
  return getWorkCharacter(store,localId,workId);
}
export function unlinkWorkIdentity(store,localId,workId,payload) {
  const p=profile(store,localId,workId);guard(store,payload,p.records);
  if(!p.identity)fail('해제할 본편 인물 연결이 없습니다.',409);
  // Freeze this appearance only. Both original entities, every other work,
  // and all event/thought references remain byte-for-byte unchanged.
  const overrides=Object.fromEntries(WORK_FIELDS.map(field=>[field.key,clone(p.values[field.key])]));
  writeAppearance(store,p.appearance,{overrides,inherit_fields:[]},'동일인 연결 해제 시 외전의 유효 정보 보존 전');
  store.delete('relations',p.identity.id);
  return getWorkCharacter(store,localId,workId);
}
