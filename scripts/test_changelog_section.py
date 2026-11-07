# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
"""Tests for changelog_section.py. Run: python3 -I scripts/test_changelog_section.py"""

import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import changelog_section  # noqa: E402

SCRIPT = os.path.join(HERE, "changelog_section.py")

THREE = (
    "# Changelog\n"
    "\n"
    "## [0.1.2.0] 2026-03-01\n"
    "\n"
    "Newest body.\n"
    "\n"
    "## [0.1.1.0] 2026-02-01\n"
    "\n"
    "### Added\n"
    "- middle one\n"
    "- middle two\n"
    "\n"
    "## [0.1.0.0] 2026-01-01\n"
    "\n"
    "Oldest body.\n"
)


# 0.1.10.0 sorts before 0.1.9.0 as text and after it as a version.
RANGE = (
    "# Changelog\n"
    "\n"
    "## [Unreleased]\n"
    "\n"
    "Not released yet.\n"
    "\n"
    "## [0.1.10.0] - 2026-04-01\n"
    "\n"
    "Tenth.\n"
    "\n"
    "## [0.1.9.0] - 2026-03-01\n"
    "\n"
    "Ninth.\n"
    "\n"
    "## [0.1.3.0] - 2026-02-01\n"
    "\n"
    "### Fixed\n"
    "- three\n"
    "\n"
    "## [0.1.1.0] - 2026-01-01\n"
    "\n"
    "First.\n"
)

TENTH_AND_NINTH = (
    "## [0.1.10.0] - 2026-04-01\n"
    "\n"
    "Tenth.\n"
    "\n"
    "## [0.1.9.0] - 2026-03-01\n"
    "\n"
    "Ninth.\n"
)


def run_cli(text: str, label: str, *flags: str) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory(dir=HERE) as d:
        with open(os.path.join(d, "CHANGELOG.md"), "w", encoding="utf-8") as f:
            f.write(text)
        return subprocess.run(
            [sys.executable, "-I", SCRIPT, *flags, label, os.path.join(d, "CHANGELOG.md")],
            capture_output=True,
            text=True,
        )


class ChangelogSectionTests(unittest.TestCase):
    def test_extracts_middle_section(self):
        body = changelog_section.extract(THREE, "0.1.1.0")
        self.assertEqual(body, "### Added\n- middle one\n- middle two\n")
        self.assertNotIn("## [", body)

    def test_missing_label_exits_1(self):
        r = run_cli(THREE, "9.9.9.9")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout, "")

    def test_empty_section_exits_1(self):
        text = "## [0.1.1.0] x\n\n\n## [0.1.0.0] y\n\nbody\n"
        r = run_cli(text, "0.1.1.0")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout, "")

    def test_label_with_regex_metachars_is_literal(self):
        text = "## [0x1x1x0] decoy\n\ndecoy body\n"
        r = run_cli(text, "0.1.1.0")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout, "")

    def test_cli_prints_section(self):
        r = run_cli(THREE, "0.1.1.0")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "### Added\n- middle one\n- middle two\n")


class ChangelogRangeTests(unittest.TestCase):
    def test_range_compares_versions_numerically_and_keeps_file_order(self):
        body = changelog_section.extract_since(RANGE, "0.1.10.0", "0.1.3.0")
        self.assertEqual(body, TENTH_AND_NINTH)

    def test_range_excludes_the_older_label_and_unreleased(self):
        body = changelog_section.extract_since(RANGE, "0.1.10.0", "0.1.3.0")
        self.assertNotIn("three", body)
        self.assertNotIn("Not released yet", body)

    def test_range_excludes_versions_newer_than_the_label(self):
        body = changelog_section.extract_since(RANGE, "0.1.3.0", "0.1.1.0")
        self.assertNotIn("Ninth", body)
        self.assertNotIn("Tenth", body)

    def test_single_section_prints_its_body_without_a_header(self):
        body = changelog_section.extract_since(RANGE, "0.1.10.0", "0.1.9.0")
        self.assertEqual(body, "Tenth.\n")

    def test_since_label_without_a_section_of_its_own_still_bounds_the_range(self):
        body = changelog_section.extract_since(RANGE, "0.1.9.0", "0.1.2.0")
        expected = (
            "## [0.1.9.0] - 2026-03-01\n"
            "\n"
            "Ninth.\n"
            "\n"
            "## [0.1.3.0] - 2026-02-01\n"
            "\n"
            "### Fixed\n"
            "- three\n"
        )
        self.assertEqual(body, expected)

    def test_label_without_its_own_section_is_empty(self):
        self.assertEqual(changelog_section.extract_since(RANGE, "0.1.5.0", "0.1.1.0"), "")

    def test_label_with_an_empty_section_is_empty_even_if_older_ones_have_text(self):
        text = "## [0.1.2.0] x\n\n\n## [0.1.1.0] y\n\nbody\n"
        self.assertEqual(changelog_section.extract_since(text, "0.1.2.0", "0.1.0.0"), "")

    def test_cli_prints_the_range(self):
        r = run_cli(RANGE, "0.1.10.0", "--since", "0.1.3.0")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, TENTH_AND_NINTH)

    def test_cli_missing_own_section_exits_1(self):
        r = run_cli(RANGE, "0.1.5.0", "--since", "0.1.1.0")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stdout, "")

    def test_cli_since_equal_to_label_exits_2(self):
        r = run_cli(RANGE, "0.1.9.0", "--since", "0.1.9.0")
        self.assertEqual(r.returncode, 2)
        self.assertEqual(r.stdout, "")

    def test_cli_since_newer_than_label_exits_2(self):
        r = run_cli(RANGE, "0.1.3.0", "--since", "0.1.9.0")
        self.assertEqual(r.returncode, 2)

    def test_cli_since_that_is_not_a_version_exits_2(self):
        r = run_cli(RANGE, "0.1.9.0", "--since", "Unreleased")
        self.assertEqual(r.returncode, 2)

    def test_cli_without_since_is_unchanged_by_the_range_mode(self):
        r = run_cli(RANGE, "0.1.9.0")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "Ninth.\n")


if __name__ == "__main__":
    unittest.main()
