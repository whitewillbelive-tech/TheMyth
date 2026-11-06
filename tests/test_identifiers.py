"""Imported identifiers cannot introduce HTML into browser attributes."""
import copy
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from myth.app import create_app


class IdentifierSafetyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="myth-identifiers-")
        self.client = TestClient(create_app(Path(self.directory.name) / "test.sqlite3"))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.directory.cleanup()

    def test_create_rejects_html_or_path_identifiers(self):
        for value in ('x" autofocus onfocus="alert(1)', "<script>", "../outside", "with space", "a" * 201):
            with self.subTest(identifier=value):
                response = self.client.post("/api/entities", json={"id": value, "kind": "custom", "name": "[TEST] unsafe id"})
                self.assertEqual(response.status_code, 422)
        response = self.client.post("/api/entities", json={"id": "safe-ID_1.2:3", "kind": "custom", "name": "[TEST] safe id"})
        self.assertEqual(response.status_code, 200, response.text)

    def test_backup_rejects_unsafe_entity_and_version_ids_atomically(self):
        record = self.client.post("/api/entities", json={"kind": "custom", "name": "[TEST] before"}).json()
        self.client.patch(f"/api/entities/{record['id']}", json={"name": "[TEST] after"})
        original = self.client.get("/api/backup").json()
        for collection in ("entities", "versions"):
            with self.subTest(collection=collection):
                forged = copy.deepcopy(original)
                forged[collection][0]["id"] = 'malicious" onclick="alert(1)'
                response = self.client.post("/api/backup/restore", json={"backup": forged, "mode": "replace", "confirm": "REPLACE"})
                self.assertEqual(response.status_code, 422, response.text)
                restored = self.client.get("/api/backup").json()
                for table in ("entities", "relations", "groups", "memberships", "states", "documents", "chapters", "versions"):
                    self.assertEqual(restored[table], original[table])


if __name__ == "__main__":
    unittest.main()
