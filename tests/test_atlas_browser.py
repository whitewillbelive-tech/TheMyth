"""Atlas browser regression against a temporary local SQLite database.

Run: python3 tests/test_atlas_browser.py
This starts its own local server; it never accesses a Sites deployment or D1/R2.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def run_browser(base_url: str) -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH") or shutil.which("chromium"),
            headless=True,
            args=["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
        )
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            page_errors = []
            failed_modules = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("response", lambda response: failed_modules.append(f"{response.status} {response.url}")
                    if "/atlas-" in response.url and response.status >= 400 else None)
            page.goto(base_url, wait_until="networkidle")
            expect(page.get_by_role("button", name="본편", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="외전+사상집", exact=True)).to_be_visible()
            # Seed only the temporary test database so real-mode checks use a known record.
            response = page.request.post(base_url + "/api/entities", data={
                "kind": "space", "name": "[TEST] 실자료 은하", "data": {
                    "subtype": "galaxy", "parent_id": "physical-universe",
                    "coords": [1, 2, 3],
                },
            })
            assert response.ok, response.text()
            galaxy = response.json()
            page.reload(wait_until="networkidle")
            before = page.request.get(base_url + "/api/state").json()
            page.locator('.side-nav [data-action="view"][data-id="spaces"]').click()
            page.locator('[data-action="view"][data-id="atlas"]').click()
            expect(page.locator('#atlas-root')).to_be_visible()
            expect(page.locator('[data-atlas="real"]')).to_have_attribute("aria-pressed", "true")
            real_row = page.locator(f'[data-atlas-select="{galaxy["id"]}"]')
            expect(real_row).to_contain_text("좌표 미설정")
            expect(page.locator('#atlas-labels [data-atlas-marker]')).to_have_count(0)
            expect(page.locator('#passage-list [data-passage-id]')).to_have_count(0)
            expect(page.locator('#passage-caption')).to_contain_text("실제 통로 자료 없음")

            page.locator('[data-atlas="demo"]').click()
            expect(page.locator('[data-atlas="demo"]')).to_have_attribute("aria-pressed", "true")
            expect(page.locator('#atlas-performance')).to_contain_text(re.compile(r'FPS'), timeout=20000)
            expect(page.locator('#atlas-canvas')).to_be_visible()
            assert page.locator('#atlas-canvas').evaluate("canvas => !!canvas.getContext('webgl2')"), "WebGL2 unavailable"
            expect(page.locator('#atlas-rows [data-atlas-select]')).to_have_count(4)
            gal_route = page.locator('[data-passage-id="demo:passage-gal-01"]')
            expect(gal_route).to_be_visible()
            expect(gal_route).not_to_contain_text("현재 화면에 선 미표시")
            gal_route.click()
            expect(page.locator('#passage-detail')).to_contain_text("가상 은하 α")
            expect(page.locator('#passage-detail')).to_contain_text("제한")
            canvas_with_passage = page.locator('#atlas-canvas').screenshot()
            page.locator('#passage-enabled').uncheck()
            expect(gal_route).to_contain_text("현재 화면에 선 미표시")
            page.wait_for_timeout(200)
            assert page.locator('#atlas-canvas').screenshot() != canvas_with_passage, "Disabling passage did not change rendered scene"
            page.locator('#passage-enabled').check()
            expect(gal_route).not_to_contain_text("현재 화면에 선 미표시")
            page.locator('#passage-status').select_option("open")
            expect(gal_route).to_have_count(0)
            page.locator('#passage-status').select_option("all")
            page.locator('#passage-galaxy').uncheck()
            expect(gal_route).to_have_count(0)
            page.locator('#passage-galaxy').check()

            page.locator('[data-atlas-select="demo:gal-01"]').click()
            expect(page.locator('#atlas-path')).to_contain_text("가상 은하 α", timeout=10000)
            expect(page.locator('[data-atlas-select="demo:p-01"]')).to_be_visible()
            planet_route = page.locator('[data-passage-id="demo:passage-planet-01"]')
            expect(planet_route).to_be_visible()
            expect(planet_route).not_to_contain_text("현재 화면에 선 미표시")
            planet_route.click()
            expect(page.locator('#passage-detail')).to_contain_text("가상 행성 A")
            page.locator('#passage-status').select_option("closed")
            expect(planet_route).to_have_count(0)
            page.locator('#passage-status').select_option("all")
            page.locator('#passage-planet').uncheck()
            expect(planet_route).to_have_count(0)
            page.locator('#passage-planet').check()
            page.locator('[data-atlas-select="demo:p-01"]').click()
            expect(page.locator('#atlas-path')).to_contain_text("가상 행성 A")
            expect(page.locator('[data-atlas-select="demo:city-01"]')).to_be_visible()
            expect(page.locator('#atlas-labels [data-atlas-marker="demo:city-01"]')).to_have_count(1)
            # Planet starts without auto-rotation, while drag changes its viewpoint.
            canvas = page.locator('#atlas-canvas')
            first_frame = canvas.screenshot()
            page.wait_for_timeout(700)
            assert canvas.screenshot() == first_frame, "Planet view changed without input"
            box = canvas.bounding_box()
            assert box
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x + 90, y + 30, steps=8)
            page.mouse.up()
            page.wait_for_timeout(300)
            assert canvas.screenshot() != first_frame, "Dragging did not change the planet view"
            page.locator('[data-atlas-select="demo:city-01"]').click()
            page.locator('[data-atlas="city-enter"]').click()
            expect(page.locator('#atlas-city-root')).to_be_visible()
            expect(page.locator('#atlas-city-root svg')).to_be_visible()
            expect(page.locator('.atlas-canvas-wrap')).to_be_hidden()
            expect(page.locator('#atlas-performance')).to_contain_text("2D")
            city_map = page.locator('#atlas-city-root svg')
            before_zoom = city_map.get_attribute("viewBox")
            page.locator('[data-city-zoom="in"]').click()
            assert city_map.get_attribute("viewBox") != before_zoom, "City zoom did not change viewBox"
            before_pan = city_map.get_attribute("viewBox")
            city_box = city_map.bounding_box()
            assert city_box
            city_x, city_y = city_box["x"] + city_box["width"] / 2, city_box["y"] + city_box["height"] / 2
            page.mouse.move(city_x, city_y)
            page.mouse.down()
            page.mouse.move(city_x + 80, city_y + 40, steps=6)
            page.mouse.up()
            assert city_map.get_attribute("viewBox") != before_pan, "City drag did not change viewBox"
            page.locator('[data-atlas="planet-return"]').click()
            expect(page.locator('#atlas-path')).to_contain_text("가상 행성 A")
            expect(page.locator('#atlas-canvas')).to_be_visible()
            page.locator('[data-atlas="real"]').click()
            expect(real_row).to_contain_text("좌표 미설정")
            expect(page.locator('#passage-list [data-passage-id]')).to_have_count(0)
            after = page.request.get(base_url + "/api/state").json()
            # The API emits a new export timestamp on every state request.
            before["meta"].pop("exported_at", None)
            after["meta"].pop("exported_at", None)
            assert before == after, "Atlas interaction changed archive records"
            assert not page_errors, f"JavaScript errors: {page_errors}"
            assert not failed_modules, f"Atlas module loads failed: {failed_modules}"
            print("PASS: Atlas real-mode safety, WebGL2 demo navigation, passage controls, city 2D zoom and return")
        finally:
            browser.close()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="myth-atlas-browser-") as temp:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base_url = f"http://127.0.0.1:{port}"
        task_env = dict(os.environ, MYTH_DB_PATH=str(Path(temp) / "test.sqlite3"),
                        MYTH_HOST="127.0.0.1", MYTH_PORT=str(port))
        with (Path(temp) / "server.log").open("w+") as log:
            server = subprocess.Popen([sys.executable, "-m", "myth"], cwd=ROOT,
                                      env=task_env, stdout=log, stderr=subprocess.STDOUT)
            try:
                for _ in range(100):
                    if server.poll() is not None:
                        log.seek(0)
                        raise RuntimeError("Test server exited: " + log.read())
                    try:
                        with urllib.request.urlopen(base_url + "/api/health", timeout=1) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        time.sleep(.1)
                else:
                    log.seek(0)
                    raise RuntimeError("Test server did not become ready: " + log.read())
                run_browser(base_url)
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait(timeout=5)


if __name__ == "__main__":
    main()
