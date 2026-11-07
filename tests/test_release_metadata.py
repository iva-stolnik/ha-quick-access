"""Verify the optional metadata setup doesn't invent maintainer details."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ReleaseMetadataTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "scripts").mkdir()
        (self.root / "custom_components/quick_access").mkdir(parents=True)
        shutil.copy(ROOT / "scripts/configure_repository.py", self.root / "scripts/configure_repository.py")
        self.manifest = self.root / "custom_components/quick_access/manifest.json"
        shutil.copy(ROOT / "custom_components/quick_access/manifest.json", self.manifest)

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(self.root / "scripts/configure_repository.py"), *args],
                              capture_output=True, text=True, check=False)

    def test_check_requires_real_metadata(self):
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        for key in ("documentation", "issue_tracker", "codeowners"):
            manifest.pop(key, None)
        self.manifest.write_text(json.dumps(manifest), encoding="utf-8")
        result = self.run_cli("--check")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("documentation", result.stderr)
        self.assertIn("issue_tracker", result.stderr)
        self.assertIn("codeowners", result.stderr)

    def test_setup_fills_real_values_preserves_version_and_orders_keys(self):
        before = json.loads(self.manifest.read_text(encoding="utf-8"))
        result = self.run_cli("ExampleOrg/real-repo", "@real-maintainer")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        self.assertEqual(manifest["documentation"], "https://github.com/ExampleOrg/real-repo")
        self.assertEqual(manifest["issue_tracker"], "https://github.com/ExampleOrg/real-repo/issues")
        self.assertEqual(manifest["codeowners"], ["@real-maintainer"])
        self.assertEqual(manifest["version"], before["version"])
        self.assertEqual(list(manifest)[:2], ["domain", "name"])
        self.assertEqual(list(manifest)[2:], sorted(list(manifest)[2:]))
        self.assertEqual(self.run_cli("--check").returncode, 0)

    def test_rejects_invalid_git_repo_or_owner(self):
        original = self.manifest.read_text(encoding="utf-8")
        self.assertNotEqual(self.run_cli("../bad", "@valid").returncode, 0)
        self.assertNotEqual(self.run_cli("valid/repo", "@@invalid").returncode, 0)
        self.assertEqual(self.manifest.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
