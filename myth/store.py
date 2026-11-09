"""Transactional SQLite storage. Collections are separate tables, not browser state.

Records keep extensible JSON fields, while all ID/reference and hierarchy invariants
are checked inside the same write transaction. A schema migration log makes future
format upgrades explicit. Never interpolate user-controlled table names.
"""
import copy
import json
import math
import os
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException


COLLECTIONS = ("entities", "relations", "groups", "memberships", "states", "documents", "chapters", "versions")
WRITABLE = COLLECTIONS[:-1]
KINDS = {"generation", "title", "character", "organization", "event", "space", "planet", "civilization", "setting", "thought", "thinker", "custom"}
REFERENCE_KEYS = {"parent_id", "generation_id", "origin_planet_id", "civilization_id", "event_id", "author_id", "galaxy_master_id"}
SAFE_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")


def now():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def fail(message, code=422):
    raise HTTPException(code, detail=message)


def valid_id(value):
    return isinstance(value, str) and SAFE_ID.fullmatch(value) is not None


def references(value, target):
    """Only identifier-bearing fields count as references, not arbitrary prose."""
    if isinstance(value, dict):
        return any((k.endswith("_id") and v == target) or (k.endswith("_ids") and isinstance(v, list) and target in v) or references(v, target) for k, v in value.items())
    if isinstance(value, list):
        return any(references(v, target) for v in value)
    return False


def redirect(value, source, target):
    if isinstance(value, dict):
        return {k: (target if k.endswith("_id") and v == source else list(dict.fromkeys(target if x == source else x for x in v)) if k.endswith("_ids") and isinstance(v, list) and all(isinstance(x, str) for x in v) else redirect(v, source, target)) for k, v in value.items()}
    if isinstance(value, list):
        return [redirect(v, source, target) for v in value]
    return value


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
            for table in COLLECTIONS:
                db.execute(f"CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, record TEXT NOT NULL CHECK(json_valid(record)))")
            db.execute("CREATE INDEX IF NOT EXISTS entity_kind ON entities(json_extract(record,'$.kind'))")
            db.execute("CREATE INDEX IF NOT EXISTS relation_source ON relations(json_extract(record,'$.source_id'))")
            db.execute("CREATE INDEX IF NOT EXISTS relation_target ON relations(json_extract(record,'$.target_id'))")
            db.execute("CREATE INDEX IF NOT EXISTS chapter_document ON chapters(json_extract(record,'$.document_id'))")
            db.execute("INSERT OR IGNORE INTO schema_migrations VALUES (1,?)", (now(),))
        self.seed()

    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.execute("PRAGMA foreign_keys=ON")
        return db

    @contextmanager
    def transaction(self):
        with self.lock:
            db = self.connect()
            try:
                db.execute("BEGIN IMMEDIATE")
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise
            finally:
                db.close()

    def all(self, db, table):
        return [json.loads(row[0]) for row in db.execute(f"SELECT record FROM {table} ORDER BY rowid")]

    def get(self, db, table, id, required=True):
        row = db.execute(f"SELECT record FROM {table} WHERE id=?", (id,)).fetchone()
        if not row:
            if required:
                fail("대상을 찾을 수 없습니다.", 404)
            return None
        return json.loads(row[0])

    def put(self, db, table, record):
        db.execute(f"INSERT INTO {table}(id,record) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record", (record["id"], json.dumps(record, ensure_ascii=False)))

    def state(self, db=None):
        if db is None:
            with self.connect() as conn:
                return self.state(conn)
        return {**{table: self.all(db, table) for table in COLLECTIONS}, "meta": {"schema_version": 1, "exported_at": now(), "application": "THE MYTH"}}

    def seed(self):
        with self.transaction() as db:
            # Once initialized, even an empty user database must stay empty.
            db.execute("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            if db.execute("SELECT value FROM metadata WHERE key='initialized'").fetchone():
                return
            if not db.execute("SELECT 1 FROM entities LIMIT 1").fetchone():
                g1 = self.create(db, "entities", {"id": "generation-earth", "kind": "generation", "name": "Earth", "sort_order": 0, "data": {"number": 1}})
                self.create(db, "entities", {"id": "generation-universe", "kind": "generation", "name": "Universe", "sort_order": 1, "data": {"number": 2}})
                self.create(db, "entities", {"id": "generation-undecided", "kind": "generation", "name": "3세대 · 미정", "sort_order": 2, "data": {"number": 3, "status": "미정"}})
                for i, name in enumerate(("위버멘쉬", "마몬", "아나키", "랑데부")):
                    self.create(db, "entities", {"id": f"title-earth-{i+1}", "kind": "title", "name": name, "sort_order": i, "data": {"generation_id": g1["id"], "status": "구상", "time": {"mode": "unknown"}}})
                self.create(db, "entities", {"id": "physical-universe", "kind": "space", "name": "우주", "description": "《The Myth》의 하나의 물리적 우주.", "data": {"subtype": "우주"}})
            db.execute("INSERT INTO metadata VALUES('initialized','1')")

    def exists_reference(self, db, id, tables=("entities",), kind=None):
        if not id:
            return
        if not isinstance(id, str):
            fail("연결 대상 ID는 문자열이어야 합니다.")
        for table in tables:
            found = self.get(db, table, id, False)
            if found and (kind is None or found.get("kind") in kind):
                return found
        fail(f"존재하지 않거나 유형이 맞지 않는 연결: {id}")

    def time(self, db, value):
        if value is None:
            return
        if not isinstance(value, dict):
            fail("시간은 표현 방식이 있는 객체여야 합니다.")
        mode = value.get("mode", "unknown")
        if mode not in ("unknown", "absolute", "before", "after", "range"):
            fail("지원하지 않는 시간 표현입니다.")
        for key in ("year", "start", "end"):
            if value.get(key) is not None and (not isinstance(value[key], (int, float)) or isinstance(value[key], bool) or not math.isfinite(value[key])):
                fail("절대 연도는 숫자 또는 미확정(null)이어야 합니다.")
        if mode == "unknown" and any(value.get(k) is not None for k in ("year", "start", "end")):
            fail("미확정 시점에는 숫자 연도를 지정할 수 없습니다.")
        if mode == "absolute" and value.get("year") is None:
            fail("확정 연도를 입력하세요.")
        if mode == "range" and value.get("start") is not None and value.get("end") is not None and value["start"] > value["end"]:
            fail("기간의 시작은 종료보다 늦을 수 없습니다.")
        if mode in ("before", "after"):
            self.exists_reference(db, value.get("event_id"), kind={"event"})
            if not value.get("event_id"):
                fail("선후 관계의 기준 사건을 선택하세요.")

    def hierarchy(self, db, table, record, field="parent_id", data=False):
        parent = record.get("data", {}).get(field) if data else record.get(field)
        if parent is not None and not isinstance(parent, str):
            fail("상위 항목 ID는 문자열 또는 미정(null)이어야 합니다.")
        seen = {record["id"]}
        while parent:
            if parent in seen:
                fail("상위·하위 구조에 순환을 만들 수 없습니다.")
            seen.add(parent)
            item = self.get(db, table, parent, False)
            if not item:
                fail("상위 항목을 찾을 수 없습니다.")
            if table == "chapters" and item.get("document_id") != record.get("document_id"):
                fail("장·절의 상위 항목은 같은 서적에 속해야 합니다.")
            parent = item.get("data", {}).get(field) if data else item.get(field)

    def validate_data(self, db, data):
        if not isinstance(data, dict):
            fail("확장 정보(data)는 객체여야 합니다.")
        for key, value in data.items():
            if key in ("time", "start", "end") and isinstance(value, dict) and "mode" in value:
                self.time(db, value)
            elif key.endswith("_id") and value is not None:
                if not isinstance(value, str):
                    fail("연결 ID는 문자열 또는 미정(null)이어야 합니다.")
                self.exists_reference(db, value)
            elif key.endswith("_ids") and value is not None:
                if not isinstance(value, list):
                    fail("연결 ID 목록은 배열이어야 합니다.")
                for id in value:
                    if not isinstance(id, str) or not id:
                        fail("연결 목록에는 유효한 ID만 입력하세요.")
                    self.exists_reference(db, id, ("entities", "documents"))
            elif isinstance(value, dict):
                self.validate_data(db, value)

    def validate(self, db, table, r):
        if not valid_id(r.get("id")):
            fail("유효한 고유 ID가 필요합니다.")
        if table in ("entities", "groups", "documents", "chapters") and (not isinstance(r.get("name"), str) or not r["name"].strip()):
            fail("이름 또는 제목을 입력하세요.")
        for field in ("name", "description", "body"):
            if field in r and not isinstance(r[field], str):
                fail(f"{field}는 텍스트여야 합니다.")
        if "sort_order" in r and (not isinstance(r["sort_order"], (int, float)) or isinstance(r["sort_order"], bool) or not math.isfinite(r["sort_order"])):
            fail("정렬 순서는 숫자여야 합니다.")
        self.validate_data(db, r.get("data", {}))
        if table == "entities":
            if not isinstance(r.get("kind"), str) or r["kind"] not in KINDS:
                fail("지원하지 않는 객체 유형입니다.")
            self.hierarchy(db, table, r, data=True)
            if r.get("data", {}).get("generation_id"):
                self.exists_reference(db, r["data"]["generation_id"], kind={"generation"})
            if r.get("data", {}).get("origin_planet_id"):
                self.exists_reference(db, r["data"]["origin_planet_id"], kind={"planet"})
            if r["kind"] in ("space", "planet") and r.get("data", {}).get("parent_id"):
                self.exists_reference(db, r["data"]["parent_id"], kind={"space", "planet"})
            if r.get("data", {}).get("civilization_id"):
                self.exists_reference(db, r["data"]["civilization_id"], kind={"civilization"})
        elif table == "groups":
            self.hierarchy(db, table, r)
        elif table == "memberships":
            self.exists_reference(db, r.get("group_id"), ("groups",))
            self.exists_reference(db, r.get("entity_id"))
            if not r.get("group_id") or not r.get("entity_id"):
                fail("그룹과 객체를 선택하세요.")
            for other in self.all(db, table):
                if other["id"] != r["id"] and other["group_id"] == r["group_id"] and other["entity_id"] == r["entity_id"]:
                    fail("이미 이 그룹에 속한 객체입니다.", 409)
        elif table == "relations":
            for field in ("source_id", "target_id"):
                if not r.get(field):
                    fail("관계의 양쪽 대상을 선택하세요.")
                self.exists_reference(db, r[field], ("entities", "documents"))
            if r["source_id"] == r["target_id"] and not (r.get("deleted_at") and r.get("data", {}).get("merge_self_reference")):
                fail("동일 객체를 자신에게 연결할 수 없습니다.")
            if not isinstance(r.get("type"), str) or not r["type"].strip():
                fail("관계 유형을 입력하세요.")
            self.time(db, r.get("start"))
            self.time(db, r.get("end"))
        elif table == "states":
            if not r.get("entity_id"):
                fail("상태의 대상을 선택하세요.")
            self.exists_reference(db, r["entity_id"])
            if not isinstance(r.get("attribute"), str) or not r["attribute"].strip() or not isinstance(r.get("value"), str):
                fail("속성과 상태 값을 입력하세요.")
            self.time(db, r.get("start"))
            self.time(db, r.get("end"))
        elif table == "documents":
            if r.get("kind") not in ("story", "book"):
                fail("문서는 외전(story) 또는 사상집(book)이어야 합니다.")
            if r.get("author_id"):
                self.exists_reference(db, r["author_id"], kind={"character", "thinker"})
            if r.get("canon_status") not in ("draft", "confirmed", "noncanon", "undecided"):
                fail("설정 상태를 선택하세요.")
        elif table == "chapters":
            if not r.get("document_id"):
                fail("장·절이 속할 원고를 선택하세요.")
            self.exists_reference(db, r["document_id"], ("documents",))
            self.hierarchy(db, table, r)
        if table in ("relations", "states"):
            start, end = numeric(r.get("start")), numeric(r.get("end"), end=True)
            if start is not None and end is not None and start > end:
                fail("관계·상태의 시작은 종료보다 늦을 수 없습니다.")
        from .main_workspace import validate_main_record
        validate_main_record(self, db, table, r)

    def create(self, db, table, values):
        r = {"id": values.get("id") or new_id(), "revision": 1, "created_at": now(), "updated_at": now(), "deleted_at": None}
        if table in ("entities", "groups", "documents", "chapters"):
            r.update(name="", description="", sort_order=0)
        if table in ("entities", "relations", "states", "documents"):
            r["data"] = {}
        if table == "entities":
            r["kind"] = "custom"
        if table == "groups":
            r["parent_id"] = None
        if table in ("relations", "states"):
            r.update(start=None, end=None)
        if table == "documents":
            r.update(kind="story", body="", author_id=None, status="구상", canon_status="draft")
        if table == "chapters":
            r.update(body="", parent_id=None)
        r.update({k: v for k, v in values.items() if k not in ("revision", "created_at", "updated_at", "deleted_at")})
        if self.get(db, table, r["id"], False):
            fail("이미 존재하는 ID입니다.", 409)
        for other_table in COLLECTIONS:
            if other_table != table and self.get(db, other_table, r["id"], False):
                fail("다른 종류의 항목이 같은 ID를 사용합니다.", 409)
        self.validate(db, table, r)
        from .main_workspace import validate_main_mutation
        validate_main_mutation(self, db, table, r)
        self.put(db, table, r)
        return r

    def version(self, db, table, record, label="자동 저장 전 버전"):
        if table == "memberships":
            return
        snapshot = copy.deepcopy(record)
        if table == "documents":
            snapshot["_chapters"] = [c for c in self.all(db, "chapters") if c.get("document_id") == record["id"]]
        self.put(db, "versions", {"id": new_id(), "target_type": table, "target_id": record["id"], "created_at": now(), "label": label, "snapshot": snapshot})

    def update(self, db, table, id, values, label="자동 저장 전 버전"):
        current = self.get(db, table, id)
        if table in ("entities", "documents") and values.get("kind", current["kind"]) != current["kind"]:
            fail("연결의 무결성을 위해 기본 유형은 생성 후 변경할 수 없습니다. 세부 분류를 편집하거나 새 객체를 생성하세요.")
        if table == "chapters" and values.get("document_id", current["document_id"]) != current["document_id"]:
            fail("장·절은 원래 서적 안에서 이동할 수 있습니다. 다른 서적으로 옮기려면 내용을 복사하세요.")
        if values.get("revision") is not None and values["revision"] != current["revision"]:
            fail("다른 창에서 변경되었습니다. 최신 내용을 다시 불러온 뒤 편집하세요.", 409)
        if "id" in values and values["id"] != id:
            fail("고유 ID는 수정할 수 없습니다.")
        r = {**current, **{k: v for k, v in values.items() if k not in ("id", "revision", "created_at", "updated_at", "deleted_at")}}
        self.validate(db, table, r)
        from .main_workspace import validate_main_mutation
        validate_main_mutation(self, db, table, r, current)
        if r == current:
            return current
        self.version(db, table, current, label)
        r["revision"] += 1
        r["updated_at"] = now()
        self.put(db, table, r)
        return r

    def delete(self, db, table, id, restore=False):
        current = self.get(db, table, id)
        if table == "memberships":
            db.execute("DELETE FROM memberships WHERE id=?", (id,))
            return {"id": id, "removed": True}
        self.version(db, table, current, "삭제 전" if not restore else "복원 전")
        current.update(deleted_at=None if restore else now(), revision=current["revision"] + 1, updated_at=now())
        if restore:
            self.validate(db, table, current)
        self.put(db, table, current)
        return current

    def impact(self, db, id):
        self.get(db, "entities", id)
        affected = []
        for table in WRITABLE:
            for record in self.all(db, table):
                if record["id"] != id and references(record, id):
                    affected.append({"collection": table, "record": record})
        return {"entity_id": id, "references": affected, "count": len(affected), "policy": "참조를 유지한 채 휴지통으로 이동합니다. 연결된 자료는 삭제되지 않습니다."}

    def merge_preview(self, db, target_id, source_id):
        target, source = self.get(db, "entities", target_id), self.get(db, "entities", source_id)
        if target_id == source_id or target.get("deleted_at") or source.get("deleted_at"):
            fail("서로 다른 활성 객체를 선택하세요.")
        if target["kind"] != source["kind"]:
            fail("같은 유형의 객체만 병합할 수 있습니다.")
        conflicts = []
        for key in ("name", "description", "sort_order"):
            if target.get(key) != source.get(key) and source.get(key) not in (None, "", []):
                conflicts.append({"field": key, "target": target.get(key), "source": source.get(key)})
        for key, value in source.get("data", {}).items():
            if key in target.get("data", {}) and target["data"][key] != value:
                conflicts.append({"field": f"data.{key}", "target": target["data"][key], "source": value})
        return {"target": target, "source": source, "conflicts": conflicts, "impact": self.impact(db, source_id)}

    def merge(self, db, target_id, source_id, choices):
        preview = self.merge_preview(db, target_id, source_id)
        if not isinstance(choices, dict):
            fail("충돌 필드 선택은 객체여야 합니다.")
        target, source = preview["target"], preview["source"]
        # The client must explicitly select each conflict; no silent field loss.
        unresolved = [c["field"] for c in preview["conflicts"] if choices.get(c["field"]) not in ("target", "source")]
        if unresolved:
            fail({"message": "충돌하는 필드마다 유지할 값을 선택하세요.", "fields": unresolved}, 409)
        merged = {**target, "data": {**source.get("data", {}), **target.get("data", {})}}
        for field, choice in choices.items():
            if choice == "source":
                if field.startswith("data."):
                    merged["data"][field[5:]] = source.get("data", {}).get(field[5:])
                elif field in ("name", "description", "sort_order"):
                    merged[field] = source.get(field)
        for key in ("description",):
            if not merged.get(key):
                merged[key] = source.get(key, "")
        self.version(db, "entities", target, "병합 전 대상")
        self.version(db, "entities", source, "병합 전 원본")
        # Redirect every live and deleted reference; old revisions remain historical.
        for table in WRITABLE:
            for record in self.all(db, table):
                if table == "entities" and record["id"] in (target_id, source_id):
                    continue
                updated = redirect(record, source_id, target_id)
                if updated != record:
                    self.version(db, table, record, "병합 참조 변경 전")
                    updated.update(revision=record["revision"] + 1, updated_at=now())
                    if table == "relations" and updated["source_id"] == updated["target_id"]:
                        updated["deleted_at"] = now()
                        updated.setdefault("data", {})["merge_self_reference"] = True
                    self.put(db, table, updated)
        # Multiple membership rows cannot survive as duplicates.
        seen = set()
        for membership in self.all(db, "memberships"):
            key = (membership["group_id"], membership["entity_id"])
            if key in seen:
                db.execute("DELETE FROM memberships WHERE id=?", (membership["id"],))
            seen.add(key)
        merged = redirect(merged, source_id, target_id)
        if merged["data"].get("parent_id") == target_id:
            merged["data"]["parent_id"] = None
        self.validate(db, "entities", merged)
        merged.update(revision=target["revision"] + 1, updated_at=now())
        self.put(db, "entities", merged)
        source.update(deleted_at=now(), revision=source["revision"] + 1, updated_at=now(), data={**source["data"], "merged_into_id": target_id})
        self.put(db, "entities", source)
        # A newly redirected hierarchy may have become cyclic. Roll back all if so.
        for entity in self.all(db, "entities"):
            if not entity.get("deleted_at"):
                self.hierarchy(db, "entities", entity, data=True)
        return {"entity": merged, "source": source, "redirected_references": preview["impact"]["count"]}

    def split(self, db, id, values):
        original = self.get(db, "entities", id)
        keys = values.get("fields", [])
        if not isinstance(keys, list) or any(not isinstance(k, str) for k in keys):
            fail("복사할 확장 필드를 선택하세요.")
        selected = values.get("relation_ids", [])
        if not isinstance(selected, list):
            fail("복사할 연결 목록이 필요합니다.")
        records = []
        for relation_id in selected:
            rel = self.get(db, "relations", relation_id)
            if id not in (rel["source_id"], rel["target_id"]):
                fail("분할 대상과 연결된 관계만 복사할 수 있습니다.")
            records.append(rel)
        new = self.create(db, "entities", {"kind": original["kind"], "name": values.get("name", ""), "description": values.get("description", ""), "data": {k: original["data"][k] for k in keys if k in original["data"]}})
        for relation in records:
            clone = {k: v for k, v in relation.items() if k not in ("id", "revision", "created_at", "updated_at", "deleted_at")}
            clone = redirect(clone, id, new["id"])
            self.create(db, "relations", clone)
        self.version(db, "entities", original, f"분할: {new['name']} 생성 (원본과 연결 유지)")
        return {"entity": new, "copied_relations": len(records), "policy": "선택한 필드와 관계를 복사했습니다. 원본 및 기존 참조는 보존됩니다."}

    def restore_version(self, db, id):
        version = self.get(db, "versions", id)
        self.validate_version(db, version)
        table = version["target_type"]
        if table not in WRITABLE:
            fail("복원할 수 없는 이력입니다.")
        current = self.get(db, table, version["target_id"])
        snapshot = copy.deepcopy(version["snapshot"])
        chapters = snapshot.pop("_chapters", None)
        self.validate(db, table, snapshot)
        self.version(db, table, current, "이전 버전 복원 직전")
        snapshot.update(revision=current["revision"] + 1, updated_at=now())
        self.put(db, table, snapshot)
        if chapters is not None:
            old_ids = {c["id"] for c in chapters}
            for chapter in self.all(db, "chapters"):
                if chapter["document_id"] == snapshot["id"] and chapter["id"] not in old_ids:
                    self.delete(db, "chapters", chapter["id"])
            # Parents first are not guaranteed by ordering, so insert then validate.
            for chapter in chapters:
                prior = self.get(db, "chapters", chapter["id"], False)
                if prior:
                    self.version(db, "chapters", prior, "서적 버전 복원 전")
                chapter.update(revision=(prior or {}).get("revision", 0) + 1, updated_at=now())
                self.put(db, "chapters", chapter)
            for chapter in chapters:
                self.validate(db, "chapters", chapter)
        return snapshot

    def validate_version(self, db, version):
        """History is untrusted on import; it must never redirect restoration IDs."""
        if not isinstance(version, dict) or not valid_id(version.get("id")):
            fail("잘못된 버전 ID입니다.")
        table = version.get("target_type")
        if table not in WRITABLE or table == "memberships":
            fail("잘못된 버전 대상 유형입니다.")
        target_id, snapshot = version.get("target_id"), version.get("snapshot")
        if not valid_id(target_id) or not isinstance(snapshot, dict) or snapshot.get("id") != target_id:
            fail("버전 원본과 복원 대상의 ID가 일치하지 않습니다.")
        target = self.get(db, table, target_id)
        if table in ("entities", "documents") and snapshot.get("kind") != target.get("kind"):
            fail("이전 버전은 객체의 기본 유형을 변경할 수 없습니다.")
        if table == "chapters" and snapshot.get("document_id") != target.get("document_id"):
            fail("장·절 이력의 서적은 현재 서적과 일치해야 합니다.")
        if not isinstance(version.get("created_at"), str) or not isinstance(version.get("label"), str):
            fail("버전의 시각 또는 설명이 잘못되었습니다.")
        if not isinstance(snapshot.get("revision"), int) or isinstance(snapshot.get("revision"), bool) or snapshot["revision"] < 1:
            fail("버전의 수정 번호가 잘못되었습니다.")
        chapters = snapshot.get("_chapters")
        if chapters is not None:
            if table != "documents" or not isinstance(chapters, list):
                fail("장·절 이력이 잘못되었습니다.")
            seen = set()
            for chapter in chapters:
                if not isinstance(chapter, dict) or not valid_id(chapter.get("id")) or chapter.get("document_id") != target_id or chapter["id"] in seen:
                    fail("서적 이력의 장·절 연결이 잘못되었습니다.")
                seen.add(chapter["id"])
                current = self.get(db, "chapters", chapter["id"], False)
                if not current or current.get("document_id") != target_id:
                    fail("서적 이력은 다른 서적의 장·절을 덮어쓸 수 없습니다.")

    def backup(self):
        result = self.state()
        result["format"] = "the-myth-backup"
        result["format_version"] = 1
        return result

    def import_backup(self, backup, mode="merge", confirm=None):
        if not isinstance(backup, dict) or backup.get("format") != "the-myth-backup" or backup.get("format_version") != 1:
            fail("지원하는 THE MYTH 백업 파일이 아닙니다.")
        if mode not in ("merge", "replace"):
            fail("복원 방식은 merge 또는 replace여야 합니다.")
        if mode == "replace" and confirm != "REPLACE":
            fail("전체 교체는 confirm: REPLACE 확인이 필요합니다.", 409)
        for table in COLLECTIONS:
            if not isinstance(backup.get(table), list):
                fail(f"백업에서 {table} 목록이 누락되었습니다.")
        with self.transaction() as db:
            previous = self.state(db)
            previous.update(format="the-myth-backup", format_version=1)
            # Write the safety copy outside the DB transaction before destructive import.
            folder = Path(self.path).parent / "backups"
            folder.mkdir(parents=True, exist_ok=True)
            safety_path = folder / f"before-restore-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{new_id()[:8]}.json"
            safety_path.write_text(json.dumps(previous, ensure_ascii=False, indent=2), encoding="utf-8")
            if mode == "replace":
                for table in COLLECTIONS:
                    db.execute(f"DELETE FROM {table}")
            seen = set()
            inserted = 0
            for table in COLLECTIONS:
                for record in backup[table]:
                    if not isinstance(record, dict) or not valid_id(record.get("id")):
                        fail("잘못된 백업 레코드입니다.")
                    if record["id"] in seen:
                        fail("백업의 고유 ID가 중복되었습니다.")
                    seen.add(record["id"])
                    existing = self.get(db, table, record["id"], False)
                    if existing:
                        if existing != record:
                            fail({"message": "기존 자료와 충돌합니다. 병합은 기존 자료를 덮어쓰지 않습니다.", "collection": table, "id": record["id"]}, 409)
                        continue
                    for other_table in COLLECTIONS:
                        if other_table != table and self.get(db, other_table, record["id"], False):
                            fail("다른 자료와 ID가 충돌합니다.", 409)
                    self.put(db, table, record)
                    inserted += 1
            for table in WRITABLE:
                for record in self.all(db, table):
                    if not isinstance(record.get("revision"), int) or isinstance(record.get("revision"), bool) or record["revision"] < 1:
                        fail("백업의 수정 번호가 잘못되었습니다.")
                    self.validate(db, table, record)
            for version in self.all(db, "versions"):
                self.validate_version(db, version)
            return {"restored": inserted, "mode": mode, "safety_backup": safety_path.name}


def numeric(time, end=False):
    if not time or time.get("mode") in (None, "unknown", "before", "after"):
        return None
    if time["mode"] == "absolute":
        return time.get("year")
    if time["mode"] == "range":
        return time.get("end" if end else "start")
    return None


def bounds(record):
    if "start" in record or "end" in record:
        return numeric(record.get("start")), numeric(record.get("end"), end=True)
    time = record.get("data", {}).get("time")
    return numeric(time), numeric(time, end=True)


def active_at(record, year):
    start, end = bounds(record)
    if year is None:
        return "uncertain"
    # Empty bounds are explicitly uncertain, not fabricated infinities. An absent
    # endpoint on a record with a known opposite bound is open-ended.
    start_time, end_time = record.get("start"), record.get("end")
    if (start_time and start is None) or (end_time and end is None) or (start is None and end is None):
        return "uncertain"
    return "effective" if (start is None or start <= year) and (end is None or year <= end) else "inactive"


def timeline(state, year=None, title_id=None, generation_id=None, include_common=True):
    entities = [e for e in state["entities"] if not e.get("deleted_at")]
    relations = [r for r in state["relations"] if not r.get("deleted_at")]
    states = [r for r in state["states"] if not r.get("deleted_at")]
    by_id = {e["id"]: e for e in entities}
    selected_title = by_id.get(title_id) if title_id else None
    if title_id and (not selected_title or selected_title["kind"] != "title"):
        fail("선택한 타이틀을 찾을 수 없습니다.", 404)
    selected_generation = by_id.get(generation_id) if generation_id else None
    if generation_id and (not selected_generation or selected_generation["kind"] != "generation"):
        fail("선택한 세대를 찾을 수 없습니다.", 404)
    if generation_id and selected_title and selected_title.get("data", {}).get("generation_id") != generation_id:
        fail("선택한 세대와 타이틀이 일치하지 않습니다.")
    window = bounds(selected_title) if selected_title and year is None else (year, year)
    from .main_workspace import matches_title_scope
    def in_scope(record):
        return matches_title_scope(state, record, generation_id, title_id, include_common)
    if generation_id or title_id:
        states = [record for record in states if in_scope(by_id.get(record.get("entity_id")))]
        def relation_in_scope(record):
            if record.get("data", {}).get("title_id") and not in_scope(record):
                return False
            title_endpoints = [record_id for record_id in (record.get("source_id"), record.get("target_id")) if by_id.get(record_id, {}).get("kind") == "title"]
            if title_id and title_endpoints and title_id not in title_endpoints:
                return False
            return in_scope(by_id.get(record.get("source_id"))) and in_scope(by_id.get(record.get("target_id")))
        relations = [record for record in relations if relation_in_scope(record)]
    items = [e for e in entities if e["kind"] in ("event", "title") and in_scope(e)]
    items.sort(key=lambda e: (e.get("sort_order", 0), e.get("created_at", ""), e["id"]))
    # Stable topological order honors event precedence without assigning dates.
    item_ids = {i["id"] for i in items}
    edges = {i: set() for i in item_ids}
    for rel in relations:
        if rel["type"] in ("before", "이전", "precedes", "causes"):
            a, b = rel["source_id"], rel["target_id"]
        elif rel["type"] in ("after", "이후", "follows", "caused_by"):
            a, b = rel["target_id"], rel["source_id"]
        else:
            continue
        if a in item_ids and b in item_ids:
            edges[a].add(b)
    for item in items:
        time = item.get("data", {}).get("time", {})
        if time.get("event_id") in item_ids:
            a, b = (item["id"], time["event_id"]) if time.get("mode") == "before" else (time["event_id"], item["id"])
            edges[a].add(b)
    indegree = {i: 0 for i in item_ids}
    for targets in edges.values():
        for id in targets:
            indegree[id] += 1
    ordered = []
    while len(ordered) < len(items):
        ready = next((e for e in items if e["id"] not in {x["id"] for x in ordered} and indegree[e["id"]] == 0), None)
        if not ready:
            break
        ordered.append(ready)
        for target in edges[ready["id"]]:
            indegree[target] -= 1
    conflicts = []
    if len(ordered) < len(items):
        cyclic = [e for e in items if e["id"] not in {x["id"] for x in ordered}]
        conflicts.append({"type": "chronology_cycle", "message": "사건의 선후 관계가 순환합니다. 자료는 유지됩니다.", "ids": [e["id"] for e in cyclic]})
        ordered.extend(cyclic)
    effective_states, effective_relations, uncertain = [], [], []
    def status_in_window(record):
        if year is not None:
            return active_at(record, year)
        window_start, window_end = window
        if window_start is None and window_end is None:
            return "uncertain"
        start, end = bounds(record)
        if (record.get("start") and start is None) or (record.get("end") and end is None) or (start is None and end is None):
            return "uncertain"
        lo, hi = start if start is not None else float("-inf"), end if end is not None else float("inf")
        wl, wh = window_start if window_start is not None else float("-inf"), window_end if window_end is not None else float("inf")
        return "effective" if max(lo, wl) <= min(hi, wh) else "inactive"
    for records, output, collection in ((states, effective_states, "states"), (relations, effective_relations, "relations")):
        for record in records:
            # A title changes the observation period, never the existence or
            # organization history of characters absent from that title.
            result = status_in_window(record)
            if result == "effective":
                output.append(record)
            elif result == "uncertain":
                uncertain.append({"collection": collection, "record": record})
    # Explicitly multi-valued membership/ability is not an exclusive-state conflict.
    exclusive = {"나이", "외형", "생존 상태", "활동 상태", "현재 활동 행성", "현재 행성", "통치", "통치자", "age", "appearance", "alive", "status", "location", "current_planet", "ruler"}
    for i, a in enumerate(states):
        for b in states[i+1:]:
            if a["entity_id"] != b["entity_id"] or a["attribute"] != b["attribute"] or a["value"] == b["value"]:
                continue
            if a["attribute"] not in exclusive and not a.get("data", {}).get("exclusive") and not b.get("data", {}).get("exclusive"):
                continue
            aa, az = bounds(a)
            ba, bz = bounds(b)
            if aa is None or ba is None:
                continue
            if max(aa, ba) <= min(az if az is not None else float("inf"), bz if bz is not None else float("inf")):
                conflicts.append({"type": "state_overlap", "message": f"{a['attribute']}의 서로 다른 상태가 중첩됩니다.", "ids": [a["id"], b["id"]], "entity_id": a["entity_id"]})
    for i, a in enumerate(relations):
        if a["type"] not in ("governs", "galaxy_master", "통치", "갤럭시 마스터") or a.get("data", {}).get("exclusive") is False:
            continue
        for b in relations[i+1:]:
            if b["type"] != a["type"] or b["target_id"] != a["target_id"] or b["source_id"] == a["source_id"] or b.get("data", {}).get("exclusive") is False:
                continue
            aa, az = bounds(a)
            ba, bz = bounds(b)
            if aa is not None and ba is not None and max(aa, ba) <= min(az if az is not None else float("inf"), bz if bz is not None else float("inf")):
                conflicts.append({"type": "governance_overlap", "message": "동일 공간의 통치·조율 관계가 중첩됩니다. 공동 관계이면 exclusive=false로 표시하세요.", "ids": [a["id"], b["id"]], "entity_id": a["target_id"]})
    for rel in relations:
        if rel["type"] not in ("before", "after", "이전", "이후", "precedes", "follows", "causes", "caused_by"):
            continue
        source, target = by_id.get(rel["source_id"]), by_id.get(rel["target_id"])
        if not source or not target:
            continue
        sa, sz = bounds(source)
        ta, tz = bounds(target)
        if sa is not None and ta is not None and ((rel["type"] in ("before", "이전", "precedes", "causes") and sa > ta) or (rel["type"] in ("after", "이후", "follows", "caused_by") and sa < ta)):
            conflicts.append({"type": "date_order", "message": "확정 연도와 사건 선후 관계가 충돌합니다.", "ids": [rel["id"]]})
    return {"year": year, "title_id": title_id, "generation_id": generation_id, "observation_range": {"start": window[0], "end": window[1]}, "items": ordered, "events": [e for e in ordered if e["kind"] == "event"], "titles": [e for e in ordered if e["kind"] == "title"], "effective_states": effective_states, "effective_relations": effective_relations, "uncertain": uncertain, "conflicts": conflicts}
