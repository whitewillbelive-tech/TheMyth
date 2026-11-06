"""Integration scenarios for The Myth's shared archive and writing workflow.

Run: python -m unittest discover -s tests -v
Each test builds a separate temporary database; no user database is opened.
"""

import copy
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from myth.app import create_app


def absolute(year):
    return {"mode": "absolute", "year": year}


class WorkstationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="myth-test-")
        self.db_path = Path(self.directory.name) / "test.sqlite3"
        self.client = TestClient(create_app(db_path=str(self.db_path)))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def request(self, method, path, payload=None):
        response = self.client.request(method, path, json=payload)
        self.assertLess(response.status_code, 300, f"{method} {path}: {response.status_code} {response.text}")
        return response.json()

    def create(self, collection, **fields):
        return self.request("POST", f"/api/{collection}", fields)

    def entity(self, kind, name, **data):
        return self.create("entities", kind=kind, name="[TEST] " + name, data=data)

    def state(self):
        return self.request("GET", "/api/state")

    def record(self, collection, record_id):
        return next(row for row in self.state()[collection] if row["id"] == record_id)

    def relation(self, source, target, relation_type, **fields):
        return self.create("relations", source_id=source["id"], target_id=target["id"], type=relation_type, **fields)

    def test_initial_data_has_only_confirmed_structure(self):
        state = self.state()
        entities = state["entities"]
        generations = [row for row in entities if row["kind"] == "generation"]
        self.assertEqual(len(generations), 3)
        self.assertTrue(any("Earth" in row["name"] for row in generations))
        self.assertTrue(any("Universe" in row["name"] for row in generations))
        self.assertFalse(any(row["kind"] in {"character", "event", "planet", "thinker"} for row in entities))
        self.assertFalse(state["documents"])
        self.assertFalse(state["relations"])
        self.assertTrue(self.request("GET", "/api/health"))

    def test_global_character_shared_roles_and_membership_history(self):
        planet = self.entity("planet", "Origin")
        character = self.entity("character", "A", origin_planet_id=planet["id"])
        title_a = self.entity("title", "Title A")
        title_b = self.entity("title", "Title B")
        org_a = self.entity("organization", "Past organization")
        org_b = self.entity("organization", "Later organization")
        first_role = self.relation(character, title_a, "appearance", data={"role": "주인공"})
        second_role = self.relation(character, title_b, "appearance", data={"role": "조연"})
        first_member = self.relation(character, org_a, "membership", start=absolute(0), end=absolute(49))
        second_member = self.relation(character, org_b, "membership", start=absolute(50), end=None)
        self.request("PATCH", f"/api/entities/{character['id']}", {"name": "[TEST] A renamed"})
        shared = [row for row in self.state()["entities"] if row["kind"] == "character"]
        self.assertEqual([row["id"] for row in shared], [character["id"]])
        self.assertEqual(shared[0]["data"]["origin_planet_id"], planet["id"])
        self.assertEqual(self.record("relations", first_role["id"])["data"]["role"], "주인공")
        self.assertEqual(self.record("relations", second_role["id"])["source_id"], character["id"])
        past = self.request("GET", "/api/timeline?year=25")
        later = self.request("GET", "/api/timeline?year=75")
        self.assertIn(first_member["id"], [row["id"] for row in past["effective_relations"]])
        self.assertNotIn(second_member["id"], [row["id"] for row in past["effective_relations"]])
        self.assertIn(second_member["id"], [row["id"] for row in later["effective_relations"]])
        self.assertNotIn(first_member["id"], [row["id"] for row in later["effective_relations"]])
        for title in (title_a, title_b):
            selected = self.request("GET", f"/api/timeline?year=75&title_id={title['id']}")
            self.assertIn(second_member["id"], [row["id"] for row in selected["effective_relations"]])

    def test_unknown_relative_time_and_overlapping_titles_have_no_fake_dates(self):
        first = self.entity("event", "Unknown first", time={"mode": "unknown"}, sort_hint="first")
        second = self.entity("event", "After first", time={"mode": "after", "event_id": first["id"]})
        self.relation(first, second, "before")
        self.request("PATCH", f"/api/entities/{first['id']}", {"sort_order": 20})
        self.request("PATCH", f"/api/entities/{second['id']}", {"sort_order": 30})
        title_a = self.entity("title", "Overlap A", time={"mode": "range", "start": 10, "end": 60})
        title_b = self.entity("title", "Overlap B", time={"mode": "range", "start": 40, "end": 100})
        timeline = self.request("GET", "/api/timeline?year=50")
        title_ids = [row["id"] for row in timeline["titles"]]
        self.assertIn(title_a["id"], title_ids)
        self.assertIn(title_b["id"], title_ids)
        unknown = self.record("entities", first["id"])["data"]["time"]
        relative = self.record("entities", second["id"])["data"]["time"]
        self.assertIsNone(unknown.get("year"))
        self.assertIsNone(relative.get("year"))
        self.assertEqual(relative["event_id"], first["id"])
        event_ids = [row["id"] for row in timeline["events"]]
        self.assertLess(event_ids.index(first["id"]), event_ids.index(second["id"]))

    def test_exclusive_state_conflicts_are_reported_without_deleting_history(self):
        character = self.entity("character", "Conflicted character")
        a = self.create("states", entity_id=character["id"], attribute="생존 상태", value="생존", start=absolute(0), end=absolute(100), data={"exclusive": True})
        b = self.create("states", entity_id=character["id"], attribute="생존 상태", value="사망", start=absolute(50), end=absolute(150), data={"exclusive": True})
        unknown = self.create("states", entity_id=character["id"], attribute="활동지", value="미정", start={"mode": "unknown"})
        timeline = self.request("GET", "/api/timeline?year=75")
        self.assertTrue(timeline["conflicts"])
        self.assertIn(a["id"], [row["id"] for row in timeline["effective_states"]])
        self.assertIn(b["id"], [row["id"] for row in timeline["effective_states"]])
        self.assertFalse(self.record("states", a["id"]).get("deleted_at"))
        self.assertFalse(self.record("states", b["id"]).get("deleted_at"))
        self.assertIsNone(self.record("states", unknown["id"])["start"].get("year"))

    def test_spatial_identity_and_historical_governance_remain_separate(self):
        galaxy = self.entity("space", "Galaxy", subtype="은하")
        planet_a = self.entity("planet", "Planet A", parent_id=galaxy["id"], environment="[TEST] environment")
        planet_b = self.entity("planet", "Planet B", parent_id=galaxy["id"])
        civ_a = self.entity("civilization", "Civilization A")
        civ_b = self.entity("civilization", "Civilization B")
        master = self.relation(civ_a, galaxy, "galaxy_master", start={"mode": "unknown"}, data={"role": "조율", "institution": ""})
        past = self.relation(civ_a, planet_a, "governs", start=absolute(0), end=absolute(49))
        later = self.relation(civ_b, planet_a, "governs", start=absolute(50))
        current = self.request("GET", "/api/timeline?year=70")
        effective = [row["id"] for row in current["effective_relations"]]
        self.assertIn(later["id"], effective)
        self.assertNotIn(past["id"], effective)
        self.assertEqual(self.record("entities", planet_a["id"])["data"]["parent_id"], galaxy["id"])
        self.assertEqual(self.record("entities", planet_b["id"])["data"]["parent_id"], galaxy["id"])
        self.assertEqual(self.record("entities", planet_a["id"])["data"]["environment"], "[TEST] environment")
        self.assertIsNone(self.record("relations", master["id"])["start"].get("year"))
        self.assertFalse(self.record("relations", past["id"]).get("deleted_at"))

    def test_multiple_groups_removal_and_soft_delete_do_not_cascade(self):
        obj = self.entity("character", "Grouped character")
        other = self.entity("event", "Related event")
        relation = self.relation(obj, other, "participates")
        group_a = self.create("groups", name="[TEST] Parent")
        group_b = self.create("groups", name="[TEST] Child", parent_id=group_a["id"])
        a = self.create("memberships", group_id=group_a["id"], entity_id=obj["id"])
        b = self.create("memberships", group_id=group_b["id"], entity_id=obj["id"])
        self.request("DELETE", f"/api/memberships/{a['id']}")
        self.assertFalse(self.record("entities", obj["id"]).get("deleted_at"))
        self.assertIn(b["id"], [row["id"] for row in self.state()["memberships"]])
        impact = self.request("GET", f"/api/entities/{obj['id']}/impact")
        self.assertIn(relation["id"], str(impact))
        self.request("DELETE", f"/api/entities/{obj['id']}")
        self.assertTrue(self.record("entities", obj["id"])["deleted_at"])
        self.assertFalse(self.record("entities", other["id"]).get("deleted_at"))
        self.assertFalse(self.record("relations", relation["id"]).get("deleted_at"))
        self.request("POST", f"/api/entities/{obj['id']}/restore", {})
        self.assertFalse(self.record("entities", obj["id"]).get("deleted_at"))
        self.assertEqual(self.record("relations", relation["id"])["source_id"], obj["id"])

    def test_hierarchy_cycles_and_dangling_references_are_rejected(self):
        a = self.entity("space", "Space A")
        b = self.entity("space", "Space B", parent_id=a["id"])
        response = self.client.patch(f"/api/entities/{a['id']}", json={"data": {"parent_id": b["id"]}})
        self.assertGreaterEqual(response.status_code, 400)
        group_a = self.create("groups", name="[TEST] Group A")
        group_b = self.create("groups", name="[TEST] Group B", parent_id=group_a["id"])
        response = self.client.patch(f"/api/groups/{group_a['id']}", json={"parent_id": group_b["id"]})
        self.assertGreaterEqual(response.status_code, 400)
        response = self.client.post("/api/relations", json={"source_id": a["id"], "target_id": "nonexistent", "type": "references"})
        self.assertGreaterEqual(response.status_code, 400)
        response = self.client.post("/api/entities", json={"kind": "character", "name": "[TEST] invalid origin", "data": {"origin_planet_id": "missing"}})
        self.assertGreaterEqual(response.status_code, 400)

    def test_revision_check_prevents_lost_updates(self):
        entity = self.entity("setting", "Revision")
        updated = self.request("PATCH", f"/api/entities/{entity['id']}", {"name": "[TEST] Updated", "revision": entity["revision"]})
        self.assertGreater(updated["revision"], entity["revision"])
        stale = self.client.patch(f"/api/entities/{entity['id']}", json={"name": "Lost update", "revision": entity["revision"]})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.record("entities", entity["id"])["name"], "[TEST] Updated")

    def test_time_validation_rejects_nonnumeric_years_without_partial_mutation(self):
        entity = self.entity("event", "Valid unknown", time={"mode": "unknown"})
        for invalid in ("unconfirmed", "", False, {"year": 12}):
            with self.subTest(invalid=invalid):
                response = self.client.patch(f"/api/entities/{entity['id']}", json={"data": {"time": {"mode": "absolute", "year": invalid}}})
                self.assertGreaterEqual(response.status_code, 400)
                stored = self.record("entities", entity["id"])
                self.assertEqual(stored["data"]["time"]["mode"], "unknown")
                self.assertIsNone(stored["data"]["time"].get("year"))
        response = self.client.post("/api/states", json={"entity_id": entity["id"], "attribute": "status", "value": "[TEST] invalid interval", "start": absolute(100), "end": absolute(10)})
        self.assertGreaterEqual(response.status_code, 400)

    def test_wrong_type_references_and_duplicate_memberships_are_rejected(self):
        character = self.entity("character", "Not a planet")
        response = self.client.post("/api/entities", json={"kind": "character", "name": "[TEST] wrong origin", "data": {"origin_planet_id": character["id"]}})
        self.assertGreaterEqual(response.status_code, 400)
        response = self.client.post("/api/documents", json={"kind": "book", "name": "[TEST] wrong author", "author_id": self.entity("planet", "Not an author")["id"]})
        self.assertGreaterEqual(response.status_code, 400)
        group = self.create("groups", name="[TEST] Unique memberships")
        self.create("memberships", group_id=group["id"], entity_id=character["id"])
        repeated = self.client.post("/api/memberships", json={"group_id": group["id"], "entity_id": character["id"]})
        self.assertGreaterEqual(repeated.status_code, 400)
        matches = [row for row in self.state()["memberships"] if row["group_id"] == group["id"] and row["entity_id"] == character["id"]]
        self.assertEqual(len(matches), 1)

    def test_failed_relation_edit_and_cross_book_chapter_parent_are_atomic(self):
        a = self.entity("character", "Reference A")
        b = self.entity("character", "Reference B")
        relation = self.relation(a, b, "knows")
        failed = self.client.patch(f"/api/relations/{relation['id']}", json={"target_id": "missing", "type": "corrupted"})
        self.assertGreaterEqual(failed.status_code, 400)
        stored = self.record("relations", relation["id"])
        self.assertEqual(stored["target_id"], b["id"])
        self.assertEqual(stored["type"], "knows")
        first = self.create("documents", kind="book", name="[TEST] First book")
        second = self.create("documents", kind="book", name="[TEST] Second book")
        chapter = self.create("chapters", document_id=first["id"], name="[TEST] First chapter")
        failed = self.client.post("/api/chapters", json={"document_id": second["id"], "parent_id": chapter["id"], "name": "[TEST] Wrong book section"})
        self.assertGreaterEqual(failed.status_code, 400)

    def test_chapter_versions_restore_body_order_and_parent(self):
        book = self.create("documents", kind="book", name="[TEST] Chapter history")
        chapter = self.create("chapters", document_id=book["id"], name="[TEST] Parent")
        section = self.create("chapters", document_id=book["id"], parent_id=chapter["id"], name="[TEST] Section", body="[TEST] original section", sort_order=2)
        self.request("PATCH", f"/api/chapters/{section['id']}", {"body": "[TEST] changed section", "sort_order": 7, "parent_id": None})
        candidates = [row for row in self.state()["versions"] if row["target_id"] == section["id"] and row["snapshot"].get("body") == "[TEST] original section"]
        self.assertTrue(candidates)
        self.request("POST", f"/api/versions/{candidates[0]['id']}/restore", {})
        restored = self.record("chapters", section["id"])
        self.assertEqual(restored["body"], "[TEST] original section")
        self.assertEqual(restored["parent_id"], chapter["id"])
        self.assertEqual(restored["document_id"], book["id"])
        self.assertEqual(restored["sort_order"], 2)

    def test_split_retains_original_and_copies_only_selected_fields_and_relations(self):
        source = self.entity("setting", "Composite", principle="[TEST] principle", conditions="[TEST] conditions")
        target = self.entity("planet", "Related planet")
        relation = self.relation(source, target, "origin")
        result = self.request("POST", f"/api/entities/{source['id']}/split", {"name": "[TEST] Split", "fields": ["principle"], "relation_ids": [relation["id"]]})
        records = [row for row in self.state()["entities"] if row["name"] == "[TEST] Split"]
        self.assertEqual(len(records), 1, str(result))
        split = records[0]
        self.assertNotEqual(split["id"], source["id"])
        self.assertEqual(split["data"]["principle"], "[TEST] principle")
        self.assertNotIn("conditions", split["data"])
        self.assertEqual(self.record("entities", source["id"])["data"]["conditions"], "[TEST] conditions")
        self.assertFalse(self.record("relations", relation["id"]).get("deleted_at"))
        self.assertTrue(any(row["source_id"] == split["id"] and row["target_id"] == target["id"] for row in self.state()["relations"]))

    def test_merge_redirects_references_and_preserves_source_history(self):
        destination = self.entity("character", "Canonical", aliases="[TEST] canonical alias")
        source = self.entity("character", "Duplicate", aliases="[TEST] alternate alias")
        title = self.entity("title", "Shared title")
        rel = self.relation(source, title, "appearance", data={"role": "[TEST] role"})
        state = self.create("states", entity_id=source["id"], attribute="가치관", value="[TEST] conviction", start={"mode": "unknown"})
        group = self.create("groups", name="[TEST] Merge group")
        self.create("memberships", group_id=group["id"], entity_id=source["id"])
        self.create("memberships", group_id=group["id"], entity_id=destination["id"])
        book = self.create("documents", kind="book", name="[TEST] authored book", author_id=source["id"])
        preview = self.request("GET", f"/api/entities/{destination['id']}/merge-preview?source_id={source['id']}")
        self.assertTrue(preview)
        unresolved = self.client.post(f"/api/entities/{destination['id']}/merge", json={"source_id": source["id"], "field_choices": {}})
        self.assertEqual(unresolved.status_code, 409)
        self.assertFalse(self.record("entities", source["id"]).get("deleted_at"))
        choices = {row["field"]: "target" for row in preview["conflicts"]}
        self.request("POST", f"/api/entities/{destination['id']}/merge", {"source_id": source["id"], "field_choices": choices})
        self.assertTrue(self.record("entities", source["id"])["deleted_at"])
        self.assertFalse(self.record("entities", destination["id"]).get("deleted_at"))
        self.assertEqual(self.record("relations", rel["id"])["source_id"], destination["id"])
        self.assertEqual(self.record("states", state["id"])["entity_id"], destination["id"])
        self.assertEqual(self.record("documents", book["id"])["author_id"], destination["id"])
        memberships = [row for row in self.state()["memberships"] if row["group_id"] == group["id"]]
        self.assertEqual(len(memberships), 1)
        self.assertEqual(memberships[0]["entity_id"], destination["id"])

    def test_book_chapters_philosophy_and_story_remain_separate_from_canon(self):
        author = self.entity("character", "Author", profile="[TEST] objective profile")
        thought = self.entity("thought", "Thought", thesis="[TEST] fallible claim")
        historical = self.entity("thinker", "Historical thinker", reality="historical")
        fictional = self.entity("thinker", "Fictional thinker", reality="fictional")
        book = self.create("documents", kind="book", name="[TEST] Book", author_id=author["id"], body="[TEST] opening", canon_status="draft")
        chapter_a = self.create("chapters", document_id=book["id"], name="[TEST] Chapter A", body="[TEST] alpha manuscript", sort_order=10)
        chapter_b = self.create("chapters", document_id=book["id"], name="[TEST] Chapter B", body="[TEST] beta manuscript", sort_order=20)
        self.create("chapters", document_id=book["id"], parent_id=chapter_b["id"], name="[TEST] Section B1", body="[TEST] nested section", sort_order=10)
        self.request("PATCH", f"/api/chapters/{chapter_b['id']}", {"sort_order": 0})
        self.relation(thought, book, "discussed_in")
        self.relation(historical, thought, "founded")
        self.relation(fictional, thought, "criticized")
        story = self.create("documents", kind="story", name="[TEST] Story", body="[TEST] speculative unpublished lore", canon_status="undecided")
        self.relation(story, author, "features")
        self.request("PATCH", f"/api/documents/{story['id']}", {"body": "[TEST] character claims a different origin"})
        self.assertEqual(self.record("entities", author["id"])["data"]["profile"], "[TEST] objective profile")
        exported = self.client.get(f"/api/documents/{book['id']}/export?format=md")
        self.assertEqual(exported.status_code, 200)
        self.assertIn("[TEST] nested section", exported.text)
        self.assertLess(exported.text.index("[TEST] Chapter B"), exported.text.index("[TEST] Chapter A"))
        single = self.client.get(f"/api/documents/{book['id']}/export?format=txt&chapter_id={chapter_a['id']}")
        self.assertEqual(single.status_code, 200)
        self.assertIn("[TEST] alpha manuscript", single.text)
        self.assertNotIn("[TEST] beta manuscript", single.text)
        self.assertEqual(self.record("documents", story["id"])["canon_status"], "undecided")

    def test_manuscript_versions_restore_and_survive_restart(self):
        document = self.create("documents", kind="story", name="[TEST] Versions", body="[TEST] first manuscript")
        self.request("PATCH", f"/api/documents/{document['id']}", {"body": "[TEST] second manuscript"})
        candidates = [row for row in self.state()["versions"] if row["target_id"] == document["id"] and row["snapshot"].get("body") == "[TEST] first manuscript"]
        self.assertTrue(candidates)
        self.request("POST", f"/api/versions/{candidates[0]['id']}/restore", {})
        self.assertEqual(self.record("documents", document["id"])["body"], "[TEST] first manuscript")
        self.client.__exit__(None, None, None)
        self.client = TestClient(create_app(db_path=str(self.db_path)))
        self.client.__enter__()
        self.assertEqual(self.record("documents", document["id"])["body"], "[TEST] first manuscript")
        versions = [row for row in self.state()["versions"] if row["target_id"] == document["id"]]
        self.assertTrue(any(row["snapshot"].get("body") == "[TEST] second manuscript" for row in versions))

    def test_backup_export_restore_and_conflict_protection(self):
        character = self.entity("character", "Backed up")
        document = self.create("documents", kind="story", name="[TEST] Backup manuscript", body="[TEST] preserved text")
        self.relation(document, character, "features")
        backup = self.request("GET", "/api/backup")
        restored_path = Path(self.directory.name) / "restored.sqlite3"
        with TestClient(create_app(db_path=str(restored_path))) as restored:
            response = restored.post("/api/backup/restore", json={"backup": backup, "mode": "replace", "confirm": "REPLACE"})
            self.assertLess(response.status_code, 300, response.text)
            state = restored.get("/api/state").json()
            self.assertTrue(any(row["id"] == document["id"] and row["body"] == "[TEST] preserved text" for row in state["documents"]))
            response = restored.patch(f"/api/entities/{character['id']}", json={"name": "[TEST] Keep newer user edit"})
            self.assertLess(response.status_code, 300, response.text)
            conflict = restored.post("/api/backup/restore", json={"backup": backup, "mode": "merge"})
            self.assertEqual(conflict.status_code, 409)
            current = restored.get("/api/state").json()
            self.assertTrue(any(row["id"] == character["id"] and row["name"] == "[TEST] Keep newer user edit" for row in current["entities"]))

    def test_malformed_backup_is_transactional_and_replace_requires_confirmation(self):
        self.entity("character", "Protected data")
        backup = self.request("GET", "/api/backup")
        initial = self.state()
        response = self.client.post("/api/backup/restore", json={"backup": backup, "mode": "replace"})
        self.assertGreaterEqual(response.status_code, 400)
        malformed = copy.deepcopy(backup)
        # Independently malformed payload must fail before touching persistent state.
        malformed["entities"] = [{"id": "bad", "kind": "character", "name": "[TEST] invalid", "data": {"origin_planet_id": "missing"}}]
        response = self.client.post("/api/backup/restore", json={"backup": malformed, "mode": "replace", "confirm": "REPLACE"})
        self.assertGreaterEqual(response.status_code, 400)
        after = self.state()
        self.assertEqual(initial["entities"], after["entities"])
        self.assertEqual(initial["documents"], after["documents"])

    def test_merge_archived_self_relation_backup_roundtrip(self):
        destination = self.entity("character", "Merge target")
        source = self.entity("character", "Merge source")
        relation = self.relation(source, destination, "knows")
        preview = self.request("GET", f"/api/entities/{destination['id']}/merge-preview?source_id={source['id']}")
        choices = {row["field"]: "target" for row in preview["conflicts"]}
        self.request("POST", f"/api/entities/{destination['id']}/merge", {"source_id": source["id"], "field_choices": choices})
        archived = self.record("relations", relation["id"])
        self.assertTrue(archived["deleted_at"])
        backup = self.request("GET", "/api/backup")
        with TestClient(create_app(db_path=str(Path(self.directory.name) / "merge-restored.sqlite3"))) as restored:
            response = restored.post("/api/backup/restore", json={"backup": backup, "mode": "replace", "confirm": "REPLACE"})
            self.assertLess(response.status_code, 300, response.text)
            state = restored.get("/api/state").json()
            self.assertTrue(any(row["id"] == relation["id"] and row["deleted_at"] for row in state["relations"]))
        invalid_restore = self.client.post(f"/api/relations/{relation['id']}/restore")
        self.assertGreaterEqual(invalid_restore.status_code, 400)
        self.assertTrue(self.record("relations", relation["id"])["deleted_at"])

    def test_entity_kind_cannot_change_and_break_existing_typed_references(self):
        origin = self.entity("planet", "Typed origin")
        character = self.entity("character", "Typed identity", origin_planet_id=origin["id"])
        failed = self.client.patch(f"/api/entities/{origin['id']}", json={"kind": "setting"})
        self.assertGreaterEqual(failed.status_code, 400)
        self.assertEqual(self.record("entities", origin["id"])["kind"], "planet")
        self.assertEqual(self.record("entities", character["id"])["data"]["origin_planet_id"], origin["id"])

    def test_cross_site_requests_cannot_mutate_local_archive(self):
        before = self.state()["entities"]
        payload = {"kind": "character", "name": "[TEST] hostile request"}
        for headers in ({"Origin": "https://unrelated.example"}, {"Sec-Fetch-Site": "cross-site"}):
            with self.subTest(headers=headers):
                failed = self.client.post("/api/entities", json=payload, headers=headers)
                self.assertEqual(failed.status_code, 403)
        self.assertEqual(before, self.state()["entities"])

    def test_import_rejects_version_snapshot_that_targets_an_unrelated_object(self):
        a = self.entity("character", "Version owner")
        b = self.entity("character", "Unrelated character")
        self.request("PATCH", f"/api/entities/{a['id']}", {"description": "[TEST] make history"})
        backup = self.request("GET", "/api/backup")
        version = next(row for row in backup["versions"] if row["target_id"] == a["id"])
        version["snapshot"]["id"] = b["id"]
        initial = self.state()
        response = self.client.post("/api/backup/restore", json={"backup": backup, "mode": "replace", "confirm": "REPLACE"})
        self.assertGreaterEqual(response.status_code, 400)
        after = self.state()
        self.assertEqual(initial["entities"], after["entities"])
        self.assertEqual(initial["versions"], after["versions"])

    def test_import_rejects_cross_document_chapter_in_version_snapshot(self):
        a = self.create("documents", kind="book", name="[TEST] Version book")
        b = self.create("documents", kind="book", name="[TEST] Unrelated book")
        own = self.create("chapters", document_id=a["id"], name="[TEST] Own chapter", body="[TEST] own")
        other = self.create("chapters", document_id=b["id"], name="[TEST] Protected chapter", body="[TEST] protected")
        self.request("PATCH", f"/api/documents/{a['id']}", {"description": "[TEST] make book history"})
        original = self.request("GET", "/api/backup")
        for bad_chapter in ({**own, "document_id": b["id"]}, {**other, "document_id": a["id"]}):
            with self.subTest(chapter_id=bad_chapter["id"]):
                backup = copy.deepcopy(original)
                version = next(row for row in backup["versions"] if row["target_id"] == a["id"])
                version["snapshot"]["_chapters"] = [bad_chapter]
                response = self.client.post("/api/backup/restore", json={"backup": backup, "mode": "replace", "confirm": "REPLACE"})
                self.assertGreaterEqual(response.status_code, 400)
                self.assertEqual(self.record("chapters", other["id"])["body"], "[TEST] protected")
                self.assertEqual(self.record("chapters", other["id"])["document_id"], b["id"])


if __name__ == "__main__":
    unittest.main()
