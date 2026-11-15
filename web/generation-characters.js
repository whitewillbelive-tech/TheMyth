import { MBTI_AXES, generationRecords, generationAppearances, relationGenerationId, characterGenerationIds, generationProfile, mbtiSummary, readCommonCharacter, readGenerationProfile, hasGenerationContent } from './generation-character-domain.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const stateOf = ctx => ctx.getState?.() || ctx.db;
const query = (root, selector) => root?.querySelector(selector);
const queries = (root, selector) => [...(root?.querySelectorAll(selector) || [])];
const selected = (a, b) => a === b ? 'selected' : '';
const rawOf = form => {
  const result = {};
  for (const [name, value] of new FormData(form).entries()) {
    if (Object.hasOwn(result, name)) result[name] = [...(Array.isArray(result[name]) ? result[name] : [result[name]]), value];
    else result[name] = value;
  }
  // Empty multiple selections must override previously selected draft values.
  for (const el of [...form.elements]) if (el.name && (el.multiple || el.type === 'checkbox') && !Object.hasOwn(result, el.name)) result[el.name] = [];
  return result;
};
const entriesOf = raw => Object.entries(raw || {}).flatMap(([key,value]) => (Array.isArray(value) ? value : [value]).map(item => [key,item]));
const numberOrBlank = value => typeof value === 'number' && Number.isFinite(value) ? value : '';
const commonKey = id => 'generation-common:' + id;
const selectionKey = id => 'generation-selection:' + id;
const profileKey = (id,generationId) => 'generation-profile:' + id + ':' + generationId;
const draftOf = (ctx,key) => ctx.localDrafts?.[key];
const status = (ctx,text) => ctx.setStatus?.(text);
const persist = ctx => ctx.draftsPersist?.();
const saveDraft = (ctx,key,value) => { if(ctx.localDrafts)ctx.localDrafts[key]=value;persist(ctx); };
const clearDraft = (ctx,key) => { if(ctx.localDrafts)delete ctx.localDrafts[key];persist(ctx); };
const field = (label,html,wide=false) => '<label class="field'+(wide?' wide':'')+'"><span>'+h(label)+'</span>'+html+'</label>';
const input = (name,value,extra='') => '<input name="'+h(name)+'" value="'+h(value)+'" '+extra+'>';
const textarea = (name,value,rows=7) => '<textarea class="generation-long-text" name="'+h(name)+'" rows="'+rows+'" data-autogrow>'+h(value)+'</textarea>';
const notice = key => '<div class="generation-save-notice" data-save-notice="'+h(key)+'" role="status"></div>';
const draftActions = key => '<div class="actions generation-draft-actions"><button type="button" class="button ghost small" data-generation-action="review-draft" data-draft-key="'+h(key)+'">최신 내용과 비교해 저장</button><button type="button" class="button ghost small" data-generation-action="discard-draft" data-draft-key="'+h(key)+'">서버 내용으로 다시 열기</button></div>';

function commonValues(character,raw) {
  const data=character.data || {};
  return { name:character.name || '',origin_planet_id:data.origin_planet_id || '',ideology:data.ideology ?? '',primary_power:data.primary_power ?? '',character_narrative:data.character_narrative ?? '',...Object.fromEntries(MBTI_AXES.map(axis=>['mbti_'+axis.key,numberOrBlank(data.mbti?.[axis.key])])),...(raw || {}) };
}
function mbtiFields(values,prefix='') {
  const model=mbtiSummary(Object.fromEntries(MBTI_AXES.map(axis=>[axis.key,values['mbti_'+axis.key] === '' || values['mbti_'+axis.key] == null ? null : Number(values['mbti_'+axis.key])])));
  return '<aside class="generation-mbti-panel"><div class="generation-mbti-heading"><h3>MBTI</h3><strong data-mbti-type>'+h(model.type)+'</strong></div><p class="muted">미입력과 50:50 동률은 미정으로 남습니다.</p>'+model.axes.map(axis=>'<section class="generation-mbti-axis" data-mbti-axis="'+axis.key+'"><div class="generation-mbti-label"><b>'+axis.left+'</b><span data-mbti-label>'+h(axis.known?axis.value+'% / '+axis.opposite+'%':'미입력')+'</span><b>'+axis.right+'</b></div><div class="generation-mbti-gauge '+(axis.known?'':'unset')+'" role="img" aria-label="'+axis.left+'/'+axis.right+' '+h(axis.known?axis.value+'% / '+axis.opposite+'%':'미입력')+'"><span data-mbti-left style="width:'+(axis.known?axis.value:0)+'%"></span></div><div class="generation-mbti-controls"><input type="range" min="0" max="100" step="1" value="'+(axis.known?axis.value:50)+'" data-mbti-slider="'+axis.key+'" aria-label="'+axis.left+' 비율 조절"><input type="number" min="0" max="100" step="any" name="'+prefix+'mbti_'+axis.key+'" value="'+h(values['mbti_'+axis.key] ?? '')+'" data-mbti-number="'+axis.key+'" aria-label="'+axis.left+' 비율" placeholder="미정"><button type="button" class="button ghost small" data-mbti-clear="'+axis.key+'">미정</button></div></section>').join('')+'</aside>';
}
function commonFields(character,state,raw) {
  const values=commonValues(character,raw);
  const planets=(state.entities || []).filter(row=>row.kind==='planet' && !String(row.id).startsWith('demo:') && row.data?.demo!==true && (!row.deleted_at || row.id===values.origin_planet_id));
  const choices='<option value="">미정</option>'+planets.map(row=>'<option value="'+h(row.id)+'" '+selected(row.id,values.origin_planet_id)+'>'+h(row.name)+(row.deleted_at?' · 보관된 행성':'')+'</option>').join('');
  return '<div class="generation-common-layout"><div class="form-grid">'+field('이름',input('name',values.name,'placeholder="이름 미정"'))+field('출신', '<select name="origin_planet_id">'+choices+'</select>')+field('사상',input('ideology',values.ideology,'placeholder="대표 사상 또는 핵심 신념"'))+field('주력',input('primary_power',values.primary_power))+field('인물 서사',textarea('character_narrative',values.character_narrative,12),true)+'</div>'+mbtiFields(values)+'</div>';
}
function affiliationOptions(state,current=[]) {
  const keys=new Set(current.map(ref=>ref.collection+':'+ref.id));
  const sources=[...(state.entities || []).filter(row=>['organization','civilization'].includes(row.kind)).map(row=>({collection:'entities',row})),...(state.groups || []).map(row=>({collection:'groups',row}))];
  return sources.filter(({collection,row})=>!row.deleted_at || keys.has(collection+':'+row.id)).map(({collection,row})=>'<option value="'+collection+':'+h(row.id)+'" '+(keys.has(collection+':'+row.id)?'selected':'')+'>'+h(row.name)+' · '+(collection==='groups'?'그룹':row.kind==='civilization'?'문명':'집단')+(row.deleted_at?' · 보관됨':'')+'</option>').join('');
}
function profileValues(profile,raw) {
  return { affiliations:profile.affiliations || [],ideology_rank:profile.ideology_rank ?? '',narrative:profile.narrative ?? '',...(raw || {}) };
}
function generationFields(state,profile,raw,prefix='') {
  const values=profileValues(profile,raw);
  let affiliations=values.affiliations;
  if(Array.isArray(affiliations) && affiliations.some(value=>typeof value==='string'))affiliations=affiliations.map(value=>{const split=value.indexOf(':');return {collection:value.slice(0,split),id:value.slice(split+1)};});
  return '<div class="form-grid">'+field('소속','<select name="'+prefix+'affiliations" multiple size="5" aria-label="소속 집단 및 그룹">'+affiliationOptions(state,affiliations)+'</select>',true)+field('사상 등급',input(prefix+'ideology_rank',values.ideology_rank))+field('개별 서사',textarea(prefix+'narrative',values.narrative,10),true)+'</div>';
}
function fallbackLegacy(character,state) {
  const legacy={...character.data};
  for(const key of ['origin_planet_id','ideology','primary_power','character_narrative','mbti','generation_model_version'])delete legacy[key];
  const links=(state.relations || []).filter(row=>row.type==='appearance'&&[row.source_id,row.target_id].includes(character.id));
  return '<p class="muted">기존 공통 정보, 작품별 설정과 연결 이력은 원본 그대로 보존됩니다.</p><details><summary>이전 공통 정보 조회</summary><pre>'+h(JSON.stringify({description:character.description,...legacy},null,2))+'</pre></details>'+links.map(row=>{const title=(state.entities || []).find(item=>item.id===(row.source_id===character.id?row.target_id:row.source_id));return '<details><summary>'+h(title?.name || '이전 작품')+(row.deleted_at?' · 연결 해제됨':'')+'</summary><pre>'+h(JSON.stringify(row.data,null,2))+'</pre></details>';}).join('');
}
export function renderGenerationCharacter(character,ctx) {
  const state=stateOf(ctx),generations=generationRecords(state),commonDraft=draftOf(ctx,commonKey(character.id)),selectionDraft=draftOf(ctx,selectionKey(character.id));
  const selectedIds=selectionDraft?.generation_ids || characterGenerationIds(state,character);
  const legacy=ctx.renderLegacyTitleProfiles?.(character) || fallbackLegacy(character,state);
  return '<article class="generation-character" data-generation-character="'+h(character.id)+'"><div class="detail-header"><div><span class="eyebrow">인물 / GLOBAL RECORD</span><h2 data-character-name>'+h(character.name)+'</h2><small class="muted">'+h(character.id)+'</small></div></div><form id="gen-common-form" data-revision="'+h(commonDraft?.base_revision ?? character.revision)+'"><div class="profile-heading"><h3>공통 정보</h3><p>모든 세대에서 같은 인물의 원본을 사용합니다. 미정인 항목은 비워둘 수 있습니다.</p></div>'+commonFields(character,state,commonDraft?.raw)+notice(commonKey(character.id))+draftActions(commonKey(character.id))+'<div class="form-actions"><span class="muted">서사는 자동 저장되며 미저장 초안도 브라우저에 보관합니다.</span><button type="submit" class="button primary">공통 정보 저장</button></div></form><form id="gen-appearance-form"><h3>등장 세대</h3><div class="generation-appearance-checks">'+generations.map(g=>'<label class="appearance-choice"><input type="checkbox" name="generation_ids" value="'+h(g.id)+'" '+(selectedIds.includes(g.id)?'checked':'')+'><span>'+h(g.data?.number)+'세대 · '+h(g.name)+'</span></label>').join('')+'</div><p class="muted">체크를 해제해도 이미 작성한 세대별 정보와 기존 작품별 기록은 보관됩니다.</p>'+notice(selectionKey(character.id))+draftActions(selectionKey(character.id))+'<div class="form-actions"><button type="submit" class="button primary small">등장 세대 저장</button></div></form><div class="generation-character-panels">'+generations.map(g=>{const profile=generationProfile(state,character.id,g.id),draft=draftOf(ctx,profileKey(character.id,g.id));return '<section class="generation-character-panel" data-generation-panel="'+h(g.id)+'" '+(selectedIds.includes(g.id)?'':'hidden')+'><div class="section-title"><h3>'+h(g.data?.number)+'세대 · '+h(g.name)+'</h3><button type="button" class="button ghost small" data-generation-action="manage-affiliations" data-generation-id="'+h(g.id)+'">집단·그룹 관리</button></div>'+(profile.duplicate?'<p class="conflict">이 세대의 등장 기록이 중복되어 있습니다. 기존 기록을 확인한 뒤 편집하세요.</p>':'<form data-generation-profile="'+h(g.id)+'" data-revision="'+h(draft?.base_revision ?? profile.relation?.revision ?? '')+'">'+generationFields(state,profile,draft?.raw)+notice(profileKey(character.id,g.id))+draftActions(profileKey(character.id,g.id))+'<div class="form-actions"><span class="muted">'+(!profile.relation || profile.archived?'등장 세대 저장 후 자동 저장됩니다.':'이 세대의 정보만 저장합니다.')+'</span><button type="submit" class="button primary">세대별 정보 저장</button></div></form>')+'</section>';}).join('')+'</div><details class="generation-legacy-profiles"><summary>이전 타이틀별 정보 및 추가 설정</summary>'+legacy+'</details>'+(ctx.renderRelated?.(character) || '')+(ctx.renderAdvanced?.(character) || '')+'</article>';
}

function autoGrow(root) {
  for(const control of queries(root,'textarea[data-autogrow]')) {control.style.height='auto';control.style.height=Math.max(150,control.scrollHeight || 150)+'px';}
}
function bindMbti(form,onChange) {
  const update=()=>{
    const raw=rawOf(form),summary=mbtiSummary(Object.fromEntries(MBTI_AXES.map(axis=>[axis.key,raw['mbti_'+axis.key] === '' ? null : Number(raw['mbti_'+axis.key])])));
    const type=query(form,'[data-mbti-type]');if(type)type.textContent=summary.type;
    for(const axis of summary.axes) {
      const row=query(form,'[data-mbti-axis="'+axis.key+'"]');if(!row)continue;
      const label=query(row,'[data-mbti-label]'),gauge=query(row,'.generation-mbti-gauge'),left=query(row,'[data-mbti-left]');
      if(label)label.textContent=axis.known?axis.value+'% / '+axis.opposite+'%':'미입력';
      gauge?.classList.toggle('unset',!axis.known);gauge?.setAttribute('aria-label',axis.left+'/'+axis.right+' '+(axis.known?axis.value+'% / '+axis.opposite+'%':'미입력'));
      if(left)left.style.width=(axis.known?axis.value:0)+'%';
    }
  };
  for(const axis of MBTI_AXES) {
    const number=query(form,'[data-mbti-number="'+axis.key+'"]'),slider=query(form,'[data-mbti-slider="'+axis.key+'"]'),clear=query(form,'[data-mbti-clear="'+axis.key+'"]');
    if(slider)slider.oninput=()=>{number.value=slider.value;update();onChange();};
    if(number)number.addEventListener('input',()=>{if(number.value!=='')slider.value=number.value;update();});
    if(clear)clear.onclick=()=>{number.value='';slider.value='50';update();onChange();};
  }
  update();
}
function errorMessage(error) { return error?.message || '저장할 수 없습니다. 초안은 보존했습니다.'; }
function currentCharacter(ctx,id,fallback) {return (stateOf(ctx).entities || []).find(row=>row.id===id) || fallback;}

export function bindGenerationCharacter(root, character, ctx) {
  let disposed=false, current=character, writeChain=Promise.resolve();
  const timers=new Map(), pending=new Map(), blocked=new Set();
  const common=query(root,'#gen-common-form'), selection=query(root,'#gen-appearance-form');
  const keyFor=form=>form===common?commonKey(character.id):form===selection?selectionKey(character.id):profileKey(character.id,form.dataset.generationProfile);
  const show=(form,message,error=false)=>{const target=query(form,'.generation-save-notice');if(target){target.textContent=message;target.classList.toggle('conflict',error);}};
  const enqueue=fn=>{const result=writeChain.catch(()=>{}).then(fn);writeChain=result;return result;};
  const run=async(form,fn)=>{
    try {return await fn();}
    catch(error){if(error?.status===409)blocked.add(keyFor(form));show(form,errorMessage(error),true);status(ctx,error?.status===409?'충돌 확인 필요 · 초안 보존':'저장하지 못함 · 초안 보존');}
  };
  const schedule=(key,fn)=>{
    clearTimeout(timers.get(key));
    if(blocked.has(key))return;
    timers.set(key,setTimeout(()=>{timers.delete(key);const task=fn().finally(()=>pending.delete(key));pending.set(key,task);},900));
  };
  const snapshotCommon=()=>{
    if(!common)return;
    const key=commonKey(character.id);
    saveDraft(ctx,key,{raw:rawOf(common),base_revision:draftOf(ctx,key)?.base_revision ?? Number(common.dataset.revision)});
    show(common,blocked.has(key)?'최신 내용과 비교한 뒤 저장하세요. 초안은 보존됩니다.':'미저장 초안 보관 중');autoGrow(common);status(ctx,'인물 공통 정보 · 브라우저 임시 보관');
  };
  const saveCommon=()=>enqueue(async()=>{
    if(disposed || !common)return;
    const key=commonKey(character.id);
    if(blocked.has(key)){show(common,'최신 내용과 비교해 저장해 주세요.',true);return;}
    const raw=rawOf(common),draft=draftOf(ctx,key),revision=draft?.base_revision ?? Number(common.dataset.revision);
    const result=await ctx.api('/entities/'+character.id,'PATCH',{...readCommonCharacter(entriesOf(raw),current,stateOf(ctx)),revision});
    current=result;common.dataset.revision=String(result.revision);
    const selectionDraft=draftOf(ctx,selectionKey(character.id));
    if(selectionDraft?.base_revision===revision){selectionDraft.base_revision=result.revision;persist(ctx);}
    if(JSON.stringify(rawOf(common))===JSON.stringify(raw))clearDraft(ctx,key);
    else saveDraft(ctx,key,{raw:rawOf(common),base_revision:result.revision});
    await ctx.refresh(false);show(common,'공통 정보 저장됨');status(ctx,'모든 변경사항 저장됨');
    const heading=query(root,'[data-character-name]');if(heading)heading.textContent=result.name;
    return result;
  });
  const togglePanels=()=>{
    const ids=new FormData(selection).getAll('generation_ids');
    for(const panel of queries(root,'[data-generation-panel]'))panel.hidden=!ids.includes(panel.dataset.generationPanel);
  };
  const snapshotSelection=()=>{
    const state=stateOf(ctx),key=selectionKey(character.id);
    saveDraft(ctx,key,{generation_ids:new FormData(selection).getAll('generation_ids'),base_revision:draftOf(ctx,key)?.base_revision ?? currentCharacter(ctx,character.id,current).revision,generation_revisions:draftOf(ctx,key)?.generation_revisions ?? Object.fromEntries(generationAppearances(state,character.id,{includeArchived:true}).map(row=>[row.id,row.revision]))});
    togglePanels();show(selection,'등장 세대 선택 · 저장 대기');
  };
  const saveSelection=()=>enqueue(async()=>{
    const key=selectionKey(character.id);
    if(blocked.has(key)){show(selection,'최신 연결과 비교해 저장해 주세요.',true);return;}
    const state=stateOf(ctx),ids=new FormData(selection).getAll('generation_ids'),draft=draftOf(ctx,key);
    const removed=generationAppearances(state,character.id).filter(row=>!ids.includes(relationGenerationId(state,row,character.id)));
    const withContent=removed.filter(row=>hasGenerationContent(row.data));
    if(withContent.length && !(ctx.confirm || globalThis.confirm)?.('작성한 세대별 정보가 있습니다. 등장 연결만 해제하고 내용과 이력을 보관할까요?'))return false;
    const latest=currentCharacter(ctx,character.id,current),revision=draft?.base_revision ?? Math.max(latest.revision,current.revision);
    const result=await ctx.api('/characters/'+character.id+'/generations','POST',{revision,generation_ids:ids,generation_revisions:draft?.generation_revisions ?? Object.fromEntries(generationAppearances(state,character.id,{includeArchived:true}).map(row=>[row.id,row.revision])),confirm_detach:withContent.length>0});
    current=result.character;clearDraft(ctx,key);await ctx.refresh(false);show(selection,'등장 세대 저장됨');ctx.render();return true;
  });
  const saveProfile=form=>enqueue(async()=>{
    if(disposed)return;
    const gid=form.dataset.generationProfile,key=profileKey(character.id,gid);
    if(blocked.has(key)){show(form,'최신 내용과 비교해 저장해 주세요.',true);return;}
    const profile=generationProfile(stateOf(ctx),character.id,gid);
    if(!profile.relation || profile.archived){show(form,'등장 세대를 먼저 저장해 주세요.',true);return;}
    const raw=rawOf(form),draft=draftOf(ctx,key),revision=draft?.base_revision ?? Number(form.dataset.revision);
    const result=await ctx.api('/characters/'+character.id+'/generation-settings/'+gid,'PATCH',{revision,...readGenerationProfile(entriesOf(raw))});
    form.dataset.revision=String(result.revision);
    const selectionDraft=draftOf(ctx,selectionKey(character.id));
    if(selectionDraft?.generation_revisions?.[result.id]===revision){selectionDraft.generation_revisions[result.id]=result.revision;persist(ctx);}
    if(JSON.stringify(rawOf(form))===JSON.stringify(raw))clearDraft(ctx,key);
    else saveDraft(ctx,key,{raw:rawOf(form),base_revision:result.revision});
    await ctx.refresh(false);show(form,'이 세대의 정보 저장됨');status(ctx,'모든 변경사항 저장됨');
  });
  const restoreConflictGuard=form=>{
    const key=keyFor(form),draft=draftOf(ctx,key);
    if(!draft)return;
    const latest=form===common?character.revision:form===selection?character.revision:generationProfile(stateOf(ctx),character.id,form.dataset.generationProfile).relation?.revision;
    if(draft.base_revision!==undefined && latest!==undefined && draft.base_revision!==latest){blocked.add(key);show(form,'서버 내용이 변경되었습니다. 최신 내용과 비교해 저장하세요.',true);}
  };
  if(common){
    const changed=()=>{snapshotCommon();schedule('common',()=>run(common,saveCommon));};
    common.addEventListener('input',changed);common.addEventListener('change',changed);bindMbti(common,changed);restoreConflictGuard(common);
    common.onsubmit=async event=>{event.preventDefault();clearTimeout(timers.get('common'));timers.delete('common');snapshotCommon();await run(common,saveCommon);};
  }
  if(selection){selection.addEventListener('change',snapshotSelection);selection.onsubmit=async event=>{event.preventDefault();await run(selection,saveSelection);};togglePanels();restoreConflictGuard(selection);}
  for(const form of queries(root,'[data-generation-profile]')){
    const key=profileKey(character.id,form.dataset.generationProfile),snapshot=()=>{saveDraft(ctx,key,{raw:rawOf(form),base_revision:draftOf(ctx,key)?.base_revision ?? Number(form.dataset.revision)});show(form,'미저장 초안 보관 중');autoGrow(form);status(ctx,'세대별 정보 · 브라우저 임시 보관');};
    const changed=()=>{snapshot();const profile=generationProfile(stateOf(ctx),character.id,form.dataset.generationProfile);if(profile.relation&&!profile.archived&&!form.closest('[data-generation-panel]')?.hidden)schedule(key,()=>run(form,()=>saveProfile(form)));};
    form.addEventListener('input',changed);form.addEventListener('change',changed);restoreConflictGuard(form);
    form.onsubmit=async event=>{event.preventDefault();clearTimeout(timers.get(key));timers.delete(key);snapshot();await run(form,()=>saveProfile(form));};
  }
  const formFor=key=>key===commonKey(character.id)?common:key===selectionKey(character.id)?selection:queries(root,'[data-generation-profile]').find(form=>profileKey(character.id,form.dataset.generationProfile)===key);
  const review=async key=>{
    const form=formFor(key);if(!form || !ctx.openDialog)return;
    const timerKey=form===common?'common':key;
    clearTimeout(timers.get(timerKey));timers.delete(timerKey);blocked.add(key);
    const raw=rawOf(form),ids=form===selection?new FormData(form).getAll('generation_ids'):null;
    await writeChain.catch(()=>{});
    await ctx.refresh(false);
    const latest=currentCharacter(ctx,character.id,current),state=stateOf(ctx);
    if(latest.deleted_at)throw new Error('인물이 삭제되었습니다. 초안은 보존했습니다.');
    const gid=form.dataset.generationProfile,profile=gid?generationProfile(state,character.id,gid):null;
    if(profile && (!profile.relation || profile.archived || profile.duplicate))throw new Error('세대 등장 연결을 먼저 확인하세요. 초안은 보존했습니다.');
    const server=form===common?commonValues(latest):form===selection?characterGenerationIds(state,latest):profile;
    const mine=form===common?readCommonCharacter(entriesOf(raw),latest,state):form===selection?ids:readGenerationProfile(entriesOf(raw));
    ctx.openDialog('최신 인물 정보와 초안 비교','<p>서버의 최신 내용과 저장할 초안을 확인하세요. 다른 세대·작품별 기록은 보존됩니다.</p><div class="generation-draft-comparison"><section><h3>최신 저장 내용</h3><pre>'+h(JSON.stringify(server,null,2))+'</pre></section><section><h3>저장할 초안</h3><pre>'+h(JSON.stringify(mine,null,2))+'</pre></section></div><label class="checkbox-row"><input type="checkbox" name="confirmed" required> 차이를 확인했으며 이 초안을 저장합니다.</label>',async fd=>{
      if(!fd.get('confirmed'))throw new Error('변경 내용을 확인해 주세요.');
      if(form===common)await ctx.api('/entities/'+character.id,'PATCH',{...mine,revision:latest.revision});
      else if(form===selection)await ctx.api('/characters/'+character.id+'/generations','POST',{revision:latest.revision,generation_ids:ids,generation_revisions:Object.fromEntries(generationAppearances(state,character.id,{includeArchived:true}).map(row=>[row.id,row.revision])),confirm_detach:true});
      else await ctx.api('/characters/'+character.id+'/generation-settings/'+gid,'PATCH',{revision:profile.relation.revision,...mine});
      clearDraft(ctx,key);blocked.delete(key);await ctx.refresh(false);ctx.render();
    },'확인한 초안 저장',true);
  };
  for(const button of queries(root,'[data-generation-action="review-draft"]'))button.onclick=()=>run(formFor(button.dataset.draftKey),()=>review(button.dataset.draftKey));
  for(const button of queries(root,'[data-generation-action="discard-draft"]'))button.onclick=async()=>{
    const key=button.dataset.draftKey,timerKey=key===commonKey(character.id)?'common':key;
    clearTimeout(timers.get(timerKey));timers.delete(timerKey);blocked.add(key);
    await writeChain.catch(()=>{});clearDraft(ctx,key);await ctx.refresh(false);ctx.render();
  };
  for(const button of queries(root,'[data-generation-action="manage-affiliations"]'))button.onclick=async()=>{await cleanup.flush();ctx.openAffiliationManager?.(button.dataset.generationId);};
  autoGrow(root);
  function cleanup(){disposed=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();}
  cleanup.flush=async()=>{
    const tasks=[];
    for(const [key,timer] of timers){clearTimeout(timer);if(key==='common')tasks.push(run(common,saveCommon));else{const form=queries(root,'[data-generation-profile]').find(item=>profileKey(character.id,item.dataset.generationProfile)===key);if(form)tasks.push(run(form,()=>saveProfile(form)));}}
    timers.clear();await Promise.all([...pending.values(),...tasks]);await writeChain.catch(()=>{});
  };
  return cleanup;
}

export function newGenerationCharacter(ctx) {
  const state=stateOf(ctx),key='new:generation-character',draft=draftOf(ctx,key),raw=draft?.raw || {},character={name:'',description:'',data:{}};
  const generations=generationRecords(state),chosen=Array.isArray(raw.generation_ids)?raw.generation_ids:raw.generation_ids?[raw.generation_ids]:ctx.generationId?[ctx.generationId]:[];
  const panels=generations.map(g=>'<section class="generation-character-panel" data-new-generation-panel="'+h(g.id)+'" '+(chosen.includes(g.id)?'':'hidden')+'><h3>'+h(g.data?.number)+'세대 · '+h(g.name)+'</h3>'+generationFields(state,{affiliations:[],ideology_rank:'',narrative:''},Object.fromEntries(Object.entries(raw).filter(([name])=>name.startsWith('generation_'+g.id+'_')).map(([name,value])=>[name.slice(('generation_'+g.id+'_').length),value])),'generation_'+g.id+'_')+'</section>').join('');
  ctx.openDialog('새 인물','<p class="callout">확정한 정보만 입력하세요. 이름을 비우면 ‘이름 미정’으로 생성됩니다.</p>'+commonFields(character,state,raw)+'<h3>등장 세대</h3><div class="generation-appearance-checks">'+generations.map(g=>'<label class="appearance-choice"><input type="checkbox" name="generation_ids" value="'+h(g.id)+'" '+(chosen.includes(g.id)?'checked':'')+'><span>'+h(g.data?.number)+'세대 · '+h(g.name)+'</span></label>').join('')+'</div>'+panels,async(_,form)=>{
    const fd=new FormData(form),ids=fd.getAll('generation_ids'),settings={};
    for(const id of ids){const prefix='generation_'+id+'_';settings[id]=readGenerationProfile([...fd.entries()].filter(([name])=>name.startsWith(prefix)).map(([name,value])=>[name.slice(prefix.length),value]));}
    const result=await ctx.api('/characters','POST',{...readCommonCharacter(fd,character,stateOf(ctx)),generation_ids:ids,generation_settings:settings});
    clearDraft(ctx,key);await ctx.refresh(false);ctx.onCreated?.(result.character);ctx.render();ctx.toast?.('새 인물을 기록했습니다.');
  },'인물 만들기',true);
  const form=(ctx.document || globalThis.document).querySelector('#dialog-form');
  const snapshot=()=>{saveDraft(ctx,key,{raw:rawOf(form)});autoGrow(form);};
  const toggle=()=>{const ids=new FormData(form).getAll('generation_ids');for(const panel of queries(form,'[data-new-generation-panel]'))panel.hidden=!ids.includes(panel.dataset.newGenerationPanel);};
  form.addEventListener('input',snapshot);form.addEventListener('change',()=>{toggle();snapshot();});bindMbti(form,snapshot);autoGrow(form);toggle();
}
