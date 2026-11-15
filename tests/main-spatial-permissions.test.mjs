import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../sites/api.js';
import { Fixture } from './d1-test-helper.mjs';
const visitor={'oai-authenticated-user-id':'owner-browser'};
test('browser identity and fetch headers cannot mutate spatial records while authenticated private service transport remains usable', async()=> {
 const f=new Fixture(handleApi);
 try {
  const planet=await f.entity('planet','original');
  for(const headers of [visitor,{'oai-authenticated-user-id':''},{'oai-authenticated-user-full-name':'owner'},{origin:'https://myth.test'},{'sec-fetch-user':'?1'}]) {
   await f.error('POST','/api/entities',{kind:'space',name:'forbidden',data:{subtype:'galaxy'}},403,headers);
   await f.error('PATCH','/api/entities/'+planet.id,{description:'forbidden'},403,headers);
   await f.error('DELETE','/api/entities/'+planet.id,undefined,403,headers);
  }
  assert.equal((await f.record('entities',planet.id)).description,'');
  const common=await f.req('POST','/api/characters',{name:'ordinary character',data:{origin_planet_id:planet.id}},visitor);
  assert.equal(common.character.data.origin_planet_id,planet.id);
  await f.update('entities',planet,{description:'official Work service update'});
  assert.equal((await f.record('entities',planet.id)).description,'official Work service update');
 } finally {f.close();}
});
test('spatial backup restoration is rejected before R2 safety write and leaves database and history unchanged', async()=> {
 const f=new Fixture(handleApi);
 try {
  const planet=await f.entity('planet','original');
  const backup=await f.backup(),before=await f.state();
  backup.entities.find(e=>e.id===planet.id).description='attempted replacement';
  await f.error('POST','/api/backup/restore',{backup,mode:'replace',confirm:'REPLACE'},403,visitor);
  assert.equal(f.objects.size,0);
  const after=await f.state();
  assert.deepEqual(after.entities,before.entities);assert.deepEqual(after.versions,before.versions);
 } finally {f.close();}
});
test('spatial topology state membership and historical restore share the browser boundary', async()=> {
 const f=new Fixture(handleApi);
 try {
  const a=await f.entity('planet','a'),b=await f.entity('planet','b'),group=await f.create('groups',{name:'group'});
  await f.error('POST','/api/relations',{source_id:a.id,target_id:b.id,type:'related'},403,visitor);
  await f.error('POST','/api/states',{entity_id:a.id,attribute:'position',value:'new'},403,visitor);
  await f.error('POST','/api/memberships',{entity_id:a.id,group_id:group.id},403,visitor);
  await f.update('entities',a,{description:'Work-created revision'});
  const version=(await f.state()).versions.find(v=>v.target_id===a.id);
  await f.error('POST','/api/versions/'+version.id+'/restore',{},403,visitor);
  const person=await f.entity('character','person');
  const link=await f.req('POST','/api/relations',{source_id:person.id,target_id:a.id,type:'located_in'},visitor);
  assert.equal(link.target_id,a.id);
 } finally {f.close();}
});
