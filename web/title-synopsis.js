// Title-owned story editing. Drafts are scoped by the original title ID and
// keep their base revision until a successful save or an explicit comparison.
export const TITLE_STORY_FIELDS = Object.freeze([
  { key: 'overview', label: '작품 개요', rows: 6 },
  { key: 'ki', label: '기', rows: 7 },
  { key: 'seung', label: '승', rows: 7 },
  { key: 'jeon', label: '전', rows: 7 },
  { key: 'gyeol', label: '결', rows: 7 },
]);
const fieldKeys = new Set(TITLE_STORY_FIELDS.map(field => field.key));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const titleStoryDraftKey = id => 'title-story:' + id;

export function readTitleStory(title) {
  const data = object(title?.data) ? title.data : {};
  const synopsis = object(data.synopsis) ? data.synopsis : {};
  const overview = typeof data.overview === 'string' ? data.overview
    : typeof data.description === 'string' ? data.description
      : typeof title?.description === 'string' ? title.description : '';
  return { overview, ...Object.fromEntries(TITLE_STORY_FIELDS.slice(1).map(({ key }) => [key, typeof synopsis[key] === 'string' ? synopsis[key] : ''])) };
}

export function titleStoryPayload(fields, revision) {
  const payload = { revision }, synopsis = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!fieldKeys.has(key) || typeof value !== 'string') throw new Error('작품 개요와 시놉시스는 텍스트로 입력하세요.');
    if (key === 'overview') payload.overview = value;
    else synopsis[key] = value;
  }
  if (Object.keys(synopsis).length) payload.synopsis = synopsis;
  return payload;
}

export function renderTitleTabs(titles, selectedId) {
  if (!titles?.length) return '<p class="muted event-title-empty">선택한 세대에 등록된 타이틀이 없습니다.</p>';
  return `<nav class="event-title-tabs" role="tablist" aria-label="사건 타이틀">${titles.map(title => `<button type="button" role="tab" aria-selected="${title.id === selectedId}" class="button ${title.id === selectedId ? 'active' : 'ghost'}" data-title-story-select="${h(title.id)}">${h(title.name)}</button>`).join('')}</nav>`;
}

function conflictMarkup(title, draft) {
  if (!title || title.deleted_at) return draft ? '<p class="conflict">타이틀이 변경되거나 보관되었습니다. 미저장 초안은 보존했습니다.</p>' : '';
  if (!draft?.conflict && (!draft || draft.base_revision === title.revision)) return '';
  const saved = readTitleStory(title), fields = draft.fields || {};
  return `<section class="title-story-conflict conflict" role="alert"><p>이 타이틀의 저장 내용이 변경되었습니다. 초안은 보존했습니다. 최신 내용과 비교한 뒤 저장하거나 서버 내용을 사용하세요.</p><div class="comparison-scroll"><table class="draft-comparison"><thead><tr><th>항목</th><th>최신 저장 내용</th><th>내 초안</th></tr></thead><tbody>${TITLE_STORY_FIELDS.filter(field => Object.hasOwn(fields, field.key)).map(field => `<tr><th>${field.label}</th><td><pre>${h(saved[field.key])}</pre></td><td><pre>${h(fields[field.key])}</pre></td></tr>`).join('')}</tbody></table></div><label class="checkbox-row"><input type="checkbox" name="title_story_confirm"> 최신 내용과 차이를 확인했으며 내 초안을 저장합니다.</label><div class="actions"><button type="button" class="button small primary" data-title-story-rebase data-revision="${h(title.revision)}">비교 후 내 초안 저장</button><button type="button" class="button small ghost" data-title-story-discard>서버 내용 사용</button></div></section>`;
}

export function renderTitleSynopsis(title, { drafts = {} } = {}) {
  if (!title || title.deleted_at) return '';
  const draft = drafts[titleStoryDraftKey(title.id)], values = { ...readTitleStory(title), ...(draft?.fields || {}) };
  return `<section class="title-story-editor panel" aria-label="타이틀 개요와 시놉시스"><form data-title-story-form data-title-id="${h(title.id)}"><div class="panel-header"><div><span class="eyebrow">TITLE / SYNOPSIS</span><h2>${h(title.name)}</h2><p class="muted">작품 개요와 기·승·전·결을 이 타이틀에 저장합니다.</p></div><button type="submit" class="button primary">전체 저장</button></div><div class="panel-body"><div data-title-story-conflict>${conflictMarkup(title, draft)}</div>${TITLE_STORY_FIELDS.map(field => `<section class="title-story-field" data-title-story-section="${field.key}"><div class="section-title"><label for="title-story-${h(title.id)}-${field.key}"><strong>${field.label}</strong></label><div class="actions"><button type="button" class="button small ghost" data-title-story-expand="${field.key}" aria-expanded="false">편집 영역 확대</button><button type="button" class="button small ghost" data-title-story-save="${field.key}">${field.label} 저장</button></div></div><textarea id="title-story-${h(title.id)}-${field.key}" name="${field.key}" data-title-story-field="${field.key}" rows="${field.rows}" spellcheck="false" aria-label="${h(title.name)} ${field.label}">${h(values[field.key])}</textarea></section>`).join('')}<div class="form-actions"><span data-title-story-status role="status" class="muted">${draft ? '보관된 미저장 초안을 복구했습니다.' : '입력 후 자동 저장됩니다. 빈 항목은 나중에 작성할 수 있습니다.'}</span><div class="actions"><button type="button" class="button ghost small" data-title-story-discard>서버 내용 사용</button><button type="submit" class="button primary">전체 저장</button></div></div></div></form></section>`;
}

export function createTitleStoryController({
  getTitle, api, drafts = {}, persistDrafts = () => {}, onSaved = () => {},
  onStatus = () => {}, onError = () => {}, onConflict,
  autosaveDelay = 900, setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  const timers = new Map(), flights = new Map();
  let disposed = false;
  const current = id => {
    const title = getTitle(id);
    if (!title || title.deleted_at || title.kind !== 'title') throw new Error('타이틀을 찾을 수 없습니다. 초안은 보존했습니다.');
    return title;
  };
  const cancel = id => { if (timers.has(id)) { clearTimer(timers.get(id)); timers.delete(id); } };
  const persist = () => persistDrafts(drafts);
  function queue(id) {
    cancel(id);
    const draft = drafts[titleStoryDraftKey(id)];
    if (disposed || !draft || draft.conflict) return;
    timers.set(id, setTimer(() => { timers.delete(id); save(id).catch(() => {}); }, autosaveDelay));
  }
  function stage(id, field, value) {
    if (!fieldKeys.has(field) || typeof value !== 'string') throw new Error('저장할 시놉시스 항목이 잘못되었습니다.');
    const title = current(id), key = titleStoryDraftKey(id);
    const draft = drafts[key] ||= { base_revision: title.revision, fields: {} };
    draft.fields[field] = value;
    if (draft.base_revision !== title.revision) draft.conflict ||= { message: '저장된 내용이 변경되었습니다.', latest_revision: title.revision };
    persist(); onStatus('미저장 변경사항 · 초안 보관 중', id); queue(id);
    return draft;
  }
  async function save(id, field = null) {
    cancel(id);
    if (flights.has(id)) { await flights.get(id); return save(id, field); }
    const title = current(id), key = titleStoryDraftKey(id), draft = drafts[key];
    if (!draft || !Object.keys(draft.fields || {}).length) return null;
    if (draft.conflict || draft.base_revision !== title.revision) {
      draft.conflict ||= { message: '저장된 내용이 변경되었습니다.', latest_revision: title.revision };
      persist();
      const error = Object.assign(new Error('다른 창에서 작품 내용을 변경했습니다. 최신 내용과 초안을 비교하세요.'), { status: 409 });
      onStatus('저장 충돌 · 초안 보존', id); onError(error, id); throw error;
    }
    const chosen = Object.fromEntries(Object.entries(draft.fields).filter(([key]) => field === null || key === field));
    if (!Object.keys(chosen).length) return null;
    const revision = draft.base_revision;
    const promise = (async () => {
      onStatus('작품 내용 저장 중…', id);
      try {
        const updated = await api('/titles/' + encodeURIComponent(id) + '/story', 'PATCH', titleStoryPayload(chosen, revision));
        if (!updated || updated.id !== id || !Number.isInteger(updated.revision)) throw new Error('작품 저장 응답을 확인할 수 없습니다. 초안은 보존했습니다.');
        await onSaved(updated, id);
        const remaining = drafts[key];
        if (remaining) {
          for (const [key, value] of Object.entries(chosen)) if (remaining.fields[key] === value) delete remaining.fields[key];
          remaining.base_revision = updated.revision;
          delete remaining.conflict;
          if (!Object.keys(remaining.fields).length) delete drafts[key];
        }
        persist(); onStatus(drafts[key] ? '미저장 변경사항 · 초안 보관 중' : '작품 내용 저장됨', id);
        return updated;
      } catch (error) {
        if (error.status === 409 && drafts[key]) {
          drafts[key].conflict = { message: error.message };
          if (onConflict) {
            try { const latest = await onConflict(id, error); if (latest) drafts[key].conflict.latest_revision = latest.revision; } catch {}
          }
        }
        persist(); onStatus(error.status === 409 ? '저장 충돌 · 초안 보존' : '저장 실패 · 초안 보존', id); onError(error, id);
        throw error;
      }
    })();
    flights.set(id, promise);
    try { return await promise; }
    finally { flights.delete(id); }
  }
  async function rebase(id, confirmed, expectedRevision) {
    if (!confirmed) throw new Error('최신 저장 내용과 초안의 차이를 먼저 확인하세요.');
    if (flights.has(id)) await flights.get(id);
    const title = current(id), draft = drafts[titleStoryDraftKey(id)];
    if (!draft) return null;
    if (!Number.isInteger(expectedRevision) || title.revision !== expectedRevision) throw Object.assign(new Error('비교 화면 이후 내용이 변경되었습니다. 다시 비교하세요.'), { status: 409 });
    draft.base_revision = title.revision; delete draft.conflict; persist();
    return save(id);
  }
  function discard(id) { cancel(id); delete drafts[titleStoryDraftKey(id)]; persist(); onStatus('서버 내용을 사용합니다.', id); }
  function resume(id) {
    const title = current(id), draft = drafts[titleStoryDraftKey(id)];
    if (draft && draft.base_revision !== title.revision) { draft.conflict ||= { message: '저장된 내용이 변경되었습니다.', latest_revision: title.revision }; persist(); }
    queue(id);
  }
  return {
    stage, save, rebase, discard, resume, cancel,
    async flush(ids = null) {
      const selected = ids || Object.keys(drafts).filter(key => key.startsWith('title-story:')).map(key => key.slice('title-story:'.length));
      for (const id of selected) { cancel(id); await save(id); }
    },
    dispose() { disposed = true; for (const id of timers.keys()) cancel(id); },
  };
}

export function bindTitleSynopsis(root, options) {
  const form = root?.querySelector('[data-title-story-form]');
  if (!form) return { flush: async () => {}, dispose() {} };
  const id = form.dataset.titleId;
  const status = form.querySelector('[data-title-story-status]');
  const reported = new WeakSet();
  const conflict = () => { const target = form.querySelector('[data-title-story-conflict]'); if (target) target.innerHTML = conflictMarkup(options.getTitle(id), options.drafts?.[titleStoryDraftKey(id)]); };
  const report = error => { conflict(); if (!reported.has(error)) { reported.add(error); options.onError?.(error, id); } };
  const controller = options.controller || createTitleStoryController({ ...options, onError: report, onStatus(message, titleId) { if (status) status.textContent = message; options.onStatus?.(message, titleId); } });
  const grow = area => {
    if (!area?.style) return;
    area.style.height = 'auto';
    const height = Math.min(Math.max(area.scrollHeight || 0, 150), 700);
    area.style.height = height + 'px'; area.style.overflowY = (area.scrollHeight || 0) > 700 ? 'auto' : 'hidden';
  };
  const input = event => {
    const field = event.target?.dataset?.titleStoryField;
    if (!field) return;
    try { controller.stage(id, field, event.target.value); grow(event.target); } catch (error) { report(error); }
  };
  const submit = async event => { event.preventDefault(); try { await controller.save(id); conflict(); } catch (error) { report(error); } };
  const click = async event => {
    const button = event.target.closest?.('[data-title-story-save],[data-title-story-expand],[data-title-story-discard],[data-title-story-rebase]');
    if (!button || !form.contains(button)) return;
    event.preventDefault();
    try {
      if (button.hasAttribute('data-title-story-expand')) {
        const field = button.dataset.titleStoryExpand;
        const area = [...form.querySelectorAll('[data-title-story-field]')].find(node => node.dataset.titleStoryField === field);
        if (!area) return;
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded)); button.textContent = expanded ? '편집 영역 접기' : '편집 영역 확대';
        area.style.minHeight = expanded ? '55vh' : ''; area.style.resize = 'vertical'; grow(area); area.focus();
      } else if (button.hasAttribute('data-title-story-discard')) {
        controller.discard(id);
        const values = readTitleStory(options.getTitle(id));
        for (const area of form.querySelectorAll('[data-title-story-field]')) { area.value = values[area.dataset.titleStoryField]; grow(area); }
        conflict();
      } else if (button.hasAttribute('data-title-story-rebase')) {
        const checkbox = form.querySelector('[name="title_story_confirm"]');
        await controller.rebase(id, checkbox?.checked === true, Number(button.dataset.revision)); conflict();
      } else { await controller.save(id, button.dataset.titleStorySave); conflict(); }
    } catch (error) { report(error); }
  };
  form.addEventListener('input', input); form.addEventListener('submit', submit); form.addEventListener('click', click);
  for (const area of form.querySelectorAll('[data-title-story-field]')) grow(area);
  controller.resume(id); conflict();
  return {
    controller, flush: () => controller.flush([id]),
    dispose() { controller.cancel(id); form.removeEventListener('input', input); form.removeEventListener('submit', submit); form.removeEventListener('click', click); if (!options.controller) controller.dispose(); },
  };
}
