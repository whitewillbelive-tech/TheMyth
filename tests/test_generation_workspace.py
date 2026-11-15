import copy
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from myth.app import create_app
from myth.main_workspace import generation_ids_for_entity


class GenerationWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="myth-generation-")
        self.path = Path(self.folder.name) / "archive.sqlite3"
        self.app = create_app(str(self.path))
        self.client = TestClient(self.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.folder.cleanup()

    def req(self, method, path, payload=None, **kwargs):
        response = self.client.request(method, path, json=payload, **kwargs)
        self.assertLess(response.status_code, 300, response.text)
        return response.json()

    def state(self):
        return self.req("GET", "/api/state")

    def row(self, table, record_id):
        return next(row for row in self.state()[table] if row["id"] == record_id)

    def entity(self, kind, name, data=None):
        return self.req("POST", "/api/entities", {"kind": kind, "name": "[TEST] " + name, "data": data or {}})

    def stable(self):
        state = self.state()
        state.pop("meta", None)
        return state

    def test_chera_moves_by_identity_and_legacy_profiles_and_references_survive(self):
        title = self.req("POST", "/api/entities", {"id": "existing-chera", "kind": "title", "name": "체라", "description": "[TEST] original overview", "data": {"generation_id": "generation-universe", "catalog_key": "title:2:체라", "synopsis": {"legacy": "[TEST] preserve"}}})
        character = self.entity("character", "same identity", {"values": "[TEST] legacy worldview"})
        relation = self.req("POST", "/api/relations", {"source_id": character["id"], "target_id": title["id"], "type": "appearance", "data": {"profile_schema": 1, "overrides": {"notes": "[TEST] title profile"}, "inherit_fields": []}})
        event = self.entity("event", "Chera event", {"title_id": title["id"], "generation_id": "generation-universe", "time": {"mode": "unknown"}})
        manuscript = self.req("POST", "/api/documents", {"kind": "story", "name": "[TEST] manuscript", "body": "[TEST] original text", "data": {"title_id": title["id"], "generation_id": "generation-universe"}})
        result = self.req("POST", "/api/workspace/upgrade-generation-model", {})
        moved = self.row("entities", title["id"])
        self.assertEqual(moved["id"], "existing-chera")
        self.assertEqual(moved["data"]["generation_id"], "generation-undecided")
        self.assertEqual(moved["data"]["catalog_key"], "title:3:체라")
        self.assertEqual(moved["description"], title["description"])
        self.assertEqual(moved["data"]["synopsis"], title["data"]["synopsis"])
        self.assertEqual(self.row("relations", relation["id"]), relation)
        self.assertEqual(self.row("entities", event["id"])["data"]["generation_id"], "generation-undecided")
        self.assertEqual(self.row("documents", manuscript["id"])["body"], manuscript["body"])
        self.assertEqual(self.row("documents", manuscript["id"])["data"]["generation_id"], "generation-undecided")
        slots = result["created_generation_appearances"]
        self.assertEqual(len(slots), 1)
        self.assertEqual(slots[0]["target_id"], "generation-undecided")
        self.assertEqual(slots[0]["data"]["narrative"], "")
        self.assertEqual(self.row("entities", character["id"])["data"]["values"], "[TEST] legacy worldview")
        first = self.stable()
        self.assertTrue(self.req("POST", "/api/workspace/upgrade-generation-model", {})["unchanged"])
        self.assertEqual(self.stable(), first)
        with TestClient(create_app(str(self.path))) as reopened:
            self.assertEqual(next(r for r in reopened.get("/api/state").json()["entities"] if r["id"] == title["id"])["data"]["generation_id"], "generation-undecided")

    def test_ambiguous_chera_and_mixed_generation_references_roll_back_upgrade(self):
        old = self.req("POST", "/api/entities", {"kind": "title", "name": "체라", "data": {"generation_id": "generation-universe", "catalog_key": "title:2:체라"}})
        duplicate = self.req("POST", "/api/entities", {"kind": "title", "name": "체라", "data": {"generation_id": "generation-undecided"}})
        before = self.stable()
        self.assertEqual(self.client.post("/api/workspace/upgrade-generation-model", json={}).status_code, 409)
        self.assertEqual(self.stable(), before)
        self.req("DELETE", "/api/entities/" + duplicate["id"])
        # Archived duplicate IDs also require review rather than implicit merge.
        before = self.stable()
        self.assertEqual(self.client.post("/api/workspace/upgrade-generation-model", json={}).status_code, 409)
        self.assertEqual(self.stable(), before)
        self.assertEqual(self.row("entities", old["id"])["data"]["generation_id"], "generation-universe")
        with TestClient(create_app(str(Path(self.folder.name) / "mixed.sqlite3"))) as other:
            chera = other.post("/api/entities", json={"kind": "title", "name": "체라", "data": {"generation_id": "generation-universe", "catalog_key": "title:2:체라"}}).json()
            title = other.post("/api/entities", json={"kind": "title", "name": "[TEST] another Universe title", "data": {"generation_id": "generation-universe"}}).json()
            response = other.post("/api/entities", json={"kind": "setting", "name": "[TEST] ambiguous context", "data": {"title_ids": [chera["id"], title["id"]], "generation_id": "generation-universe"}})
            self.assertEqual(response.status_code, 200, response.text)
            baseline = other.get("/api/state").json()
            self.assertEqual(other.post("/api/workspace/upgrade-generation-model", json={}).status_code, 409)
            after = other.get("/api/state").json()
            for table in ("entities", "relations", "documents", "versions"):
                self.assertEqual(after[table], baseline[table])

    def test_generation_profiles_detach_restore_independently_and_revisions_guard_writes(self):
        self.req("POST", "/api/workspace/upgrade-generation-model", {})
        organization = self.entity("organization", "first affiliation")
        group = self.req("POST", "/api/groups", {"name": "[TEST] second affiliation"})
        result = self.req("POST", "/api/characters", {"name": "", "data": {"ideology": "", "primary_power": "", "character_narrative": "", "mbti": {"ei": None, "sn": 50, "tf": 70, "jp": None}}, "generation_ids": ["generation-earth", "generation-universe"], "generation_settings": {
            "generation-earth": {"affiliations": [{"collection": "entities", "id": organization["id"]}], "ideology_rank": "[TEST] free grade", "narrative": "[TEST] Earth narrative"},
            "generation-universe": {"affiliations": [{"collection": "groups", "id": group["id"]}], "narrative": "[TEST] Universe narrative"},
        }})
        character = result["character"]
        self.assertEqual(character["name"], "이름 미정")
        self.assertIsNone(character["data"]["mbti"]["ei"])
        slots = {r["target_id"]: r for r in result["generation_appearances"]}
        revisions = {r["id"]: r["revision"] for r in slots.values()}
        path = "/api/characters/" + character["id"]
        before = self.stable()
        denied = self.client.post(path + "/generations", json={"revision": character["revision"], "generation_ids": ["generation-earth"], "generation_revisions": revisions})
        self.assertEqual(denied.status_code, 409)
        self.assertEqual(self.stable(), before)
        detached = self.req("POST", path + "/generations", {"revision": character["revision"], "generation_ids": ["generation-earth"], "generation_revisions": revisions, "confirm_detach": True})
        archived = self.row("relations", slots["generation-universe"]["id"])
        self.assertTrue(archived["deleted_at"])
        self.assertEqual(archived["data"]["narrative"], "[TEST] Universe narrative")
        earth = self.req("PATCH", path + "/generation-settings/generation-earth", {"revision": slots["generation-earth"]["revision"], "narrative": "[TEST] revised Earth only"})
        stale = self.client.patch(path + "/generation-settings/generation-earth", json={"revision": 1, "narrative": "stale"})
        self.assertEqual(stale.status_code, 409)
        restore = self.req("POST", path + "/generations", {"revision": detached["character"]["revision"], "generation_ids": ["generation-earth", "generation-universe"], "generation_revisions": {r["id"]: r["revision"] for r in (earth, archived)}})
        self.assertEqual(restore["restored"][0]["id"], archived["id"])
        self.assertEqual(restore["restored"][0]["data"]["narrative"], "[TEST] Universe narrative")
        self.assertEqual(self.row("relations", earth["id"])["data"]["narrative"], "[TEST] revised Earth only")
        common = self.row("entities", character["id"])
        self.req("PATCH", "/api/entities/" + common["id"], {"revision": common["revision"], "data": {**common["data"], "ideology": "[TEST] shared belief"}})
        self.assertEqual(self.row("relations", earth["id"]), earth)

    def test_common_mbti_validation_and_invalid_generation_creation_are_atomic(self):
        self.req("POST", "/api/workspace/upgrade-generation-model", {})
        before = self.stable()
        invalid = [
            {"generation_ids": ["missing"]},
            {"generation_ids": None},
            {"generation_ids": ["generation-earth", "generation-earth"]},
            {"generation_ids": [], "generation_settings": {"generation-earth": {}}},
            {"generation_ids": ["generation-earth"], "generation_settings": {"generation-earth": {"affiliations": [{"collection": "entities", "id": "physical-universe"}]}}},
            {"generation_ids": ["generation-earth"], "generation_settings": {"generation-earth": {"narrative": 3}}},
            {"generation_ids": ["generation-earth"], "generation_settings": {"generation-earth": {"affiliations": [{"collection": [], "id": "bad"}]}}},
            {"data": {"mbti": {"ei": 101}}},
            {"data": {"mbti": {"ei": True}}},
            {"data": {"mbti": {"unknown": 20}}},
            {"data": {"primary_power": []}},
        ]
        for payload in invalid:
            with self.subTest(payload=payload):
                response = self.client.post("/api/characters", json=payload)
                self.assertIn(response.status_code, (404, 422), response.text)
                self.assertEqual(self.stable(), before)

    def test_title_story_fields_merge_per_title_and_preserve_original_description(self):
        catalog = self.req("POST", "/api/catalog/reconcile", {})
        a, b = catalog["titles"][:2]
        a = self.req("PATCH", "/api/entities/" + a["id"], {"description": "[TEST] original description", "data": {**a["data"], "synopsis": {"legacy": "[TEST] untouched"}}})
        path = "/api/titles/" + a["id"] + "/story"
        first = self.req("PATCH", path, {"revision": a["revision"], "overview": "[TEST] overview", "synopsis": {"ki": "[TEST] beginning"}})
        second = self.req("PATCH", path, {"revision": first["revision"], "synopsis": {"gyeol": "[TEST] conclusion"}})
        self.assertEqual(second["data"]["synopsis"], {"legacy": "[TEST] untouched", "ki": "[TEST] beginning", "gyeol": "[TEST] conclusion"})
        self.assertEqual(second["description"], a["description"])
        self.assertEqual(self.row("entities", b["id"]), b)
        before = self.stable()
        self.assertEqual(self.client.patch(path, json={"revision": first["revision"], "synopsis": {"ki": "stale"}}).status_code, 409)
        self.assertEqual(self.stable(), before)
        self.assertTrue(any(r["target_id"] == a["id"] for r in before["versions"]))
        legacy = self.req("PATCH", "/api/entities/" + b["id"], {"data": {**b["data"], "synopsis": "[TEST] legacy free-form synopsis", "synopsis_legacy": "[TEST] existing extension"}})
        adapted = self.req("PATCH", "/api/titles/" + b["id"] + "/story", {"revision": legacy["revision"], "synopsis": {"jeon": "[TEST] independent turn"}})
        self.assertEqual(adapted["data"]["synopsis"], {"jeon": "[TEST] independent turn"})
        self.assertEqual(adapted["data"]["synopsis_legacy"], "[TEST] existing extension")
        self.assertTrue(any(r["target_id"] == b["id"] and r["snapshot"]["data"].get("synopsis") == legacy["data"]["synopsis"] for r in self.state()["versions"]))

    def test_affiliation_references_follow_merge_and_keep_original_revision_history(self):
        self.req("POST", "/api/workspace/upgrade-generation-model", {})
        source = self.entity("organization", "source")
        target = self.entity("organization", "target")
        result = self.req("POST", "/api/characters", {"generation_ids": ["generation-earth"], "generation_settings": {"generation-earth": {"affiliations": [{"collection": "entities", "id": source["id"]}, {"collection": "entities", "id": target["id"]}]}}})
        identity = result["character"]
        self.req("PATCH", "/api/entities/" + identity["id"], {"data": {**identity["data"], "unrelated_json": {"collection": [], "id": source["id"]}}})
        relation = result["generation_appearances"][0]
        impact = self.req("GET", "/api/entities/" + source["id"] + "/impact")
        self.assertTrue(any(ref["record"]["id"] == relation["id"] for ref in impact["references"]))
        self.req("POST", "/api/entities/" + target["id"] + "/merge", {"source_id": source["id"], "field_choices": {"name": "target"}})
        current = self.row("relations", relation["id"])
        self.assertEqual(current["data"]["affiliations"], [{"collection": "entities", "id": target["id"]}])
        self.assertEqual(self.row("entities", identity["id"])["data"]["unrelated_json"], {"collection": [], "id": source["id"]})
        self.assertTrue(any(r["target_id"] == relation["id"] and r["snapshot"]["data"]["affiliations"] == relation["data"]["affiliations"] for r in self.state()["versions"]))

    def test_generation_only_character_states_and_affiliations_share_one_timeline(self):
        self.req("POST", "/api/workspace/upgrade-generation-model", {})
        organization = self.entity("organization", "generation organization")
        character = self.req("POST", "/api/characters", {"generation_ids": ["generation-earth"], "generation_settings": {"generation-earth": {"affiliations": [{"collection": "entities", "id": organization["id"]}]}}})["character"]
        state = self.req("POST", "/api/states", {"entity_id": character["id"], "attribute": "상태", "value": "[TEST] temporal", "start": {"mode": "absolute", "year": 0}})
        earth = self.req("GET", "/api/timeline?generation_id=generation-earth&include_common=0&year=1")
        universe = self.req("GET", "/api/timeline?generation_id=generation-universe&include_common=0&year=1")
        self.assertIn(state["id"], [r["id"] for r in earth["effective_states"]])
        self.assertNotIn(state["id"], [r["id"] for r in universe["effective_states"]])
        self.assertEqual(generation_ids_for_entity(self.state(), organization), {"generation-earth"})
        self.assertEqual(len([r for r in self.state()["states"] if r["id"] == state["id"]]), 1)

    def test_browser_spatial_mutations_are_denied_without_blocking_character_references_or_work(self):
        browser = {"origin": "http://testserver", "sec-fetch-site": "same-origin"}
        before = self.stable()
        denied = self.client.post("/api/entities", json={"kind": "planet", "name": "[TEST] browser planet"}, headers=browser)
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(self.stable(), before)
        planet = self.entity("planet", "Work planet")
        character = self.req("POST", "/api/characters", {"data": {"origin_planet_id": planet["id"]}}, headers=browser)["character"]
        self.assertEqual(character["data"]["origin_planet_id"], planet["id"])
        self.assertEqual(self.client.delete("/api/entities/" + planet["id"], headers={"oai-authenticated-user-id": "owner"}).status_code, 403)
        saved = self.req("PATCH", "/api/entities/" + planet["id"], {"description": "[TEST] Work edit"})
        self.assertEqual(saved["description"], "[TEST] Work edit")
        backup = self.req("GET", "/api/backup")
        for row in backup["entities"]:
            if row["id"] == planet["id"]:
                row["description"] = "[TEST] forbidden restore mutation"
        files_before = set((self.path.parent / "backups").glob("*"))
        denied = self.client.post("/api/backup/restore", json={"backup": backup, "mode": "replace", "confirm": "REPLACE"}, headers=browser)
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(set((self.path.parent / "backups").glob("*")), files_before)
        self.assertEqual(self.row("entities", planet["id"]), saved)

    def test_spatial_states_and_spatial_edges_are_protected_but_event_references_are_not(self):
        planet = self.entity("planet", "Work planet")
        galaxy = self.entity("space", "Work galaxy", {"subtype": "galaxy"})
        browser = {"oai-authenticated-user-id": "owner"}
        before = self.stable()
        response = self.client.post("/api/states", json={"entity_id": planet["id"], "attribute": "위치", "value": "[TEST] move"}, headers=browser)
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/relations", json={"source_id": planet["id"], "target_id": galaxy["id"], "type": "passage"}, headers=browser)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.stable(), before)
        event = self.entity("event", "event")
        linked = self.req("POST", "/api/relations", {"source_id": event["id"], "target_id": planet["id"], "type": "located_at"}, headers=browser)
        self.assertEqual(linked["target_id"], planet["id"])


if __name__ == "__main__":
    unittest.main()
