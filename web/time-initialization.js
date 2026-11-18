// The owner has approved this initial dataset. Use the same authenticated
// Site API as the editor; never seed from a GET handler or replace user data.
const importKey = 'time:work:v1';
const hasImportedWork = state => (state?.documents || []).some(record => record.data?.import_key === importKey);
const warning = '《시간》 최초 설정 등록을 완료하지 못했습니다. 기존 자료는 유지됩니다. 외전 창작실의 《시간》 설정 등록 버튼에서 확인하세요.';

export async function initializeAuthorizedTimeProject(state, api) {
  // Archived works count too: opening the Site must never restore or recreate
  // a work that the owner deliberately removed or edited after initial import.
  if (hasImportedWork(state)) return {status:'already_registered', changed:false};
  let attempted = false, saved = false;
  try {
    const current = await api('/works/time');
    if (!current || !Object.hasOwn(current, 'work')) throw new Error('외전 등록 상태를 확인할 수 없습니다.');
    if (current.work !== null) return {status:'existing_work', changed:false};
    if (typeof current.expected_write_revision !== 'string') throw new Error('현재 저장 상태를 확인할 수 없습니다.');
    attempted = true;
    await api('/works/time/import', 'POST', {expected_write_revision:current.expected_write_revision});
    saved = true;
    const refreshed = await api('/state');
    if (!hasImportedWork(refreshed)) throw new Error('저장한 외전의 다시 읽기를 확인하지 못했습니다.');
    return {status:'registered', changed:true, state:refreshed};
  } catch (error) {
    // A concurrent tab may already have registered the work. One read recovers
    // that result; a changed revision is never silently retried as another POST.
    if (attempted && !saved && error.status === 409) {
      try {
        const refreshed = await api('/state');
        return {status:hasImportedWork(refreshed)?'registered_elsewhere':'conflict', changed:false, state:refreshed, warning:hasImportedWork(refreshed)?'':warning, error_status:409};
      } catch {}
    }
    return {status:saved?'saved_refresh_unavailable':'unavailable', changed:saved, warning, error_status:error.status ?? null};
  }
}
