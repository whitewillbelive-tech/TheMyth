"""New main-workspace API regressions use only isolated temporary SQLite files."""
import copy
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from myth.app import create_app


class MainWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="myth-main-test-")
        self.path = Path(self.directory.name) / "test.sqlite3"
        self.client = TestClient(create_app(db_path=str(self.path)))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def req(self, method, path, body=None):
        response = self.client.request(method, path, json=body)
        self.assertLess(response.status_code, 300, response.text)
        return response.json()

    def state(self):
        return self.req("GET", "/api/state")

    def entity(self, kind, name, data=None):
        return self.req("POST", "/api/entities", {"kind": kind, "name": "[TEST] " + name, "data": data or {}})

    def record(self, table, record_id):
        return next(row for row in self.state()[table] if row["id"] == record_id)

    def catalog(self):
        return self.req("POST", "/api/catalog/reconcile", {})

    def sync(self, character, title_ids, **extra):
        all_relations = self.state()["relations"]
        revisions = {row["id"]: row["revision"] for row in all_relations if row.get("type") == "appearance" and character["id"] in (row.get("source_id"), row.get("target_id"))}
        return self.req("POST", f"/api/characters/{character['id']}/appearances", {"revision": character["revision"], "title_ids": title_ids, "appearance_revisions": revisions, **extra})

    def test_catalog_is_explicit_preserves_ids_and_custom_records(self):
        before = self.state()
        old_generation = next(row for row in before["entities"] if row["id"] == "generation-undecided")
        self.assertEqual(old_generation["name"], "3세대 · 미정")
        extra = self.entity("title", "Custom title", {"generation_id": "generation-universe", "custom": "[TEST] retained"})
        document = self.req("POST", "/api/documents", {"kind": "story", "name": "[TEST] manuscript", "body": "[TEST] keep original text"})
        result = self.catalog()
        self.assertEqual(len(result["created_ids"]), 6)
        self.assertEqual([row["name"] for row in result["generations"]], ["Earth", "Universe", "Heaven"])
        self.assertEqual([row["name"] for row in result["titles"]], ["위버멘쉬", "마몬", "아나키", "랑데부", "올쳐", "브이젯", "흑과 백의 서신", "영웅과 용사의 길", "체라", "월계 전쟁"])
        self.assertEqual(self.record("entities", "generation-undecided")["id"], old_generation["id"])
        self.assertEqual(self.record("entities", extra["id"]), extra)
        self.assertEqual(self.record("documents", document["id"]), document)
        after = self.state()
        repeated = self.catalog()
        self.assertTrue(repeated["unchanged"])
        for table in ("entities", "relations", "documents", "versions"):
            self.assertEqual(after[table], self.state()[table])

    def test_catalog_keeps_user_renames_order_and_archived_titles_after_registration(self):
        result = self.catalog()
        title = result["titles"][4]
        renamed = self.req("PATCH", f"/api/entities/{title['id']}", {"name": "[TEST] user revised title", "sort_order": 42})
        deleted = result["titles"][5]
        self.req("DELETE", f"/api/entities/{deleted['id']}")
        again = self.catalog()
        self.assertTrue(again["unchanged"])
        self.assertEqual(self.record("entities", title["id"]), renamed)
        self.assertTrue(self.record("entities", deleted["id"])["deleted_at"])
        self.assertEqual(len(self.state()["entities"]), 14)

    def test_duplicate_or_unassigned_catalog_title_rolls_back_all_changes(self):
        self.entity("title", "irrelevant")
        self.req("POST", "/api/entities", {"kind": "title", "name": "올쳐", "data": {}})
        before = self.state()
        failed = self.client.post("/api/catalog/reconcile", json={})
        self.assertEqual(failed.status_code, 409)
        self.assertEqual(before["entities"], self.state()["entities"])
        self.assertEqual(before["versions"], self.state()["versions"])

    def test_one_character_multiple_titles_sparse_profiles_and_shared_identity(self):
        catalog = self.catalog()
        planet = self.entity("planet", "Origin")
        character = self.entity("character", "One global identity", {"origin_planet_id": planet["id"], "abilities": "[TEST] common ability"})
        a, b = catalog["titles"][0], catalog["titles"][4]
        result = self.sync(character, [a["id"], b["id"]])
        self.assertEqual(len(result["created"]), 2)
        appearances = result["appearances"]
        slot = next(row for row in appearances if row["target_id"] == a["id"])
        saved = self.req("PATCH", f"/api/characters/{character['id']}/title-settings/{a['id']}", {"revision": slot["revision"], "overrides": {"abilities": "[TEST] title A ability", "name": "[TEST] title A name"}, "inherit_fields": []})
        self.assertEqual(saved["data"]["overrides"], {"abilities": "[TEST] title A ability", "name": "[TEST] title A name"})
        common = self.req("PATCH", f"/api/entities/{character['id']}", {"data": {**self.record("entities", character["id"])["data"], "abilities": "[TEST] changed common ability"}})
        self.assertEqual(common["data"]["origin_planet_id"], planet["id"])
        self.assertEqual(self.record("relations", slot["id"])["data"]["overrides"]["abilities"], "[TEST] title A ability")
        other = next(row for row in appearances if row["target_id"] == b["id"])
        self.assertEqual(self.record("relations", other["id"])["data"]["overrides"], {})
        inherited = self.req("PATCH", f"/api/characters/{character['id']}/title-settings/{a['id']}", {"revision": saved["revision"], "overrides": {}, "inherit_fields": ["abilities"]})
        self.assertNotIn("abilities", inherited["data"]["overrides"])
        self.assertIn("abilities", inherited["data"]["inherit_fields"])
        self.assertEqual([row["id"] for row in self.state()["entities"] if row["kind"] == "character"], [character["id"]])

    def test_detach_requires_confirmation_and_reconnect_restores_same_record(self):
        title = self.catalog()["titles"][0]
        character = self.entity("character", "Protected slot")
        linked = self.sync(character, [title["id"]])
        slot = linked["created"][0]
        saved = self.req("PATCH", f"/api/characters/{character['id']}/title-settings/{title['id']}", {"revision": slot["revision"], "overrides": {"notes": "[TEST] must survive detach"}})
        current = linked["character"]
        body = {"revision": current["revision"], "title_ids": [], "appearance_revisions": {saved["id"]: saved["revision"]}}
        self.assertEqual(self.client.post(f"/api/characters/{character['id']}/appearances", json=body).status_code, 409)
        self.assertFalse(self.record("relations", slot["id"])["deleted_at"])
        detached = self.sync(current, [], confirm_detach=True)
        self.assertTrue(self.record("relations", slot["id"])["deleted_at"])
        restored = self.sync(detached["character"], [title["id"]])
        self.assertEqual(restored["restored"][0]["id"], slot["id"])
        self.assertEqual(restored["restored"][0]["data"]["overrides"]["notes"], "[TEST] must survive detach")
        self.assertFalse(self.record("entities", character["id"])["deleted_at"])
        self.assertTrue(any(row["target_id"] == slot["id"] for row in self.state()["versions"]))

    def test_revisions_guard_both_selection_and_profile_changes(self):
        title = self.catalog()["titles"][0]
        character = self.entity("character", "Concurrent slot")
        linked = self.sync(character, [title["id"]])
        slot = linked["created"][0]
        path = f"/api/characters/{character['id']}/appearances"
        self.assertEqual(self.client.post(path, json={"revision": character["revision"], "title_ids": []}).status_code, 409)
        self.assertEqual(self.client.post(path, json={"revision": linked["character"]["revision"], "title_ids": []}).status_code, 409)
        endpoint = f"/api/characters/{character['id']}/title-settings/{title['id']}"
        saved = self.req("PATCH", endpoint, {"revision": slot["revision"], "overrides": {"role": "[TEST] current"}})
        self.assertEqual(self.client.patch(endpoint, json={"revision": slot["revision"], "overrides": {"role": "[TEST] stale"}}).status_code, 409)
        self.assertEqual(self.record("relations", slot["id"]), saved)

    def test_legacy_reverse_appearance_and_unknown_fields_are_preserved(self):
        title = self.catalog()["titles"][0]
        character = self.entity("character", "Legacy")
        legacy = self.req("POST", "/api/relations", {"source_id": title["id"], "target_id": character["id"], "type": "appearance", "data": {"role": "[TEST] legacy role", "note": "[TEST] legacy note", "unknown": {"keep": 3}}})
        saved = self.req("PATCH", f"/api/characters/{character['id']}/title-settings/{title['id']}", {"revision": legacy["revision"], "overrides": {"condition": "[TEST] different state"}, "inherit_fields": ["role"]})
        self.assertEqual(saved["id"], legacy["id"])
        self.assertEqual(saved["source_id"], title["id"])
        self.assertEqual(saved["data"]["role"], legacy["data"]["role"])
        self.assertEqual(saved["data"]["note"], legacy["data"]["note"])
        self.assertEqual(saved["data"]["unknown"], {"keep": 3})
        self.assertIn("role", saved["data"]["inherit_fields"])

    def test_invalid_slot_fields_references_and_time_are_atomic(self):
        title = self.catalog()["titles"][0]
        character = self.entity("character", "Valid identity")
        org = self.entity("organization", "Not a planet")
        linked = self.sync(character, [title["id"]])
        slot = linked["created"][0]
        endpoint = f"/api/characters/{character['id']}/title-settings/{title['id']}"
        for patch in ({"origin_planet_id": org["id"]}, {"activity_planet_id": org["id"]}, {"time": {"mode": "absolute", "year": "unknown"}}, {"organization_ids": ["missing"]}):
            with self.subTest(patch=patch):
                failed = self.client.patch(endpoint, json={"revision": slot["revision"], "overrides": patch})
                self.assertGreaterEqual(failed.status_code, 400)
                self.assertEqual(self.record("relations", slot["id"]), slot)

    def test_profile_referencing_archived_object_survives_backup_roundtrip(self):
        title = self.catalog()["titles"][0]
        character = self.entity("character", "Backup owner")
        planet = self.entity("planet", "Former activity planet")
        linked = self.sync(character, [title["id"]])
        slot = linked["created"][0]
        saved = self.req("PATCH", f"/api/characters/{character['id']}/title-settings/{title['id']}", {"revision": slot["revision"], "overrides": {"activity_planet_id": planet["id"]}})
        self.req("DELETE", f"/api/entities/{planet['id']}")
        backup = self.req("GET", "/api/backup")
        with TestClient(create_app(db_path=str(Path(self.directory.name) / "restore.sqlite3"))) as client:
            restored = client.post("/api/backup/restore", json={"backup": backup, "mode": "replace", "confirm": "REPLACE"})
            self.assertEqual(restored.status_code, 200, restored.text)
            row = next(row for row in client.get("/api/state").json()["relations"] if row["id"] == saved["id"])
            self.assertEqual(row["data"]["overrides"], saved["data"]["overrides"])

    def test_event_title_scope_direction_and_unknown_time_remain_valid(self):
        catalog = self.catalog()
        a_title, b_title = catalog["titles"][:2]
        a = self.entity("event", "Later cause", {"title_id": a_title["id"], "generation_id": "generation-earth", "time": {"mode": "absolute", "year": 10}})
        b = self.entity("event", "Earlier result", {"title_id": b_title["id"], "generation_id": "generation-earth", "time": {"mode": "absolute", "year": 1}})
        unknown = self.entity("event", "Unknown", {"title_id": a_title["id"], "time": {"mode": "unknown"}})
        edge = self.req("POST", "/api/relations", {"source_id": a["id"], "target_id": b["id"], "type": "causes", "data": {}})
        result = self.req("GET", "/api/timeline")
        self.assertTrue(any(row["type"] == "date_order" and edge["id"] in row["ids"] for row in result["conflicts"]))
        scoped = self.req("GET", f"/api/timeline?generation_id=generation-earth&title_id={a_title['id']}&include_common=0")
        self.assertIn(a["id"], [row["id"] for row in scoped["events"]])
        self.assertIn(unknown["id"], [row["id"] for row in scoped["events"]])
        self.assertNotIn(b["id"], [row["id"] for row in scoped["events"]])
        self.assertEqual(self.record("entities", unknown["id"])["data"]["time"], {"mode": "unknown"})
        bad = self.client.post("/api/entities", json={"kind": "event", "name": "[TEST] bad generation", "data": {"title_id": a_title["id"], "generation_id": "generation-universe"}})
        self.assertEqual(bad.status_code, 422)

    def test_timeline_scope_excludes_other_title_states_and_rejects_context_mismatch(self):
        titles = self.catalog()["titles"]
        a = self.entity("character", "First title")
        b = self.entity("character", "Second title")
        self.sync(a, [titles[0]["id"]])
        self.sync(b, [titles[1]["id"]])
        sa = self.req("POST", "/api/states", {"entity_id": a["id"], "attribute": "status", "value": "[TEST] a", "start": {"mode": "absolute", "year": 0}})
        sb = self.req("POST", "/api/states", {"entity_id": b["id"], "attribute": "status", "value": "[TEST] b", "start": {"mode": "absolute", "year": 0}})
        result = self.req("GET", f"/api/timeline?year=1&title_id={titles[0]['id']}&include_common=0")
        self.assertIn(sa["id"], [row["id"] for row in result["effective_states"]])
        self.assertNotIn(sb["id"], [row["id"] for row in result["effective_states"]])
        mismatch = self.client.get(f"/api/timeline?generation_id=generation-universe&title_id={titles[0]['id']}")
        self.assertEqual(mismatch.status_code, 422)

    def test_optional_legacy_null_title_references_remain_readable(self):
        title = self.catalog()["titles"][0]
        event = self.entity("event", "Legacy common event", {"title_ids": None, "time": {"mode": "unknown"}})
        result = self.req("GET", f"/api/timeline?title_id={title['id']}")
        self.assertIn(event["id"], [row["id"] for row in result["events"]])


if __name__ == "__main__":
    unittest.main()
