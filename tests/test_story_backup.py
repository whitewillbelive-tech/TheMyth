"""Local backup compatibility for hosted story profiles and identity links.

All scenarios use temporary SQLite databases; no operating data is opened.
"""
import copy
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from myth.main_workspace import matches_title_scope
from myth.store import COLLECTIONS, Store, timeline


class StoryBackupTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="myth-story-backup-")
        self.path = Path(self.folder.name) / "source.sqlite3"
        self.store = Store(self.path)

    def tearDown(self):
        self.folder.cleanup()

    def stable(self, store=None):
        state = (store or self.store).state()
        return {key: state[key] for key in COLLECTIONS}

    def create_scenario(self):
        with self.store.transaction() as db:
            work = self.store.create(db, "documents", {
                "kind": "story", "name": "시간", "body": "기존 원고",
                "data": {"provisional_title": True, "generation_id": None},
            })
            local = self.store.create(db, "entities", {
                "kind": "character", "name": "나이트",
                "data": {"english_name": "Knight", "generation_model_version": 1},
            })
            common = self.store.create(db, "entities", {
                "kind": "character", "name": "본편의 같은 인물",
                "data": {"english_name": "Original", "generation_model_version": 1},
            })
            other = self.store.create(db, "entities", {
                "kind": "character", "name": "나이트",
                "data": {"english_name": "Night", "generation_model_version": 1},
            })
            event = self.store.create(db, "entities", {
                "kind": "event", "name": "외전의 사건",
                "data": {"work_id": work["id"], "time": {"mode": "unknown"}},
            })
            honor = self.store.create(db, "entities", {
                "kind": "custom", "name": "K", "data": {
                    "classification": "honor", "honor_letter": "K", "work_id": work["id"],
                },
            })
            appearance = self.store.create(db, "relations", {
                "source_id": local["id"], "target_id": work["id"], "type": "work_appearance",
                "data": {"profile_schema": 1, "overrides": {
                    "occupation": "검술 계승자", "condition": "당시 상태 미정",
                    "aliases": [], "time": {"mode": "unknown"},
                }, "inherit_fields": ["name", "english_name"],
                    "override_notes": {"occupation": "해당 작품의 직역"}},
            })
            identity = self.store.create(db, "relations", {
                "source_id": local["id"], "target_id": common["id"], "type": "identity_link",
                "data": {"work_id": work["id"]},
            })
            participation = self.store.create(db, "relations", {
                "source_id": local["id"], "target_id": event["id"], "type": "participates",
                "data": {"work_id": work["id"]},
            })
            assignment = self.store.create(db, "relations", {
                "source_id": local["id"], "target_id": honor["id"], "type": "honor_assignment",
                "data": {"work_id": work["id"], "time": {"mode": "unknown"}},
            })
        return locals()

    def test_linked_and_detached_profiles_roundtrip_with_original_references(self):
        scenario = self.create_scenario()
        appearance, identity = scenario["appearance"], scenario["identity"]
        with self.store.transaction() as db:
            self.store.update(db, "relations", appearance["id"], {
                "revision": appearance["revision"], "data": {
                    **appearance["data"], "overrides": {
                        **appearance["data"]["overrides"], "condition": "외전에서만 수정한 상태",
                    },
                },
            })
        linked = self.store.backup()
        restored = Store(Path(self.folder.name) / "linked.sqlite3")
        restored.import_backup(linked, "replace", "REPLACE")
        self.assertEqual(self.stable(restored), self.stable())
        with self.store.transaction() as db:
            self.store.delete(db, "relations", identity["id"])
        detached = self.store.backup()
        restored.import_backup(detached, "replace", "REPLACE")
        reopened = Store(Path(self.folder.name) / "linked.sqlite3")
        self.assertEqual(self.stable(reopened), self.stable())
        self.assertTrue(self.store.state()["versions"], "pre-change history must be exported")
        with reopened.connect() as db:
            self.assertTrue(reopened.get(db, "relations", identity["id"])["deleted_at"])
            self.assertEqual(reopened.get(db, "relations", scenario["participation"]["id"])["source_id"], scenario["local"]["id"])
            self.assertEqual(reopened.get(db, "relations", scenario["assignment"]["id"])["target_id"], scenario["honor"]["id"])
            self.assertEqual(reopened.get(db, "documents", scenario["work"]["id"])["body"], "기존 원고")
            self.assertNotEqual(scenario["local"]["id"], scenario["other"]["id"])
            self.assertEqual(reopened.get(db, "entities", scenario["other"]["id"])["data"]["english_name"], "Night")
        self.assertTrue(list((Path(self.folder.name) / "backups").glob("before-restore-*.json")))

    def test_work_reference_accepts_story_or_main_title_and_rejects_unrelated_records(self):
        scenario = self.create_scenario()
        with self.store.transaction() as db:
            title = self.store.create(db, "entities", {"kind": "title", "name": "본편 작품"})
            self.store.create(db, "entities", {"kind": "thought", "name": "작품 참조", "data": {"work_id": title["id"]}})
            book = self.store.create(db, "documents", {"kind": "book", "name": "기존 사상집"})
        before = self.stable()
        for value in [scenario["local"]["id"], book["id"], "missing", "", 5]:
            with self.subTest(value=value), self.assertRaises(HTTPException):
                with self.store.transaction() as db:
                    self.store.create(db, "entities", {"kind": "setting", "name": "잘못된 연결", "data": {"work_id": value}})
            self.assertEqual(self.stable(), before)

    def test_story_profile_validation_preserves_legacy_title_contract(self):
        scenario = self.create_scenario()
        with self.store.transaction() as db:
            title = self.store.create(db, "entities", {"kind": "title", "name": "기존 본편"})
            self.store.create(db, "relations", {
                "type": "appearance", "source_id": scenario["common"]["id"], "target_id": title["id"],
                "data": {"profile_schema": 1, "overrides": {"role": "본편 역할"}, "inherit_fields": []},
            })
        before = self.stable()
        invalid = [
            {"type": "appearance", "source_id": scenario["local"]["id"], "target_id": scenario["work"]["id"], "data": {"profile_schema": 1}},
            {"type": "work_appearance", "source_id": scenario["local"]["id"], "target_id": title["id"], "data": {"profile_schema": 1}},
            {"type": "work_appearance", "source_id": scenario["work"]["id"], "target_id": scenario["local"]["id"], "data": {"profile_schema": 1}},
        ]
        for data in [
            {"profile_schema": 1, "overrides": {"ability_invented": "능력"}},
            {"profile_schema": 1, "overrides": {"aliases": "잘못된 별칭"}},
            {"profile_schema": 1, "overrides": {"condition": None}},
            {"profile_schema": 1, "overrides": {"time": {"mode": "unknown", "year": 12}}},
            {"profile_schema": 1, "overrides": {"name": "이름"}, "inherit_fields": ["name"]},
            {"profile_schema": 1, "override_notes": {"name": 2}},
        ]:
            invalid.append({"type": "work_appearance", "source_id": scenario["other"]["id"], "target_id": scenario["work"]["id"], "data": data})
        for values in invalid:
            with self.subTest(values=values), self.assertRaises(HTTPException):
                with self.store.transaction() as db:
                    self.store.create(db, "relations", values)
            self.assertEqual(self.stable(), before)

    def test_malformed_story_backup_rolls_back_without_losing_existing_records(self):
        scenario = self.create_scenario()
        before = self.stable()
        malformed = copy.deepcopy(self.store.backup())
        record = next(row for row in malformed["relations"] if row["id"] == scenario["identity"]["id"])
        record["data"]["work_id"] = scenario["local"]["id"]
        with self.assertRaises(HTTPException):
            self.store.import_backup(malformed, "replace", "REPLACE")
        self.assertEqual(self.stable(), before)

    def test_side_story_records_do_not_leak_into_main_common_material(self):
        scenario = self.create_scenario()
        state = self.store.state()
        for item in (scenario["local"], scenario["event"], scenario["honor"]):
            self.assertFalse(matches_title_scope(state, item, generation_id="generation-earth", include_common=True))
            self.assertFalse(matches_title_scope(state, item, title_id="title-earth-1", include_common=True))
            self.assertTrue(matches_title_scope(state, item), "global archive must retain side-story records")
        scoped = timeline(state, generation_id="generation-earth", include_common=True)
        self.assertNotIn(scenario["event"]["id"], [row["id"] for row in scoped["events"]])
        with self.store.transaction() as db:
            self.store.create(db, "relations", {
                "type": "appearance", "source_id": scenario["local"]["id"], "target_id": "title-earth-1",
            })
            self.store.create(db, "relations", {
                "type": "generation_appearance", "source_id": scenario["local"]["id"], "target_id": "generation-earth",
                "data": {"generation_schema": 1, "affiliations": [], "ideology_rank": "", "narrative": ""},
            })
            self.store.create(db, "relations", {
                "type": "generation_appearance", "source_id": scenario["common"]["id"], "target_id": "generation-earth",
                "data": {"generation_schema": 1, "affiliations": [], "ideology_rank": "", "narrative": ""},
            })
            story_relation = self.store.create(db, "relations", {
                "type": "related", "source_id": scenario["local"]["id"], "target_id": scenario["common"]["id"],
                "start": {"mode": "absolute", "year": 0}, "data": {"work_id": scenario["work"]["id"]},
            })
            story_setting = self.store.create(db, "entities", {
                "kind": "setting", "name": "외전에만 속한 규칙",
                "data": {"work_id": scenario["work"]["id"]},
            })
            self.store.create(db, "relations", {
                "type": "related", "source_id": story_setting["id"], "target_id": "title-earth-1",
            })
        state = self.store.state()
        self.assertTrue(matches_title_scope(state, scenario["local"], generation_id="generation-earth"))
        self.assertTrue(matches_title_scope(state, scenario["common"], generation_id="generation-earth"))
        self.assertNotIn(story_relation["id"], [row["id"] for row in timeline(state, year=0, generation_id="generation-earth")["effective_relations"]])
        self.assertIn(story_relation["id"], [row["id"] for row in timeline(state, year=0)["effective_relations"]])
        self.assertFalse(matches_title_scope(state, story_setting, generation_id="generation-earth"))
        self.assertFalse(matches_title_scope(state, story_setting, title_id="title-earth-1"))


if __name__ == "__main__":
    unittest.main()
