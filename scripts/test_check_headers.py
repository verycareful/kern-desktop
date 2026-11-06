# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
"""Tests for check-headers.sh. Run: python3 -I scripts/test_check_headers.py

Each case builds a small git repository under the repo's local/ directory
(ignored by git, never the system temp directory) and runs the script on it.
"""

import os
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SCRIPT = os.path.join(HERE, "check-headers.sh")
SCRATCH = os.path.join(REPO, "local", "scratchpad-scripts")

SPDX = "SPDX-License-Identifier: AGPL-3.0-or-later"
COPY = "Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)"


def header(prefix: str = "// ", suffix: str = "") -> str:
    return f"{prefix}{SPDX}{suffix}\n{prefix}{COPY}{suffix}\n"


def run(root: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    # Keep git from finding the enclosing repository when the case is a plain directory.
    env["GIT_CEILING_DIRECTORIES"] = SCRATCH
    return subprocess.run(
        ["bash", SCRIPT, root], capture_output=True, text=True, env=env, check=False
    )


class CheckHeaders(unittest.TestCase):
    def setUp(self) -> None:
        os.makedirs(SCRATCH, exist_ok=True)
        self._tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self._tmp.cleanup)
        self.root = self._tmp.name

    def write(self, name: str, text: str) -> None:
        path = os.path.join(self.root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    def git_init(self) -> None:
        subprocess.run(["git", "init", "-q", self.root], check=True)

    def expect_fail(self, name: str) -> str:
        r = run(self.root)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn(name, r.stderr)
        return r.stderr

    def test_all_headers_present_passes(self) -> None:
        self.git_init()
        self.write("a.ts", header() + "export {};\n")
        self.write("src/b.test.tsx", header() + "test;\n")
        self.write("s.css", header("/* ", " */") + "a{}\n")
        self.write("run.sh", "#!/usr/bin/env bash\n" + header("# "))
        self.write(".gitignore", header("# ") + "dist\n")
        self.write("icon.svg", '<?xml version="1.0"?>\n' + header("<!-- ", " -->") + "<svg/>\n")
        self.write("k.desktop", header("# ") + "[Desktop Entry]\n")
        r = run(self.root)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("ok", r.stdout)

    def test_missing_spdx_line(self) -> None:
        self.git_init()
        self.write("a.ts", f"// {COPY}\nexport {{}};\n")
        self.assertIn(SPDX, self.expect_fail("a.ts"))

    def test_missing_copyright_line(self) -> None:
        self.git_init()
        self.write("a.ts", f"// {SPDX}\nexport {{}};\n")
        self.assertIn(COPY, self.expect_fail("a.ts"))

    def test_css_file_without_header(self) -> None:
        self.git_init()
        self.write("ok.ts", header())
        self.write("style.css", "a { color: red; }\n")
        self.expect_fail("style.css")

    def test_test_file_without_header(self) -> None:
        self.git_init()
        self.write("src/x.test.ts", "test('x', () => {});\n")
        self.expect_fail("src/x.test.ts")

    def test_other_kinds_without_header(self) -> None:
        # Every kind the script claims to check, as check-headers.sh lists them.
        extensions = (
            "ts tsx js jsx mjs cjs mts cts rs css html svg xml sh py yml yaml toml desktop"
        ).split()
        names = [f"a.{ext}" for ext in extensions]
        names += [".gitignore", ".prettierignore", "sub/.gitignore", "sub/.prettierignore"]
        for name in names:
            with self.subTest(name=name):
                case_dir = tempfile.TemporaryDirectory(dir=SCRATCH)
                self.addCleanup(case_dir.cleanup)
                self.root = case_dir.name
                self.git_init()
                self.write(name, "x\n")
                self.expect_fail(name)

    def test_non_ascii_name_is_checked(self) -> None:
        self.git_init()
        self.write("ok.ts", header())
        self.write("src/ä.ts", "export {};\n")
        self.expect_fail("src/ä.ts")

    def test_non_ascii_name_with_header_passes(self) -> None:
        self.git_init()
        self.write("src/ä.ts", header())
        self.assertEqual(run(self.root).returncode, 0)

    def test_not_a_git_work_tree_fails(self) -> None:
        self.write("a.ts", header())
        r = run(self.root)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("ok", r.stdout)

    def test_zero_checked_files_fails(self) -> None:
        self.git_init()
        self.write("README.md", "# readme\n")
        self.write("data.json", "{}\n")
        r = run(self.root)
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertNotIn("ok", r.stdout)

    def test_ignored_files_are_not_checked(self) -> None:
        self.git_init()
        self.write(".gitignore", header("# ") + "skip.ts\n")
        self.write("skip.ts", "no header\n")
        self.write("a.ts", header())
        self.assertEqual(run(self.root).returncode, 0)


if __name__ == "__main__":
    unittest.main()
