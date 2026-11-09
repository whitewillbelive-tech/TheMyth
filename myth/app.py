import os
import math
from pathlib import Path
from urllib.parse import quote

from fastapi import Body, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .store import Store, WRITABLE, fail, timeline
from .main_workspace import reconcile_catalog, sync_appearances, update_title_settings


ROOT = Path(__file__).resolve().parent.parent


def create_app(db_path=None):
    store = Store(db_path or os.environ.get("MYTH_DB_PATH", str(ROOT / "data" / "myth.sqlite3")))
    app = FastAPI(title="The Myth", version="1.0.0")
    app.state.store = store

    @app.middleware("http")
    async def protect_local_writes(request: Request, call_next):
        if request.method in ("POST", "PATCH", "PUT", "DELETE"):
            origin = request.headers.get("origin")
            expected = f"{request.url.scheme}://{request.headers.get('host', '')}"
            if origin and origin.rstrip("/") != expected.rstrip("/"):
                return JSONResponse({"detail": "다른 사이트에서 이 작업 공간을 변경할 수 없습니다."}, status_code=403)
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "다른 사이트의 변경 요청이 차단되었습니다."}, status_code=403)
            length = request.headers.get("content-length")
            if length and (not length.isdigit() or int(length) > 32 * 1024 * 1024):
                return JSONResponse({"detail": "요청은 32 MiB 이하여야 합니다."}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/health")
    def health():
        with store.connect() as db:
            db.execute("SELECT 1").fetchone()
        return {"status": "ok", "schema_version": 1, "storage": "sqlite"}

    @app.get("/api/state")
    def state():
        return store.state()

    @app.get("/api/timeline")
    def get_timeline(year: float | None = None, title_id: str | None = None, generation_id: str | None = None, include_common: bool = True):
        if year is not None and not math.isfinite(year):
            fail("유한한 숫자 연도를 입력하세요.")
        return timeline(store.state(), year, title_id, generation_id, include_common)

    @app.get("/api/backup")
    def backup():
        return JSONResponse(store.backup(), headers={"Content-Disposition": 'attachment; filename="the-myth-backup.json"'})

    @app.post("/api/backup/restore")
    def import_backup(payload: dict = Body(...)):
        return store.import_backup(payload.get("backup"), payload.get("mode", "merge"), payload.get("confirm"))

    @app.post("/api/catalog/reconcile")
    def register_main_catalog(payload: dict = Body(default={})):
        with store.transaction() as db:
            return reconcile_catalog(store, db)

    @app.post("/api/characters/{id}/appearances")
    def set_appearances(id: str, payload: dict = Body(...)):
        with store.transaction() as db:
            return sync_appearances(store, db, id, payload)

    @app.patch("/api/characters/{id}/title-settings/{title_id}")
    def set_title_settings(id: str, title_id: str, payload: dict = Body(...)):
        with store.transaction() as db:
            return update_title_settings(store, db, id, title_id, payload)

    @app.get("/api/entities/{id}/impact")
    @app.post("/api/entities/{id}/impact")
    def impact(id: str):
        with store.connect() as db:
            return store.impact(db, id)

    @app.get("/api/entities/{id}/merge-preview")
    def merge_preview(id: str, source_id: str):
        with store.connect() as db:
            return store.merge_preview(db, id, source_id)

    @app.post("/api/entities/{id}/merge")
    def merge(id: str, payload: dict = Body(...)):
        with store.transaction() as db:
            return store.merge(db, id, payload.get("source_id"), payload.get("field_choices", {}))

    @app.post("/api/entities/{id}/split")
    def split(id: str, payload: dict = Body(...)):
        with store.transaction() as db:
            return store.split(db, id, payload)

    @app.post("/api/versions/{id}/restore")
    def restore_version(id: str):
        with store.transaction() as db:
            return store.restore_version(db, id)

    @app.get("/api/documents/{id}/export")
    def export_document(id: str, format: str = "md", chapter_id: str | None = None):
        if format not in ("md", "txt"):
            fail("내보내기 형식은 md 또는 txt입니다.")
        with store.connect() as db:
            document = store.get(db, "documents", id)
            chapters = [c for c in store.all(db, "chapters") if c["document_id"] == id and not c.get("deleted_at")]
            chapters.sort(key=lambda c: (c.get("sort_order", 0), c.get("created_at", "")))
            if chapter_id:
                chapter = next((c for c in chapters if c["id"] == chapter_id), None)
                if chapter is None:
                    fail("선택한 장을 찾을 수 없습니다.", 404)
                subtree = {chapter_id}
                while True:
                    expanded = subtree | {c["id"] for c in chapters if c.get("parent_id") in subtree}
                    if subtree == expanded:
                        break
                    subtree = expanded
                chapters = [c for c in chapters if c["id"] in subtree]
                title = chapter["name"]
                lines = []
            else:
                title = document["name"]
                lines = [("# " if format == "md" else "") + title, "", document.get("body", ""), ""]
            active_ids = {c["id"] for c in chapters}
            def append_chapters(parent, depth=2):
                for chapter in chapters:
                    effective_parent = chapter.get("parent_id") if chapter.get("parent_id") in active_ids else None
                    if effective_parent == parent:
                        prefix = "#" * min(depth, 6) + " "
                        lines.extend([(prefix if format == "md" else "") + chapter["name"], "", chapter.get("body", ""), ""])
                        append_chapters(chapter["id"], depth + 1)
            if chapter_id:
                root_chapter = next(c for c in chapters if c["id"] == chapter_id)
                lines.extend([("# " if format == "md" else "") + root_chapter["name"], "", root_chapter.get("body", ""), ""])
                # root emitted separately so process only descendants.
                chapters = [c for c in chapters if c["id"] != chapter_id]
                append_chapters(chapter_id, 2)
            else:
                append_chapters(None)
            filename = quote(title.replace("/", "_").replace("\\", "_") + "." + format)
            return Response("\n".join(lines), media_type="text/markdown" if format == "md" else "text/plain", headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"})

    # Factory closures keep OpenAPI signatures clean and collections immutable.
    def register(table):
        def list_records():
            with store.connect() as db:
                return store.all(db, table)

        def get_record(id: str):
            with store.connect() as db:
                return store.get(db, table, id)

        def create_record(payload: dict = Body(...)):
            with store.transaction() as db:
                return store.create(db, table, payload)

        def update_record(id: str, payload: dict = Body(...)):
            with store.transaction() as db:
                return store.update(db, table, id, payload)

        def delete_record(id: str):
            with store.transaction() as db:
                return store.delete(db, table, id)

        def restore_record(id: str):
            with store.transaction() as db:
                return store.delete(db, table, id, restore=True)

        app.add_api_route(f"/api/{table}", list_records, methods=["GET"], name=f"list_{table}")
        app.add_api_route(f"/api/{table}/{{id}}", get_record, methods=["GET"], name=f"get_{table}")
        app.add_api_route(f"/api/{table}", create_record, methods=["POST"], name=f"create_{table}")
        app.add_api_route(f"/api/{table}/{{id}}", update_record, methods=["PATCH"], name=f"update_{table}")
        app.add_api_route(f"/api/{table}/{{id}}", delete_record, methods=["DELETE"], name=f"delete_{table}")
        if table != "memberships":
            app.add_api_route(f"/api/{table}/{{id}}/restore", restore_record, methods=["POST"], name=f"restore_{table}")

    for table in WRITABLE:
        register(table)

    @app.get("/api/versions")
    def versions():
        with store.connect() as db:
            return store.all(db, "versions")

    web = ROOT / "web"
    if web.is_dir():
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    return app
