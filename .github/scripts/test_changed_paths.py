import contextlib
import io
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


class ChangedPathsTests(unittest.TestCase):
    def evaluate(self, paths, base="1" * 40, object_exists=True):
        with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as directory:
            output = Path(directory) / "outputs"
            with patch.dict(os.environ, {"BASE_SHA": base, "GITHUB_OUTPUT": str(output)}), patch(
                "subprocess.run", return_value=Mock(returncode=0 if object_exists else 1)
            ), patch("subprocess.check_output", return_value=("\0".join(paths) + "\0").encode("utf-8")), contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(Path(__file__).with_name("changed-paths.py")))
            return [line.split("=")[0] for line in output.read_text().splitlines() if line.endswith("=true")]

    def test_component_and_dependency_paths(self):
        cases = [
            (["docs/example.md"], []),
            (["study-log-web/app/stats.css"], ["web"]),
            (["study-log-web/lib/rag-answer.ts"], ["web", "harmony", "ops"]),
            (["study-log-mcp/src/http-server.mjs"], ["web", "mcp"]),
            (["study-log-harmony/entry/example.ets"], ["harmony"]),
            (["ops/electron/updates.mjs"], ["ops"]),
            ([".github/workflows/ci.yml"], ["web", "mcp", "harmony", "ops"]),
        ]
        for paths, expected in cases:
            with self.subTest(paths=paths):
                self.assertEqual(self.evaluate(paths), expected)

    def test_new_or_unavailable_base_runs_every_component(self):
        all_jobs = ["web", "mcp", "harmony", "ops"]
        self.assertEqual(self.evaluate([], base="0" * 40), all_jobs)
        self.assertEqual(self.evaluate([], base=""), all_jobs)
        self.assertEqual(self.evaluate([], object_exists=False), all_jobs)

    def test_real_git_quoted_unicode_paths(self):
        script = Path(__file__).with_name("changed-paths.py").resolve()
        with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root).decode("utf-8").strip()
            git("init", "-q")
            git("config", "user.name", "CI fixture")
            git("config", "user.email", "ci@example.invalid")
            git("config", "core.quotepath", "true")
            (root / "README.md").write_text("fixture", encoding="utf-8")
            git("add", ".")
            git("commit", "-qm", "fixture baseline")
            base = git("rev-parse", "HEAD")
            path = root / "study-log-web/components/合成组件.tsx"
            path.parent.mkdir(parents=True)
            path.write_text("export {};", encoding="utf-8")
            git("add", ".")
            git("commit", "-qm", "fixture unicode path")
            output = root / "outputs"
            result = subprocess.run([sys.executable, str(script)], cwd=root,
                env={**os.environ, "BASE_SHA": base, "GITHUB_OUTPUT": str(output)},
                capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8"))
            self.assertEqual(output.read_text().splitlines(), ["web=true", "mcp=false", "harmony=false", "ops=false"])
            self.assertIn("合成组件.tsx", result.stdout.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
