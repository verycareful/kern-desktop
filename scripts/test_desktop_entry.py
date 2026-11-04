# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
"""Tests for the desktop entry, the AppStream metainfo and their bundling.

Run: python3 -I scripts/test_desktop_entry.py

Needs desktop-file-validate (desktop-file-utils), appstreamcli (appstream)
and cargo. The MimeType list is the output of the desktop_mime_types example
run against this machine's MIME database. Where CI is set the database is
the runner's, which lists a different set of types, so there the test checks
only the types that database knows: each must be one the generator emits.
"""

import json
import os
import re
import subprocess
import unittest
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
TAURI = os.path.join(REPO, "src-tauri")
APP_ID = "io.github.verycareful.kern"
DESKTOP = os.path.join(TAURI, "linux", f"{APP_ID}.desktop")
METAINFO = os.path.join(TAURI, "linux", f"{APP_ID}.metainfo.xml")
CONF = os.path.join(TAURI, "tauri.conf.json")
SYSTEM_TYPES = "/usr/share/mime/types"
METAINFO_DEST = f"/usr/share/metainfo/{APP_ID}.metainfo.xml"
SCALABLE_DEST = "/usr/share/icons/hicolor/scalable/apps/kern.svg"
BINARY = "kern"
# desktop-file-validate warns on every type under message/: it expects mail
# programs to claim them. Kern opens them as text, so these warnings are the
# accepted ones; any other warning or error fails.
ACCEPTED_WARNING = re.compile(r'contains value "message/[^"]+" which is a MIME type that should probably not be used')


def entry() -> dict:
    keys = {}
    with open(DESKTOP, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("#") or not line or line.startswith("["):
                continue
            key, _, value = line.partition("=")
            keys[key] = value
    return keys


def mime_list(value: str) -> list:
    return [t for t in value.split(";") if t]


def generated() -> list:
    out = subprocess.run(
        ["cargo", "run", "-q", "--manifest-path", os.path.join(TAURI, "Cargo.toml"), "--example", "desktop_mime_types"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert out.startswith("MimeType="), out[:80]
    return mime_list(out[len("MimeType=") :])


class DesktopEntry(unittest.TestCase):
    def test_validates(self) -> None:
        r = subprocess.run(["desktop-file-validate", DESKTOP], capture_output=True, text=True, check=False)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        problems = [
            line
            for line in (r.stdout + r.stderr).splitlines()
            if (": warning: " in line or ": error: " in line) and not ACCEPTED_WARNING.search(line)
        ]
        self.assertEqual(problems, [])

    def test_launch_keys(self) -> None:
        e = entry()
        self.assertEqual(e["Exec"], f"{BINARY} %F")
        self.assertEqual(e["Icon"], BINARY)
        self.assertEqual(e["StartupWMClass"], APP_ID)
        self.assertEqual(e["Name"], "Kern")

    def test_mime_types_are_the_generators(self) -> None:
        listed = mime_list(entry()["MimeType"])
        self.assertEqual(listed[0], "inode/directory")
        self.assertEqual(len(listed), len(set(listed)), "a type is listed twice")
        made = generated()
        if os.environ.get("CI"):
            with open(SYSTEM_TYPES, encoding="utf-8") as f:
                known = {line.strip() for line in f if line.strip()}
            stray = [t for t in listed[1:] if t in known and t not in made]
            self.assertEqual(stray, [], "listed types this database does not call text")
            print(f"note: CI is set; checked {sum(t in known for t in listed)} of {len(listed)} types")
        else:
            self.assertEqual(listed, made)


class Metainfo(unittest.TestCase):
    def test_validates(self) -> None:
        r = subprocess.run(
            ["appstreamcli", "validate", "--no-net", METAINFO], capture_output=True, text=True, check=False
        )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_identity(self) -> None:
        root = ET.parse(METAINFO).getroot()
        self.assertEqual(root.findtext("id"), APP_ID)
        self.assertEqual(root.findtext("project_license"), "AGPL-3.0-or-later")
        self.assertEqual(root.findtext("launchable[@type='desktop-id']"), f"{APP_ID}.desktop")

    def test_newest_release_is_this_version(self) -> None:
        with open(os.path.join(REPO, "VERSION"), encoding="utf-8") as f:
            label = f.read().strip()
        release = ".".join(label.split(".")[:4])
        root = ET.parse(METAINFO).getroot()
        self.assertEqual(root.find("releases/release").get("version"), release)


class Bundle(unittest.TestCase):
    def setUp(self) -> None:
        with open(CONF, encoding="utf-8") as f:
            self.conf = json.load(f)

    def test_desktop_file_is_named_after_the_app_id(self) -> None:
        # The bundler names the installed entry after productName.
        self.assertEqual(self.conf["productName"], APP_ID)
        self.assertEqual(self.conf["identifier"], APP_ID)
        self.assertEqual(self.conf["mainBinaryName"], BINARY)

    def test_deb_and_appimage_carry_the_entry_and_metainfo(self) -> None:
        linux = self.conf["bundle"]["linux"]
        self.assertEqual(linux["deb"]["desktopTemplate"], f"linux/{APP_ID}.desktop")
        for target in ("deb", "appimage"):
            files = linux[target]["files"]
            self.assertEqual(files.get(METAINFO_DEST), f"linux/{APP_ID}.metainfo.xml", target)
            self.assertEqual(files.get(SCALABLE_DEST), "icons/kern.svg", target)


if __name__ == "__main__":
    unittest.main()
