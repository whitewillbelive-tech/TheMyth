"""Real Chromium smoke tests against a temporary, isolated THE MYTH server.

Run: python scripts/browser_smoke.py
Uses CHROMIUM_PATH when supplied, otherwise a system Chromium or Playwright's browser.
Never connects to the user's database. Artifacts go to test-results/ (gitignored).
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]


def exercise(page, base_url: str):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base_url)
    expect(page.get_by_text("THE MYTH", exact=True).first).to_be_visible()
    page.get_by_role("button", name="외전+사상집", exact=True).click()
    page.get_by_role("button", name="본편", exact=True).click()
    page.screenshot(path=str(ROOT / "test-results" / "workspace-desktop.png"), full_page=True)

    def navigate(view):
        page.locator(f'[data-action="view"][data-id="{view}"]').click()

    def submit(name):
        page.locator('#dialog').get_by_role('button', name=name, exact=True).click()
        expect(page.locator('#dialog')).not_to_be_visible()

    def state():
        return page.request.get(base_url + '/api/state').json()

    navigate('spaces')
    page.locator('[data-action="new-entity"]').first.click()
    dialog = page.locator('#dialog')
    dialog.get_by_label('이름', exact=True).fill('[TEST] 출신 행성')
    dialog.locator('[name="kind"]').select_option('planet')
    dialog.locator('[name="data_parent_id"]').select_option('physical-universe')
    submit('자료 만들기')
    planet = next(x for x in state()['entities'] if x['name'] == '[TEST] 출신 행성')

    navigate('character')
    page.locator('[data-action="new-entity"]').first.click()
    dialog.get_by_label('이름', exact=True).fill('[TEST] 인물 A')
    dialog.locator('[name="data_origin_planet_id"]').select_option(planet['id'])
    submit('자료 만들기')
    character = next(x for x in state()['entities'] if x['name'] == '[TEST] 인물 A')
    # Draft survives a navigation away and an actual browser reload.
    page.locator('#entity-form [name="description"]').fill('[TEST] 보존할 기본 프로필')
    navigate('archive')
    page.reload()
    page.locator(f'[data-action="select"][data-id="{character["id"]}"]').click()
    expect(page.locator('#entity-form [name="description"]')).to_have_value('[TEST] 보존할 기본 프로필')
    page.get_by_role('button', name='변경사항 저장', exact=True).click()
    expect(page.locator('.save-state')).to_have_text('모든 변경사항 저장됨')
    assert next(x for x in state()['entities'] if x['id'] == character['id'])['description'] == '[TEST] 보존할 기본 프로필'

    # Even incomplete JSON is protected as raw input, not only parsed data.
    page.locator('#entity-form details').last.locator('summary').click()
    page.locator('#entity-form [name="custom_data"]').fill('{"미완성":')
    navigate('groups')
    navigate('archive')
    page.reload()
    page.locator(f'[data-action="select"][data-id="{character["id"]}"]').click()
    expect(page.locator('#entity-form [name="custom_data"]')).to_have_value('{"미완성":')
    page.once('dialog', lambda d: d.accept())
    page.get_by_role('button', name='서버 내용 사용', exact=True).click()
    expect(page.locator('#entity-form [name="custom_data"]')).to_have_value('{}')

    # Create an appearance with a title using the shared global character ID.
    page.locator('[data-action="new-relation"]').click()
    dialog.locator('[name="target_id"]').select_option('title-earth-1')
    dialog.locator('[name="type"]').fill('appearance')
    dialog.locator('[name="role"]').fill('[TEST] 주인공')
    submit('관계 저장')
    assert any(x['source_id'] == character['id'] and x['target_id'] == 'title-earth-1' for x in state()['relations'])

    # A group membership is only a reference, and removing it must keep the object.
    navigate('groups')
    page.locator('[data-action="new-group"]').click()
    dialog.get_by_label('그룹 이름', exact=True).fill('[TEST] 작업 그룹')
    submit('저장')
    page.locator('[data-action="group-add-entity"]').click()
    dialog.locator('[name="entity_id"]').select_option(character['id'])
    submit('저장')
    page.locator('[data-action="remove-membership"]').click()
    expect(page.locator('[data-action="remove-membership"]')).to_have_count(0)
    assert not next(x for x in state()['entities'] if x['id'] == character['id'])['deleted_at']

    page.get_by_role('button', name='외전+사상집', exact=True).click()
    navigate('book')
    page.locator('[data-action="new-document"]').first.click()
    dialog.get_by_label('제목', exact=True).fill('[TEST] 인물 A의 사상집')
    dialog.locator('[name="author_id"]').select_option(character['id'])
    submit('저장')
    book = next(x for x in state()['documents'] if x['name'] == '[TEST] 인물 A의 사상집')
    page.locator('[data-action="new-chapter"]').click()
    dialog.get_by_label('장·절 제목', exact=True).fill('[TEST] 첫 번째 장')
    submit('저장')
    manuscript = page.get_by_role('textbox', name='원고 본문', exact=True)
    with page.expect_response(lambda r: '/api/chapters/' in r.url and r.request.method == 'PATCH') as saved:
        manuscript.fill('[TEST] 첫 원고. 철학적 주장은 세계의 확정 사실이 아니다.')
    assert saved.value.ok
    expect(page.locator('.save-state')).to_have_text('모든 변경사항 저장됨')
    page.reload()
    expect(manuscript).to_have_value('[TEST] 첫 원고. 철학적 주장은 세계의 확정 사실이 아니다.')
    with page.expect_response(lambda r: '/api/chapters/' in r.url and r.request.method == 'PATCH') as saved:
        manuscript.fill('[TEST] 두 번째 개정 원고')
    assert saved.value.ok
    expect(page.locator('.save-state')).to_have_text('모든 변경사항 저장됨')
    page.reload()
    page.locator('.history summary').click()
    page.once('dialog', lambda d: d.accept())
    page.locator('[data-action="restore-version"]').first.click()
    expect(manuscript).to_have_value('[TEST] 첫 원고. 철학적 주장은 세계의 확정 사실이 아니다.')
    exported = page.request.get(base_url + f'/api/documents/{book["id"]}/export?format=md')
    assert exported.ok and '[TEST] 첫 번째 장' in exported.text() and '첫 원고.' in exported.text()

    navigate('story')
    page.locator('[data-action="new-document"]').first.click()
    dialog.get_by_label('제목', exact=True).fill('[TEST] 미정 외전')
    submit('저장')
    with page.expect_response(lambda r: '/api/documents/' in r.url and r.request.method == 'PATCH') as saved:
        manuscript.fill('[TEST] 외전의 미확정 설정은 원본을 바꾸지 않는다.')
    assert saved.value.ok
    expect(page.locator('.save-state')).to_have_text('모든 변경사항 저장됨')
    assert next(x for x in state()['entities'] if x['id'] == character['id'])['description'] == '[TEST] 보존할 기본 프로필'

    # A concurrent window must not be overwritten by the stale autosave.
    story = next(x for x in state()['documents'] if x['name'] == '[TEST] 미정 외전')
    remote = page.request.patch(base_url + '/api/documents/' + story['id'], data={
        'body': '[TEST] 다른 창에서 저장한 원고', 'revision': story['revision']})
    assert remote.ok
    with page.expect_response(lambda r: '/api/documents/' in r.url and r.request.method == 'PATCH') as conflicted:
        manuscript.fill('[TEST] 보존되어야 할 내 초안')
    assert conflicted.value.status == 409
    expect(page.locator('.save-state')).to_contain_text('저장 실패')
    assert next(x for x in state()['documents'] if x['id'] == story['id'])['body'] == '[TEST] 다른 창에서 저장한 원고'
    expect(manuscript).to_have_value('[TEST] 보존되어야 할 내 초안')
    page.once('dialog', lambda d: d.accept())
    page.get_by_role('button', name='내 초안으로 다시 저장', exact=True).click()
    expect(page.locator('.save-state')).to_have_text('모든 변경사항 저장됨')
    assert next(x for x in state()['documents'] if x['id'] == story['id'])['body'] == '[TEST] 보존되어야 할 내 초안'
    page.screenshot(path=str(ROOT / 'test-results' / 'manuscript-desktop.png'), full_page=True)

    page.get_by_role('textbox', name='통합 검색', exact=True).fill('철학적 주장은')
    page.get_by_role('textbox', name='통합 검색', exact=True).press('Enter')
    expect(page.locator('.search-manuscripts')).to_contain_text('[TEST] 인물 A의 사상집')

    # Full backup can be restored idempotently through the visible dialog.
    backup = page.request.get(base_url + '/api/backup').body()
    page.locator('[data-action="backup"]:visible').click()
    dialog.locator('input[type="file"]').set_input_files({
        'name': 'test-backup.json', 'mimeType': 'application/json', 'buffer': backup})
    dialog.locator('[name="confirm"]').check()
    submit('선택한 백업 복원')

    page.get_by_role('button', name='본편', exact=True).click()
    navigate('character')
    page.locator(f'[data-action="select"][data-id="{character["id"]}"]').click()
    page.locator('[data-action="delete-entity"]').click()
    submit('휴지통으로 이동')
    navigate('trash')
    page.locator(f'[data-action="restore-item"][data-id="entities:{character["id"]}"]').click()
    expect(page.locator(f'[data-action="restore-item"][data-id="entities:{character["id"]}"]')).to_have_count(0)
    assert not next(x for x in state()['entities'] if x['id'] == character['id'])['deleted_at']

    page.set_viewport_size({'width': 390, 'height': 844})
    navigate('character')
    page.locator(f'[data-action="select"][data-id="{character["id"]}"]').click()
    expect(page.locator('#entity-form [name="name"]')).to_be_visible()
    page.screenshot(path=str(ROOT / 'test-results' / 'workspace-mobile.png'), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), 'Mobile horizontal overflow'
    assert not errors, errors


def main():
    (ROOT / "test-results").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="myth-browser-") as temp:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base_url = f"http://127.0.0.1:{port}"
        task_env = dict(os.environ, MYTH_DB_PATH=str(Path(temp) / "fixture.sqlite3"),
                        MYTH_HOST="127.0.0.1", MYTH_PORT=str(port))
        log_path = ROOT / "test-results" / "browser-server.log"
        with log_path.open("w") as log:
            server = subprocess.Popen([sys.executable, "-m", "myth"], cwd=ROOT,
                                      env=task_env, stdout=log, stderr=subprocess.STDOUT)
            try:
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError(log_path.read_text())
                    try:
                        with urllib.request.urlopen(base_url + "/api/health", timeout=1) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError("Server did not become ready: " + log_path.read_text())
                with sync_playwright() as playwright:
                    executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
                    browser = playwright.chromium.launch(
                        executable_path=executable, headless=True, args=["--no-sandbox"])
                    try:
                        page = browser.new_page(viewport={"width": 1440, "height": 980})
                        exercise(page, base_url)
                    finally:
                        browser.close()
                print("PASS: Chromium functional smoke test (isolated database)")
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


if __name__ == "__main__":
    main()
