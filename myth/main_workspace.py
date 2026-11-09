"""Optional main-workspace operations for the local SQLite application.

The hosted application uses the equivalent Sites adapter.  These operations use
the existing JSON collections and the caller's single transaction; they do not
seed on startup, replace records, write backup storage, or create a schema.
"""
import copy
import math
import unicodedata

from .store import fail


CATALOG = (
    (1, "Earth", ("위버멘쉬", "마몬", "아나키", "랑데부")),
    (2, "Universe", ("올쳐", "브이젯", "흑과 백의 서신", "영웅과 용사의 길", "체라", "월계 전쟁")),
    (3, "Heaven", ()),
)
PROFILE_FIELDS = {
    "name": "text", "aliases": "aliases", "presence": "text", "role": "text",
    "appearance": "text", "condition": "text", "activity_space_id": "space",
    "activity_planet_id": "planet", "organization_ids": "organizations",
    "position": "text", "abilities": "text", "values": "text", "time": "time",
    "description": "text", "notes": "text",
}
EVENT_RELATIONS = {"related", "before", "after", "causes", "caused_by"}


def normal(value):
    return " ".join(unicodedata.normalize("NFC", str(value or "")).split())


def catalog_key(number, title=None):
    return f"generation:{number}" if title is None else f"title:{number}:{title}"


def catalog_status(records):
    missing, conflicts = [], []
    for number, _, titles in CATALOG:
        key = catalog_key(number)
        tagged = [row for row in records if row.get("kind") == "generation" and row.get("data", {}).get("catalog_key") == key]
        if len(tagged) > 1:
            conflicts.append(f"{number}세대의 등록 표식이 중복되었습니다.")
        if not tagged:
            missing.append(key)
        if not tagged and len([row for row in records if row.get("kind") == "generation" and not row.get("deleted_at") and not isinstance(row.get("data", {}).get("number"), bool) and row.get("data", {}).get("number") == number]) > 1:
            conflicts.append(f"{number}세대 객체가 여러 개입니다. 기존 ID를 먼저 확인하세요.")
        for title in titles:
            key = catalog_key(number, title)
            found = [row for row in records if row.get("kind") == "title" and row.get("data", {}).get("catalog_key") == key]
            if len(found) > 1:
                conflicts.append(f"{title}의 등록 표식이 중복되었습니다.")
            if not found:
                missing.append(key)
    return {"initialized": not missing and not conflicts, "needsSetup": bool(missing), "missing": missing, "conflicts": conflicts}


def _active_entity(store, db, record_id, kind):
    record = store.get(db, "entities", record_id)
    if record.get("kind") != kind or record.get("deleted_at"):
        fail("활성 상태의 올바른 자료 유형을 선택하세요.")
    return record


def _revision(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value == int(value) and value >= 1


def _check_revision(record, value):
    if not _revision(value) or value != record.get("revision"):
        fail("다른 창에서 변경되었습니다. 최신 내용을 다시 불러온 뒤 편집하세요.", 409)


def reconcile_catalog(store, db):
    records = store.all(db, "entities")
    status = catalog_status(records)
    if status["conflicts"]:
        fail({"message": "세대·타이틀 중복을 먼저 확인하세요.", "conflicts": status["conflicts"]}, 409)
    created, updated = [], []
    generations, titles = [], []
    for number, name, names in CATALOG:
        key = catalog_key(number)
        records = store.all(db, "entities")
        tagged = [row for row in records if row.get("kind") == "generation" and row.get("data", {}).get("catalog_key") == key]
        if tagged:
            generation = tagged[0]
        else:
            candidates = [row for row in records if row.get("kind") == "generation" and
                          not isinstance(row.get("data", {}).get("number"), bool) and row.get("data", {}).get("number") == number]
            if len(candidates) > 1 or candidates and candidates[0].get("deleted_at"):
                fail("세대 객체의 중복 또는 휴지통 기록을 먼저 확인하세요.", 409)
            if candidates:
                old = candidates[0]
                generation = store.update(db, "entities", old["id"], {"name": name, "sort_order": number - 1, "data": {**old.get("data", {}), "number": number, "catalog_key": key}}, "세대·타이틀 체계 등록 전")
                if generation != old:
                    updated.append(generation["id"])
            else:
                generation = store.create(db, "entities", {"kind": "generation", "name": name, "sort_order": number - 1, "data": {"number": number, "catalog_key": key}})
                created.append(generation["id"])
        generations.append(generation)
        for index, title_name in enumerate(names):
            key = catalog_key(number, title_name)
            records = store.all(db, "entities")
            tagged = [row for row in records if row.get("kind") == "title" and row.get("data", {}).get("catalog_key") == key]
            if tagged:
                if len(tagged) != 1:
                    fail("타이틀 등록 표식의 세대 또는 ID가 일치하지 않습니다.", 409)
                title = tagged[0]
            else:
                candidates = [row for row in records if row.get("kind") == "title" and row.get("data", {}).get("generation_id") == generation["id"] and normal(row.get("name")) == title_name]
                if len(candidates) > 1 or candidates and candidates[0].get("deleted_at"):
                    fail("타이틀의 중복 또는 휴지통 기록을 먼저 확인하세요.", 409)
                if candidates:
                    old = candidates[0]
                    title = store.update(db, "entities", old["id"], {"sort_order": index, "data": {**old.get("data", {}), "catalog_key": key}}, "세대·타이틀 체계 등록 전")
                    if title != old:
                        updated.append(title["id"])
                else:
                    unassigned = [row for row in records if row.get("kind") == "title" and not row.get("deleted_at") and not row.get("data", {}).get("generation_id") and normal(row.get("name")) == normal(title_name)]
                    if unassigned:
                        fail("같은 이름의 미소속 타이틀이 있습니다. 기존 세대 연결을 먼저 확인하세요.", 409)
                    title = store.create(db, "entities", {"kind": "title", "name": title_name, "sort_order": index, "data": {"generation_id": generation["id"], "catalog_key": key, "status": "구상", "time": {"mode": "unknown"}}})
                    created.append(title["id"])
            titles.append(title)
    return {"generations": generations, "titles": titles, "created_ids": created, "updated_ids": updated, "unchanged": not created and not updated, "catalog": catalog_status(store.all(db, "entities"))}


def appearance_title_id(store, db, relation, character_id):
    if relation.get("type") != "appearance":
        return None
    if relation.get("source_id") == character_id:
        other = store.get(db, "entities", relation.get("target_id"), False)
    elif relation.get("target_id") == character_id:
        other = store.get(db, "entities", relation.get("source_id"), False)
    else:
        return None
    return other["id"] if other and other.get("kind") == "title" else None


def _has_content(relation):
    if relation.get("start") or relation.get("end"):
        return True
    data = relation.get("data", {})
    return bool(data.get("overrides")) or any(key in data and data[key] != "" for key in ("role", "note")) or any(key not in {"overrides", "inherit_fields", "profile_schema", "exclusive", "role", "note"} for key in data)


def create_character(store, db, payload):
    """Create one identity and its optional title slots in the caller's transaction."""
    if not isinstance(payload, dict):
        fail("인물 정보는 객체여야 합니다.")
    for key, label in (("name", "이름"), ("description", "설명")):
        if payload.get(key) is not None and not isinstance(payload[key], str):
            fail(f"{label}은 텍스트여야 합니다.")
    if payload.get("data") is not None and not isinstance(payload["data"], dict):
        fail("인물 설정은 객체여야 합니다.")

    def optional_values(values):
        result = copy.deepcopy(values)
        for key, value in result.items():
            if value is not None or key not in PROFILE_FIELDS:
                continue
            kind = PROFILE_FIELDS[key]
            result[key] = [] if kind in ("aliases", "organizations") else None if kind in ("space", "planet") else {"mode": "unknown"} if kind == "time" else ""
        return result

    data = optional_values(payload.get("data") or {})
    selected = payload.get("title_ids")
    if selected is None:
        selected = []
    if not isinstance(selected, list) or any(not isinstance(value, str) or not value for value in selected) or len(set(selected)) != len(selected):
        fail("등장 작품은 중복 없는 타이틀 ID 목록이어야 합니다.")
    for title_id in selected:
        _active_entity(store, db, title_id, "title")
    settings = payload.get("title_settings")
    if settings is None:
        settings = {}
    if not isinstance(settings, dict):
        fail("작품별 설정은 타이틀별 객체여야 합니다.")
    slots = {}
    for title_id, supplied in settings.items():
        if title_id not in selected:
            fail("등장 작품으로 선택한 타이틀의 설정만 저장할 수 있습니다.")
        if not isinstance(supplied, dict):
            fail("작품별 설정은 객체여야 합니다.")
        if supplied.get("overrides") is not None and not isinstance(supplied["overrides"], dict):
            fail("작품별 개별 설정은 객체여야 합니다.")
        overrides = optional_values(supplied.get("overrides") or {})
        inherited = supplied.get("inherit_fields")
        if inherited is None:
            inherited = []
        if not isinstance(inherited, list) or any(not isinstance(key, str) or key not in PROFILE_FIELDS for key in inherited) or len(set(inherited)) != len(inherited):
            fail("공통 설정으로 사용할 항목이 잘못되었습니다.")
        if set(inherited).intersection(overrides):
            fail("한 항목을 개별 설정과 공통 상속으로 동시에 저장할 수 없습니다.")
        for key, value in overrides.items():
            if key not in PROFILE_FIELDS:
                fail(f"지원하지 않는 작품별 정보 항목: {key}")
            _validate_profile_value(store, db, key, value)
        slots[title_id] = {"overrides": overrides, "inherit_fields": inherited}
    values = {"kind": "character", "name": (payload.get("name") or "").strip() or "이름 미정", "description": payload.get("description") or "", "data": data}
    if payload.get("sort_order") is not None:
        values["sort_order"] = payload["sort_order"]
    character = store.create(db, "entities", values)
    appearances = [store.create(db, "relations", {
        "source_id": character["id"], "target_id": title_id, "type": "appearance",
        "data": {"profile_schema": 1, **slots.get(title_id, {"overrides": {}, "inherit_fields": []})},
    }) for title_id in selected]
    return {"character": character, "appearances": appearances}


def sync_appearances(store, db, character_id, payload):
    character = _active_entity(store, db, character_id, "character")
    _check_revision(character, payload.get("revision"))
    selected = payload.get("title_ids")
    if not isinstance(selected, list) or any(not isinstance(value, str) or not value for value in selected) or len(set(selected)) != len(selected):
        fail("등장 작품은 중복 없는 타이틀 ID 목록이어야 합니다.")
    for title_id in selected:
        _active_entity(store, db, title_id, "title")
    revisions = payload.get("appearance_revisions", {})
    if not isinstance(revisions, dict):
        fail("등장 연결의 수정 번호 목록이 잘못되었습니다.")
    by_title = {}
    for relation in store.all(db, "relations"):
        title_id = appearance_title_id(store, db, relation, character_id)
        if title_id:
            by_title.setdefault(title_id, []).append(relation)
    all_relations = [row for records in by_title.values() for row in records]
    if all_relations and (not revisions or any(row["id"] not in revisions for row in all_relations) or any(record_id not in {row["id"] for row in all_relations} for record_id in revisions)):
        fail("등장 작품 기록이 변경되었거나 수정 번호가 누락되었습니다. 최신 내용을 다시 불러오세요.", 409)
    for title_id, records in by_title.items():
        active = [row for row in records if not row.get("deleted_at")]
        archived = [row for row in records if row.get("deleted_at")]
        if len(active) > 1 or not active and title_id in selected and len(archived) > 1:
            fail("같은 작품의 등장 연결이 중복됩니다. 기존 연결을 먼저 확인하세요.", 409)
        for record in records:
            if record["id"] in revisions:
                _check_revision(record, revisions[record["id"]])
    detaching = [row for title_id, rows in by_title.items() if title_id not in selected for row in rows if not row.get("deleted_at")]
    confirm = payload.get("confirm_detach")
    if confirm is not None and not isinstance(confirm, (bool, list)):
        fail("연결 해제 확인 형식이 잘못되었습니다.")
    needed = [appearance_title_id(store, db, row, character_id) for row in detaching if _has_content(row)]
    if needed and confirm is not True and not (isinstance(confirm, list) and all(title_id in confirm for title_id in needed)):
        fail({"message": "작품별 정보가 있는 연결입니다. 기록을 보존한 채 해제할지 확인하세요.", "title_ids": needed}, 409)
    detached, restored, created = [], [], []
    for relation in detaching:
        detached.append(store.delete(db, "relations", relation["id"]))
    for title_id in selected:
        records = by_title.get(title_id, [])
        if any(not row.get("deleted_at") for row in records):
            continue
        if records:
            restored.append(store.delete(db, "relations", records[0]["id"], restore=True))
        else:
            created.append(store.create(db, "relations", {"source_id": character_id, "target_id": title_id, "type": "appearance", "data": {"profile_schema": 1, "overrides": {}, "inherit_fields": []}}))
    if detached or restored or created:
        counter = character.get("data", {}).get("appearance_revision", 0)
        counter = counter if _revision(counter) or counter == 0 else 0
        character = store.update(db, "entities", character_id, {"revision": character["revision"], "data": {**character.get("data", {}), "appearance_revision": counter + 1}}, "등장 작품 연결 변경 전")
    appearances = [row for row in store.all(db, "relations") if appearance_title_id(store, db, row, character_id)]
    return {"character": character, "appearances": appearances, "detached": detached, "restored": restored, "created": created}


def _validate_profile_value(store, db, key, value, active_references=True):
    kind = PROFILE_FIELDS[key]
    if kind == "text":
        if not isinstance(value, str):
            fail(f"{key}는 텍스트여야 합니다.")
    elif kind in ("aliases", "organizations"):
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            fail(f"{key}는 문자열 목록이어야 합니다.")
        if kind == "organizations":
            if any(not item for item in value) or len(set(value)) != len(value):
                fail("소속 집단·문명에 빈 연결이나 중복 연결이 있습니다.")
            for record_id in value:
                target = store.exists_reference(db, record_id, kind={"organization", "civilization"})
                if active_references and target.get("deleted_at"):
                    fail("휴지통의 자료는 새로운 작품별 설정에 연결할 수 없습니다.")
    elif kind == "time":
        store.time(db, value)
    elif value is not None and value != "":
        if not isinstance(value, str):
            fail("활동 장소는 연결 ID 또는 미정이어야 합니다.")
        target = store.exists_reference(db, value, kind={"planet"} if kind == "planet" else {"space", "planet"})
        if active_references and target.get("deleted_at"):
            fail("휴지통의 자료는 새로운 작품별 설정에 연결할 수 없습니다.")


def update_title_settings(store, db, character_id, title_id, payload):
    _active_entity(store, db, character_id, "character")
    _active_entity(store, db, title_id, "title")
    candidates = [row for row in store.all(db, "relations") if not row.get("deleted_at") and appearance_title_id(store, db, row, character_id) == title_id]
    if len(candidates) != 1:
        fail("해당 작품의 고유한 등장 연결을 먼저 선택하세요.", 409)
    relation = candidates[0]
    _check_revision(relation, payload.get("revision"))
    overrides, inherited = payload.get("overrides", {}), payload.get("inherit_fields", [])
    if not isinstance(overrides, dict) or not isinstance(inherited, list) or any(not isinstance(key, str) or key not in PROFILE_FIELDS for key in inherited) or len(set(inherited)) != len(inherited):
        fail("작품별 설정과 상속 필드 형식이 잘못되었습니다.")
    if any(key not in PROFILE_FIELDS for key in overrides) or set(inherited).intersection(overrides):
        fail("지원하는 필드를 한 가지 상속 방식으로만 선택하세요.")
    for key, value in overrides.items():
        _validate_profile_value(store, db, key, value)
    data = copy.deepcopy(relation.get("data", {}))
    merged = {**(data["overrides"] if isinstance(data.get("overrides"), dict) else {}), **copy.deepcopy(overrides)}
    old_inherit = data["inherit_fields"] if isinstance(data.get("inherit_fields"), list) else []
    if any(not isinstance(key, str) for key in old_inherit):
        fail("기존 작품별 상속 기록의 형식을 먼저 확인하세요.")
    inherit = set(old_inherit)
    for key in inherited:
        merged.pop(key, None)
        inherit.add(key)
    for key in overrides:
        inherit.discard(key)
    data.update(overrides=merged, inherit_fields=sorted(inherit), profile_schema=1)
    return store.update(db, "relations", relation["id"], {"revision": relation["revision"], "data": data}, "작품별 인물 설정 변경 전")


def validate_main_record(store, db, table, record):
    """Optional added fields are validated without making legacy fields required."""
    data = record.get("data", {})
    if table == "relations" and data.get("profile_schema") == 1:
        source = store.get(db, "entities", record.get("source_id"), False)
        target = store.get(db, "entities", record.get("target_id"), False)
        if record.get("type") != "appearance" or not source or not target or {source.get("kind"), target.get("kind")} != {"character", "title"}:
            fail("작품별 인물 설정은 인물과 타이틀의 등장 연결에만 저장할 수 있습니다.")
        if not isinstance(data.get("overrides", {}), dict) or not isinstance(data.get("inherit_fields", []), list) or any(not isinstance(key, str) or key not in PROFILE_FIELDS for key in data.get("inherit_fields", [])):
            fail("작품별 인물 설정 형식이 잘못되었습니다.")
        for key, value in data.get("overrides", {}).items():
            if key in PROFILE_FIELDS:
                _validate_profile_value(store, db, key, value, active_references=False)


def _title_generations(store, db, entity):
    titles = {row["id"]: row for row in store.all(db, "entities") if row.get("kind") == "title" and not row.get("deleted_at")}
    ids = set()
    data = entity.get("data", {})
    if data.get("title_id") in titles:
        ids.add(data["title_id"])
    for title_id in data.get("title_ids") or []:
        if title_id in titles:
            ids.add(title_id)
    for relation in store.all(db, "relations"):
        if relation.get("deleted_at"):
            continue
        if relation.get("source_id") == entity["id"] and relation.get("target_id") in titles:
            ids.add(relation["target_id"])
        if relation.get("target_id") == entity["id"] and relation.get("source_id") in titles:
            ids.add(relation["source_id"])
    return {titles[title_id].get("data", {}).get("generation_id") for title_id in ids} - {None, ""}


def validate_main_mutation(store, db, table, record, previous=None):
    """Validate newly changed fields without rejecting historical snapshots."""
    data = record.get("data", {})
    if table == "entities":
        if record.get("kind") == "character":
            for key in PROFILE_FIELDS:
                if key in ("name", "description") or key not in data or previous and previous.get("data", {}).get(key) == data[key]:
                    continue
                if key == "aliases" and isinstance(data[key], str):
                    continue  # The original extensible model allowed comma-separated aliases.
                _validate_profile_value(store, db, key, data[key])
        if record.get("kind") == "event" and data.get("title_id") and (previous is None or previous.get("data", {}).get("title_id") != data["title_id"] or previous.get("data", {}).get("generation_id") != data.get("generation_id")):
            title = store.exists_reference(db, data["title_id"], kind={"title"})
            if title.get("deleted_at"):
                fail("사건의 소속 타이틀이 휴지통에 있습니다.")
            if data.get("generation_id") and data["generation_id"] != title.get("data", {}).get("generation_id"):
                fail("사건의 세대와 소속 타이틀의 세대가 다릅니다.")
    if table != "relations":
        return
    if previous and all(record.get(key) == previous.get(key) for key in ("source_id", "target_id", "type")):
        return
    source = store.get(db, "entities", record.get("source_id"), False)
    target = store.get(db, "entities", record.get("target_id"), False)
    a, b = source and source.get("kind") == "event", target and target.get("kind") == "event"
    if record.get("type") in {"causes", "caused_by"} and (a or b) and not (a and b):
        fail("원인·결과 사건 연결은 양쪽 모두 사건이어야 합니다.")
    if not (a and b) or record.get("type") not in EVENT_RELATIONS | {"precedes", "follows"}:
        return
    ag, bg = _title_generations(store, db, source), _title_generations(store, db, target)
    if ag and bg and not ag.intersection(bg):
        fail("사건은 같은 세대의 타이틀 사이에서 연결할 수 있습니다. 기존 사건과 관계는 유지됩니다.")


def title_ids_for_entity(state, item, visited=None):
    """Read-only title projection over shared objects, including group members."""
    visited = set() if visited is None else visited
    if not item or item["id"] in visited:
        return set()
    visited.add(item["id"])
    entities = {row["id"]: row for row in state.get("entities", [])}
    titles = {key for key, row in entities.items() if row.get("kind") == "title" and not row.get("deleted_at")}
    result = {item["id"]} if item["id"] in titles else set()
    data = item.get("data", {})
    if data.get("title_id") in titles:
        result.add(data["title_id"])
    result.update(title_id for title_id in data.get("title_ids") or [] if title_id in titles)
    relations = [row for row in state.get("relations", []) if not row.get("deleted_at")]
    for relation in relations:
        if relation.get("source_id") == item["id"] and relation.get("target_id") in titles:
            result.add(relation["target_id"])
        if relation.get("target_id") == item["id"] and relation.get("source_id") in titles:
            result.add(relation["source_id"])
    if any(group["id"] == item["id"] for group in state.get("groups", [])):
        for member in state.get("memberships", []):
            if member.get("group_id") == item["id"]:
                result.update(title_ids_for_entity(state, entities.get(member.get("entity_id")), visited))
    if item.get("kind") in {"organization", "civilization"}:
        participants = set()
        for relation in relations:
            other = relation.get("target_id") if relation.get("source_id") == item["id"] else relation.get("source_id") if relation.get("target_id") == item["id"] else None
            if entities.get(other, {}).get("kind") == "character":
                participants.add(other)
        for character in entities.values():
            if character.get("kind") != "character" or character.get("deleted_at"):
                continue
            if character.get("data", {}).get("civilization_id") == item["id"]:
                participants.add(character["id"])
            for appearance in relations:
                if appearance.get("type") != "appearance":
                    continue
                if appearance.get("source_id") == character["id"] and appearance.get("target_id") in titles:
                    title_id = appearance["target_id"]
                elif appearance.get("target_id") == character["id"] and appearance.get("source_id") in titles:
                    title_id = appearance["source_id"]
                else:
                    continue
                overrides = appearance.get("data", {}).get("overrides", {})
                organizations = overrides.get("organization_ids", character.get("data", {}).get("organization_ids", []))
                if isinstance(organizations, (list, str)) and item["id"] in organizations:
                    result.add(title_id)
        for record_id in participants:
            result.update(title_ids_for_entity(state, entities.get(record_id), visited))
    return result


def matches_title_scope(state, item, generation_id=None, title_id=None, include_common=True):
    if not generation_id and not title_id:
        return True
    ids = title_ids_for_entity(state, item)
    if not ids:
        return include_common
    if title_id:
        return title_id in ids
    entities = {row["id"]: row for row in state.get("entities", [])}
    return any(entities.get(record_id, {}).get("data", {}).get("generation_id") == generation_id for record_id in ids)
