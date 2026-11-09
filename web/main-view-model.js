import { generations, titlesForGeneration, generationForTitle, titleIdsForEntity, matchesTitleScope, appearancesFor } from './main-domain.js';

const BACKGROUND = new Set(['spaces', 'setting', 'timeline', 'atlas']);
const PEOPLE = new Set(['character', 'organization', 'civilization', 'groups']);
export function mainSection(view) {
  return BACKGROUND.has(view) ? 'background' : view === 'event' ? 'event' : PEOPLE.has(view) ? 'character' : 'character';
}
export function normalizeMainContext(state, value = {}) {
  const choices = generations(state);
  const generation = choices.find(g => g.id === value.generationId) || choices[0];
  const titles = generation ? titlesForGeneration(state, generation.id) : [];
  let titleId = value.titleId;
  if (titleId == null) titleId = titles[0]?.id || '';
  if (titleId && !titles.some(t => t.id === titleId)) titleId = titles[0]?.id || '';
  return {generationId:generation?.id || '', titleId:titleId || '', includeCommon:value.includeCommon !== false};
}
export function contextForEntity(state, entity, context) {
  if (!entity || !['title','event'].includes(entity.kind)) return {...context};
  const ids = entity.kind === 'title' ? [entity.id] : entity.data?.title_id ? [entity.data.title_id] : titleIdsForEntity(state, entity);
  if (ids.length !== 1) return {...context};
  const generation = generationForTitle(state, ids[0]);
  return generation ? {...context,generationId:generation.id,titleId:ids[0]} : {...context};
}
export function scopedEntities(state, entities, context, {includeCommon = context.includeCommon} = {}) {
  return entities.filter(entity => matchesTitleScope(state, entity, {...context,includeCommon}));
}
export function withSpaceAncestors(all, visible) {
  const keep = new Set(visible.map(e => e.id));
  const byId = new Map(all.map(e => [e.id,e]));
  for (const entity of visible) {
    let parent = entity.data?.parent_id;
    const seen = new Set([entity.id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const record = byId.get(parent);
      if (!record) break;
      keep.add(parent); parent = record.data?.parent_id;
    }
  }
  return all.filter(e => keep.has(e.id));
}
export function detachedAppearances(state, characterId, selectedTitleIds) {
  const selected = new Set(selectedTitleIds);
  return appearancesFor(state,characterId).filter(relation => !selected.has(relation.source_id === characterId ? relation.target_id : relation.source_id));
}
export function hasAppearanceContent(relation) {
  const data = relation?.data || {};
  return Object.keys(data.overrides || {}).length > 0 || Object.entries(data).some(([k,v]) => k !== 'overrides' && k !== 'exclusive' && v != null && v !== '' && !(Array.isArray(v) && !v.length)) || relation.start?.mode && relation.start.mode !== 'unknown' || relation.end != null;
}
export function scopedGroups(state, groups, context) {
  if (!context.titleId && !context.generationId) return groups;
  return groups.filter(group => {
    const members = (state.memberships || []).filter(m => !m.deleted_at && m.group_id === group.id).map(m => (state.entities || []).find(e => e.id === m.entity_id)).filter(Boolean);
    return members.some(e => matchesTitleScope(state,e,{...context,includeCommon:false})) || context.includeCommon && members.every(e => !titleIdsForEntity(state,e).length);
  });
}

// Capture disabled individual controls too: temporarily selecting inheritance
// must not erase an unsaved individual value before the user saves the slot.
export function captureFormFields(form) {
  const result = {};
  for (const control of form.elements) {
    if (!control.name) continue;
    result[control.name] = control.multiple ? [...control.options].filter(o=>o.selected).map(o=>o.value) : control.value;
  }
  return result;
}
export function restoreFormFields(form, raw) {
  if (!raw) return;
  for (const [name,value] of Object.entries(raw)) {
    const control = form.elements.namedItem(name);
    if (!control) continue;
    if (control.multiple) for (const option of control.options) option.selected = (Array.isArray(value)?value:[value]).includes(option.value);
    else control.value = value ?? '';
  }
}
export function titleSettingsPayload(entries, fields, revision) {
  const values = new Map();
  for (const [name,value] of entries) values.set(name,[...(values.get(name)||[]),value]);
  const get = name => values.get(name)?.[0] ?? '';
  const number = name => get(name) === '' ? null : Number(get(name));
  const time = prefix => {
    const mode = get(prefix+'_mode') || 'unknown';
    return {mode,year:mode==='absolute'?number(prefix+'_year'):null,start:mode==='range'?number(prefix+'_start'):null,end:mode==='range'?number(prefix+'_end'):null,event_id:['before','after'].includes(mode)?get(prefix+'_event_id')||null:null,label:get(prefix+'_label')||''};
  };
  const overrides = {}, inherit_fields = [];
  for (const field of fields) {
    if (get('mode_'+field.key) !== 'custom') { inherit_fields.push(field.key); continue; }
    const name = 'profile_'+field.key;
    overrides[field.key] = field.type === 'time' ? time(name) : field.type === 'id-list' ? values.get(name)||[] : field.type === 'aliases' ? String(get(name)).split(',').map(v=>v.trim()).filter(Boolean) : field.type === 'id' ? get(name)||null : get(name);
  }
  return {revision,overrides,inherit_fields};
}
export function appearanceSelectionPayload(state, character, titleIds, draft, confirmDetach = false) {
  return {
    title_ids:[...titleIds],confirm_detach:confirmDetach,
    revision:draft?.base_revision ?? character.revision,
    appearance_revisions:draft?.appearance_revisions ?? Object.fromEntries(appearancesFor(state,character.id,{includeArchived:true}).map(r=>[r.id,r.revision])),
  };
}
export function timelineParameters(context, year = '') {
  const result = {include_common:context.includeCommon === false ? '0' : '1'};
  if (context.generationId) result.generation_id = context.generationId;
  if (context.titleId) result.title_id = context.titleId;
  if (year !== '' && year !== undefined && year !== null) result.year = String(year);
  return result;
}
