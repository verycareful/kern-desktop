# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

"""The installer's release fetch, install layout, settings walk and flows.

Every test builds a world in a temporary directory (TMPDIR): a home with its own XDG
directories, a fixture release (a fake AppImage that extracts a fake Kern, a
deb, uninstall.sh and SHA256SUMS), and a bin directory of stand-ins for the
system commands the scripts call (sudo, xdg-mime, busctl, apt-get,
update-desktop-database). The stand-ins append each call to calls.log. Nothing
outside the world is read or written, and nothing touches the network: the
release comes from --from.
"""

import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_installer_ui import CTRL_C, DOWN, ENTER, SHOW_CURSOR, UP, Session  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
INSTALLER = ROOT / "installer"
APP_ID = "io.github.verycareful.kern"
VERSION = "0.1.0.0.7"
CARGO_VERSION = "0.1.0+0.7"
DESKTOP = f"""[Desktop Entry]
Type=Application
Name=Kern
Exec=kern %F
Icon=kern
"""

# The fake Kern: --apply-settings copies the patch to applied.json (and
# fails when the world says so); any other launch is logged.
FAKE_KERN = """#!/bin/bash
w="__WORLD__"
if [[ "$1" == --apply-settings ]]; then
    [[ -e "$w/apply-fails" ]] && { echo "kern: refused" >&2; exit 1; }
    mkdir -p "$w/home/.config/kern"
    cp "$2" "$w/applied.json"
    exit 0
fi
echo "launch $*" >> "$w/calls.log"
"""

# The fake AppImage: --appimage-extract makes squashfs-root in the working
# directory, as the AppImage runtime does.
FAKE_APPIMAGE = """#!/bin/bash
[[ "$1" == --appimage-extract ]] || exit 9
r=squashfs-root
mkdir -p "$r/usr/share/applications" "$r/usr/share/icons/hicolor/scalable/apps" \\
    "$r/usr/share/icons/hicolor/32x32/apps" "$r/usr/share/metainfo" "$r/usr/bin"
cat > "$r/AppRun" <<'KERN'
__KERN__
KERN
chmod +x "$r/AppRun"
cat > "$r/usr/share/applications/__APP__.desktop" <<'ENTRY'
__DESKTOP__
ENTRY
echo svg > "$r/usr/share/icons/hicolor/scalable/apps/kern.svg"
echo png > "$r/usr/share/icons/hicolor/32x32/apps/kern.png"
echo xml > "$r/usr/share/metainfo/__APP__.metainfo.xml"
"""

STANDINS = {
    # The world has no root, so sudo stands in for the identity switch: a
    # directory mktemp makes under sudo is listed in root-only and is open
    # only while a sudo command runs, as a 0700 directory owned by root is.
    "sudo": textwrap.dedent(
        """\
        echo "sudo $*" >> "$W/calls.log"
        lock() { [[ -e "$W/root-only" ]] && while IFS= read -r d; do chmod "$1" "$d" 2>/dev/null; done < "$W/root-only"; }
        lock 700
        FAKE_ROOT=1 "$@"
        rc=$?
        lock 000
        exit $rc
        """
    ),
    "mktemp": textwrap.dedent(
        """\
        out=$(/usr/bin/mktemp "$@") || exit
        [[ -n "$FAKE_ROOT" && -d "$out" ]] && echo "$out" >> "$W/root-only"
        echo "$out"
        """
    ),
    "apt-get": 'echo "apt-get $*" >> "$W/calls.log"',
    "update-desktop-database": 'echo "update-desktop-database $*" >> "$W/calls.log"',
    "gtk-update-icon-cache": "true",
    # Kern is running while the world holds the file "running".
    "busctl": '[[ -e "$W/running" ]]',
    "xdg-mime": textwrap.dedent(
        """\
        echo "xdg-mime $*" >> "$W/calls.log"
        if [[ "$1" == query ]]; then cat "$W/default-fm" 2>/dev/null || true; fi
        if [[ "$1" == default ]]; then echo "$2" > "$W/default-fm"; fi
        """
    ),
    "uname": 'if [[ "$1" == -m ]]; then echo x86_64; else /usr/bin/uname "$@"; fi',
    # GitHub, served from the fixture release: -I answers the latest-release
    # redirect with the fixture's tag, -o copies the named asset. While the
    # world holds "slow", the AppImage takes 30 s to arrive.
    "curl": textwrap.dedent(
        """\
        echo "curl $*" >> "$W/calls.log"
        url="${*: -1}"
        if [[ " $* " == *" -I "* || " $* " == *" -fsSLI "* ]]; then
            echo "https://github.com/verycareful/kern-desktop/releases/tag/$(cat "$W/latest-tag")"
            exit 0
        fi
        out=""
        while (($#)); do [[ "$1" == -o ]] && out=$2; shift; done
        name=${url##*/}
        if [[ -e "$W/slow" && "$name" == *.AppImage ]]; then touch "$W/copying"; sleep 30; fi
        exec /usr/bin/cp "$W/release/$name" "$out"
        """
    ),
}


class World:
    def __init__(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="installer-")
        self.root = Path(self._tmp.name)
        self.home = self.root / "home"
        self.bin = self.root / "bin"
        self.release = self.root / "release"
        for d in (self.home, self.bin, self.release):
            d.mkdir()
        for name, body in STANDINS.items():
            self.script(self.bin / name, body)
        self.make_release()

    def close(self) -> None:
        self._tmp.cleanup()

    def script(self, path: Path, body: str) -> None:
        path.write_text("#!/bin/bash\n" + body + "\n")
        path.chmod(path.stat().st_mode | stat.S_IXUSR)

    def make_release(self, version: str = CARGO_VERSION) -> None:
        for f in self.release.iterdir():
            f.unlink()
        kern = FAKE_KERN.replace("__WORLD__", str(self.root))
        appimage = (
            FAKE_APPIMAGE.replace("__KERN__", kern)
            .replace("__APP__", APP_ID)
            .replace("__DESKTOP__", DESKTOP.strip())
        )
        names = {
            f"{APP_ID}_{version}_amd64.AppImage": appimage,
            f"{APP_ID}_{version}_amd64.deb": "not a real deb\n",
            "uninstall.sh": (ROOT / "uninstall.sh").read_text()
            if (ROOT / "uninstall.sh").exists()
            else "#!/bin/bash\n",
        }
        sums = []
        for name, body in names.items():
            p = self.release / name
            p.write_text(body)
            p.chmod(0o755)
            sums.append(f"{hashlib.sha256(body.encode()).hexdigest()}  {name}")
        (self.release / "SHA256SUMS").write_text("\n".join(sums) + "\n")
        (self.root / "latest-tag").write_text(version.replace("+", ".", 1) + "\n")

    def env(self) -> dict:
        return {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "HOME": str(self.home),
            "XDG_CONFIG_HOME": str(self.home / ".config"),
            "XDG_STATE_HOME": str(self.home / ".local" / "state"),
            "XDG_DATA_HOME": str(self.home / ".local" / "share"),
            "W": str(self.root),
            "TMPDIR": str(self.root),
            "TERM": "xterm-256color",
            "NO_COLOR": "1",
        }

    def bash(self, body: str, sources=("ui.sh", "common.sh", "release.sh", "layout.sh")) -> subprocess.CompletedProcess:
        prelude = "".join(f"source {INSTALLER / s}; " for s in sources)
        return subprocess.run(
            ["bash", "--noprofile", "--norc", "-c", prelude + body],
            capture_output=True,
            text=True,
            env=self.env(),
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            timeout=60,
        )

    def calls(self) -> str:
        p = self.root / "calls.log"
        return p.read_text() if p.exists() else ""

    @property
    def lib(self) -> Path:
        return self.home / ".local" / "lib" / "kern"

    @property
    def share(self) -> Path:
        return self.home / ".local" / "share"


class Release(unittest.TestCase):
    def setUp(self) -> None:
        self.w = World()
        self.addCleanup(self.w.close)

    def test_fetch_from_dir_verifies_and_names_the_assets(self) -> None:
        r = self.w.bash(
            f'd=$(mktemp -d -p "$W"); release_fetch "{self.w.release}" "$d"; '
            'echo "v=$REL_VERSION"; basename "$REL_APPIMAGE"; basename "$REL_DEB"; basename "$REL_UNINSTALL"'
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = r.stdout.split()
        self.assertEqual(lines[0], f"v={VERSION}")
        self.assertEqual(lines[1], f"{APP_ID}_{CARGO_VERSION}_amd64.AppImage")
        self.assertEqual(lines[2], f"{APP_ID}_{CARGO_VERSION}_amd64.deb")
        self.assertEqual(lines[3], "uninstall.sh")

    def test_fetch_takes_assets_named_after_the_tag(self) -> None:
        # The release workflow publishes the bundles under the tag, not the
        # Cargo version.
        self.w.make_release(VERSION)
        r = self.w.bash(
            f'd=$(mktemp -d -p "$W"); release_fetch "{self.w.release}" "$d"; '
            'echo "v=$REL_VERSION"; basename "$REL_APPIMAGE"; basename "$REL_DEB"'
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(
            r.stdout.split(),
            [
                f"v={VERSION}",
                f"{APP_ID}_{VERSION}_amd64.AppImage",
                f"{APP_ID}_{VERSION}_amd64.deb",
            ],
        )

    def test_corrupted_asset_aborts_before_any_install_file(self) -> None:
        app = next(self.w.release.glob("*.AppImage"))
        data = bytearray(app.read_bytes())
        data[20] ^= 1
        app.write_bytes(bytes(data))
        r = self.w.bash(
            f'd=$(mktemp -d -p "$W"); release_fetch "{self.w.release}" "$d" && '
            'layout_install user appimage "$REL_VERSION" "$REL_APPIMAGE" "$REL_DEB" "$REL_UNINSTALL"'
        )
        self.assertEqual(r.returncode, 1, r.stderr)
        self.assertIn("checksum", r.stderr.lower())
        self.assertFalse(self.w.lib.exists())

    def test_asset_missing_from_sums_is_refused(self) -> None:
        sums = self.w.release / "SHA256SUMS"
        sums.write_text("".join(l + "\n" for l in sums.read_text().splitlines() if "deb" not in l))
        r = self.w.bash(f'd=$(mktemp -d -p "$W"); release_fetch "{self.w.release}" "$d"')
        self.assertEqual(r.returncode, 1)
        self.assertIn(".deb", r.stderr)

    def test_unsafe_name_in_sums_is_refused(self) -> None:
        sums = self.w.release / "SHA256SUMS"
        sums.write_text(sums.read_text() + f"{'0' * 64}  ../evil.AppImage\n")
        r = self.w.bash(f'd=$(mktemp -d -p "$W"); release_fetch "{self.w.release}" "$d"')
        self.assertEqual(r.returncode, 1)
        self.assertIn("evil", r.stderr)

    def test_version_gt(self) -> None:
        cases = [
            ("0.1.0.10", "0.1.0.9", 0),
            ("0.1.0.9", "0.1.0.10", 1),
            ("0.1.0.0", "0.1.0.0", 1),
            ("0.1.0.0.1", "0.1.0.0", 0),
            ("0.1.0.0", "0.1.0.0.1", 1),
            ("1.0.0.0", "0.9.9.9", 0),
        ]
        for a, b, want in cases:
            r = self.w.bash(f"version_gt {a} {b}")
            self.assertEqual(r.returncode, want, f"version_gt {a} {b}")

    def test_cargo_to_label(self) -> None:
        r = self.w.bash(
            "cargo_to_label 0.1.0+0.103; cargo_to_label 0.1.0+0; cargo_to_label 0.1.0.0"
        )
        self.assertEqual(r.stdout.split(), ["0.1.0.0.103", "0.1.0.0", "0.1.0.0"])


class Layout(unittest.TestCase):
    def setUp(self) -> None:
        self.w = World()
        self.addCleanup(self.w.close)

    def install(self) -> subprocess.CompletedProcess:
        return self.w.bash(
            f'd=$(mktemp -d -p "$W"); release_fetch "{self.w.release}" "$d" && '
            'layout_install user appimage "$REL_VERSION" "$REL_APPIMAGE" "$REL_DEB" "$REL_UNINSTALL" && '
            'record_write user appimage "$REL_VERSION" ""'
        )

    def test_user_install_creates_the_documented_paths(self) -> None:
        r = self.install()
        self.assertEqual(r.returncode, 0, r.stderr)
        lib = self.w.lib
        self.assertTrue((lib / VERSION / "AppRun").is_file())
        self.assertEqual(os.readlink(lib / "current"), VERSION)
        launcher = self.w.home / ".local" / "bin" / "kern"
        self.assertEqual(os.readlink(launcher), str(lib / "current" / "AppRun"))
        entry = (self.w.share / "applications" / f"{APP_ID}.desktop").read_text()
        self.assertIn(f"Exec={launcher} %F", entry)
        self.assertNotIn("Exec=kern", entry)
        self.assertTrue((self.w.share / "icons/hicolor/scalable/apps/kern.svg").is_file())
        self.assertTrue((self.w.share / "icons/hicolor/32x32/apps/kern.png").is_file())
        self.assertTrue((self.w.share / f"metainfo/{APP_ID}.metainfo.xml").is_file())
        self.assertTrue((lib / "uninstall.sh").is_file())
        rec = (lib / "install.env").read_text().splitlines()
        self.assertIn(f"KERN_VERSION={VERSION}", rec)
        self.assertIn("KERN_SCOPE=user", rec)
        self.assertIn("KERN_FORMAT=appimage", rec)
        self.assertIn("KERN_PREV_FM=", rec)
        self.assertIn("update-desktop-database", self.w.calls())

    @unittest.skipIf(os.geteuid() == 0, "root opens a 0000 directory, so the lock models nothing")
    def test_install_through_sudo_never_enters_a_root_only_directory(self) -> None:
        # The system scope's switch to root, kept inside the world: the user
        # paths, with every layout command run through sudo.
        r = self.w.bash(
            'eval "$(declare -f scope_paths | sed 1s/scope_paths/user_paths/)"; '
            'scope_paths() { user_paths user; L_SUDO=(sudo); }; '
            f'd=$(mktemp -d -p "$W"); release_fetch "{self.w.release}" "$d" && '
            'layout_install system appimage "$REL_VERSION" "$REL_APPIMAGE" "$REL_DEB" "$REL_UNINSTALL"'
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("sudo mktemp -d", self.w.calls())
        self.assertTrue((self.w.lib / VERSION / "AppRun").is_file())
        self.assertEqual([p.name for p in self.w.lib.glob(".stage-*")], [])

    def test_record_read_parses_without_sourcing(self) -> None:
        self.assertEqual(self.install().returncode, 0)
        rec = self.w.lib / "install.env"
        rec.write_text(rec.read_text() + "KERN_PREV_FM=$(touch $W/pwned)\n")
        r = self.w.bash(f'record_read "{rec}"; echo "$KERN_VERSION|$KERN_PREV_FM"')
        self.assertEqual(r.stdout.strip(), f"{VERSION}|$(touch $W/pwned)")
        self.assertFalse((self.w.root / "pwned").exists())

    def test_installed_kern_finds_none_record_and_foreign(self) -> None:
        r = self.w.bash('installed_kern; echo "$FOUND"')
        self.assertEqual(r.stdout.strip(), "none")
        self.assertEqual(self.install().returncode, 0)
        r = self.w.bash('installed_kern; echo "$FOUND|$KERN_VERSION"')
        self.assertEqual(r.stdout.strip(), f"record-user|{VERSION}")

    def test_foreign_launcher_is_reported_not_replaced(self) -> None:
        bin_dir = self.w.home / ".local" / "bin"
        bin_dir.mkdir(parents=True)
        os.symlink("/elsewhere/kern", bin_dir / "kern")
        r = self.w.bash('installed_kern; echo "$FOUND"')
        self.assertTrue(r.stdout.strip().startswith("foreign"), r.stdout)
        self.assertIn(str(bin_dir / "kern"), r.stdout)
        self.assertEqual(os.readlink(bin_dir / "kern"), "/elsewhere/kern")

    def test_foreign_desktop_entry_is_reported(self) -> None:
        apps = self.w.share / "applications"
        apps.mkdir(parents=True)
        (apps / f"{APP_ID}.desktop").write_text(DESKTOP)
        r = self.w.bash('installed_kern; echo "$FOUND"')
        self.assertTrue(r.stdout.strip().startswith("foreign"), r.stdout)

    def test_remove_deletes_only_what_was_installed(self) -> None:
        self.assertEqual(self.install().returncode, 0)
        other = self.w.share / "applications" / "other.desktop"
        other.write_text("[Desktop Entry]\n")
        r = self.w.bash('installed_kern; layout_remove')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.w.lib.exists())
        self.assertFalse((self.w.home / ".local/bin/kern").exists())
        self.assertFalse((self.w.share / "applications" / f"{APP_ID}.desktop").exists())
        self.assertFalse((self.w.share / "icons/hicolor/scalable/apps/kern.svg").exists())
        self.assertTrue(other.exists())


# Settings defaults, from `impl Default for Settings` (src-tauri/src/store.rs)
# and kernkraft-theme's Mode, KernAccent and Follow defaults.
DEFAULTS = {
    "theme_mode": "system",
    "interface_size": 90,
    "follow": {"colours": True, "accent": True, "fonts": True, "radius": True},
    "accent": "slate",
    "new_tab_folder": None,
    "new_tab_default": "folder",
    "view_mode": "list",
    "show_hidden": False,
    "terminal": None,
    "scan_documents": True,
    "scan_downloads": True,
    "scan_roots": [],
    "word_wrap": False,
    "editor_zoom": 1,
}


class Walk(unittest.TestCase):
    def setUp(self) -> None:
        self.w = World()
        self.addCleanup(self.w.close)
        self.s = Session(
            f"source {INSTALLER / 'ui.sh'}; source {INSTALLER / 'common.sh'}; source {INSTALLER / 'settings.sh'}; ui_init; "
            'settings_walk "$W/patch.json"; printf "RESULT=done\\n" >&3',
            env=self.w.env(),
        )

    def answer(self, prompt: bytes, *keys: bytes) -> None:
        self.s.expect(prompt)
        self.s.send(*keys, ENTER)

    def patch(self) -> dict:
        self.assertEqual(self.s.result(), "done")
        self.assertEqual(self.s.finish(), 0)
        return json.loads((self.w.root / "patch.json").read_text())

    def defaults_until_folder(self) -> None:
        for p in (b"Theme", b"Interface size", b"colours?", b"accent colour?", b"fonts?",
                  b"corner radius?"):
            self.answer(p)

    def test_enter_everywhere_writes_the_defaults(self) -> None:
        self.defaults_until_folder()
        for p in (b"New tab folder", b"Ctrl+T opens", b"View of new folder views",
                  b"Show hidden items", b"Terminal", b"Walk Documents", b"Walk Downloads",
                  b"Add a folder", b"Wrap long lines", b"Text size"):
            self.answer(p)
        self.assertEqual(self.patch(), DEFAULTS)

    def test_choices_are_written(self) -> None:
        self.answer(b"Theme", DOWN, DOWN)  # Dark
        self.answer(b"Interface size", DOWN, DOWN)  # 110 %
        self.answer(b"colours?")
        self.answer(b"accent colour?", DOWN)  # No: the accent is asked
        self.answer(b"Accent colour", DOWN, DOWN, DOWN, DOWN)  # Ocean
        self.answer(b"fonts?", DOWN)
        self.answer(b"corner radius?")
        self.answer(b"New tab folder")
        self.answer(b"Ctrl+T opens", DOWN)
        self.answer(b"View of new folder views", DOWN)
        self.answer(b"Show hidden items", UP)
        self.answer(b"Terminal", b"foot")
        self.answer(b"Walk Documents", DOWN)
        self.answer(b"Walk Downloads")
        self.answer(b"Add a folder")
        self.answer(b"Wrap long lines", UP)
        self.answer(b"Text size", DOWN, DOWN)  # 150 %
        p = self.patch()
        self.assertEqual(p["theme_mode"], "dark")
        self.assertEqual(p["interface_size"], 110)
        self.assertEqual(p["follow"], {"colours": True, "accent": False, "fonts": False, "radius": True})
        self.assertEqual(p["accent"], "ocean")
        self.assertEqual(p["new_tab_default"], "current")
        self.assertEqual(p["view_mode"], "grid")
        self.assertTrue(p["show_hidden"])
        self.assertEqual(p["terminal"], "foot")
        self.assertFalse(p["scan_documents"])
        self.assertTrue(p["word_wrap"])
        self.assertEqual(p["editor_zoom"], 1.5)

    def test_bad_folder_is_asked_again_and_odd_names_round_trip(self) -> None:
        odd = self.w.home / 'my "odd" \\ dir'
        odd.mkdir()
        (self.w.home / "Projects").mkdir()
        self.defaults_until_folder()
        self.answer(b"New tab folder", DOWN)  # Another folder
        self.answer(b"Folder for new tabs", b"relative/path")
        self.answer(b"Folder for new tabs", b"/does/not/exist")
        self.answer(b"Folder for new tabs", b"~/Projects")
        for p in (b"Ctrl+T opens", b"View of new folder views", b"Show hidden items",
                  b"Terminal", b"Walk Documents", b"Walk Downloads"):
            self.answer(p)
        self.answer(b"Add a folder", str(odd).encode())
        self.answer(b"Add a folder", b"nope")
        self.answer(b"Add a folder", str(odd).encode())  # a repeat is not added twice
        self.answer(b"Add a folder")
        self.answer(b"Wrap long lines")
        self.answer(b"Text size")
        p = self.patch()
        self.assertEqual(p["new_tab_folder"], {"k": "Utf8", "v": str(self.w.home / "Projects")})
        self.assertEqual(p["scan_roots"], [{"k": "Utf8", "v": str(odd)}])
        self.assertIn(b"not a folder", self.s.out)


INSTALL = ROOT / "install.sh"
UNINSTALL = ROOT / "uninstall.sh"
OLD_CARGO = "0.1.0+0.5"
OLD_VERSION = "0.1.0.0.5"


class Flows(unittest.TestCase):
    """install.sh and uninstall.sh as built, driven through a pty."""

    def setUp(self) -> None:
        self.w = World()
        self.addCleanup(self.w.close)
        (self.w.root / "default-fm").write_text("org.kde.dolphin.desktop\n")
        self.config = self.w.home / ".config" / "kern"
        self.state = self.w.home / ".local" / "state" / "kern"

    def run_script(self, script: Path, *args: str) -> Session:
        quoted = " ".join(f"'{a}'" for a in args)
        return Session(f"bash {script} {quoted}", env=self.w.env())

    def install(self, *args: str) -> Session:
        return self.run_script(INSTALL, "--from", str(self.w.release), *args)

    def answer(self, s: Session, prompt: bytes, *keys: bytes) -> None:
        s.expect(prompt)
        s.send(*keys, ENTER)

    def unattended(self, script: Path = INSTALL, *args: str) -> subprocess.CompletedProcess:
        a = ["--from", str(self.w.release)] if script == INSTALL else []
        return subprocess.run(
            ["setsid", "bash", str(script), *a, "--defaults", *args],
            capture_output=True, text=True, env=self.w.env(),
            stdin=subprocess.DEVNULL, timeout=60,
        )

    def installed_old(self) -> None:
        self.w.make_release(OLD_CARGO)
        r = self.unattended()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.w.make_release()

    def user_data(self) -> dict:
        self.config.mkdir(parents=True, exist_ok=True)
        self.state.mkdir(parents=True, exist_ok=True)
        files = {
            self.config / "settings.json": b'{"theme_mode":"dark"}',
            self.state / "pins.json": b'{"pins":[1]}',
            self.state / "recents.json": b'{"recents":[2]}',
        }
        for p, b in files.items():
            p.write_bytes(b)
        return files

    def test_fresh_install_full_flow(self) -> None:
        s = self.install()
        s.expect(b"Thank you for choosing Kern")
        self.answer(s, b"Install Kern for")
        self.answer(s, b"Customise Kern now?")
        for p in (b"Theme", b"Interface size", b"colours?", b"accent colour?", b"fonts?",
                  b"corner radius?", b"New tab folder", b"Ctrl+T opens",
                  b"View of new folder views", b"Show hidden items", b"Terminal",
                  b"Walk Documents", b"Walk Downloads", b"Add a folder", b"Wrap long lines",
                  b"Text size"):
            self.answer(s, p)
        self.answer(s, b"default file manager?", UP)
        self.answer(s, b"Launch Kern now?", DOWN)
        s.expect(b"Kern " + VERSION.encode() + b" is installed")
        self.assertEqual(s.finish(), 0)
        self.assertTrue((self.w.lib / VERSION / "AppRun").is_file())
        self.assertEqual(json.loads((self.w.root / "applied.json").read_text()), DEFAULTS)
        rec = (self.w.lib / "install.env").read_text()
        self.assertIn("KERN_PREV_FM=org.kde.dolphin.desktop", rec)
        self.assertEqual((self.w.root / "default-fm").read_text().strip(), f"{APP_ID}.desktop")
        self.assertNotIn("launch", self.w.calls())

    def test_no_customising_applies_nothing_and_launch_starts_kern(self) -> None:
        s = self.install()
        self.answer(s, b"Install Kern for")
        self.answer(s, b"Customise Kern now?", DOWN)
        self.answer(s, b"default file manager?")
        self.answer(s, b"Launch Kern now?")
        self.assertEqual(s.finish(), 0)
        self.assertFalse((self.w.root / "applied.json").exists())
        self.assertIn("KERN_PREV_FM=\n", (self.w.lib / "install.env").read_text())
        for _ in range(50):
            if "launch" in self.w.calls():
                break
            time.sleep(0.05)
        self.assertIn("launch", self.w.calls())

    def test_existing_at_latest_offers_reinstall_and_cancel_only(self) -> None:
        self.assertEqual(self.unattended().returncode, 0)
        s = self.install()
        s.expect(b"Fresh reinstall")
        s.expect(b"Cancel")
        s.send(DOWN, ENTER)
        self.assertEqual(s.finish(), 0)
        self.assertNotIn(b"Update to", s.out)
        self.assertIn(b"up to date", s.out)

    def test_update_keeps_settings_pins_and_recents(self) -> None:
        self.installed_old()
        files = self.user_data()
        s = self.install()
        self.answer(s, b"Update to " + VERSION.encode())
        s.expect(b"updated to " + VERSION.encode())
        self.assertEqual(s.finish(), 0)
        for p, b in files.items():
            self.assertEqual(p.read_bytes(), b)
        self.assertNotIn(b"Theme", s.out)
        self.assertFalse((self.w.lib / OLD_VERSION).exists())
        self.assertIn(f"KERN_VERSION={VERSION}", (self.w.lib / "install.env").read_text())

    def reinstall(self, settings_keys: tuple, pins_keys: tuple) -> Session:
        # Kern is at the latest release, so Fresh reinstall is the first entry.
        s = self.install()
        s.expect(b"Fresh reinstall")
        s.expect(b"Cancel")
        s.send(ENTER)
        self.answer(s, b"Settings", *settings_keys)
        self.answer(s, b"Pins and recents", *pins_keys)
        self.answer(s, b"Install Kern for")
        return s

    def test_reinstall_clear_moves_pins_and_recents_to_backups(self) -> None:
        self.assertEqual(self.unattended().returncode, 0)
        files = self.user_data()
        s = self.reinstall((), (DOWN,))
        self.answer(s, b"default file manager?", DOWN)
        self.answer(s, b"Launch Kern now?", DOWN)
        self.assertEqual(s.finish(), 0)
        self.assertEqual((self.config / "settings.json").read_bytes(), files[self.config / "settings.json"])
        self.assertFalse((self.state / "pins.json").exists())
        self.assertFalse((self.state / "recents.json").exists())
        backups = sorted(p.name for p in self.state.iterdir())
        self.assertEqual(len(backups), 2, backups)
        self.assertTrue(all(".backup-" in b for b in backups))
        pins_backup = next(self.state.glob("pins.json.backup-*"))
        self.assertEqual(pins_backup.read_bytes(), b'{"pins":[1]}')

    def test_reinstall_restore_defaults_without_settings_makes_no_backup(self) -> None:
        self.assertEqual(self.unattended().returncode, 0)
        s = self.reinstall((DOWN, DOWN), ())
        self.answer(s, b"default file manager?", DOWN)
        self.answer(s, b"Launch Kern now?", DOWN)
        self.assertEqual(s.finish(), 0)
        self.assertFalse(self.config.exists() and any(self.config.iterdir()))
        self.assertFalse((self.w.root / "applied.json").exists())

    def test_reinstall_restore_defaults_moves_settings_aside(self) -> None:
        self.assertEqual(self.unattended().returncode, 0)
        files = self.user_data()
        s = self.reinstall((DOWN, DOWN), ())
        self.answer(s, b"default file manager?", DOWN)
        self.answer(s, b"Launch Kern now?", DOWN)
        self.assertEqual(s.finish(), 0)
        self.assertFalse((self.config / "settings.json").exists())
        backup = next(self.config.glob("settings.json.backup-*"))
        self.assertEqual(backup.read_bytes(), files[self.config / "settings.json"])
        self.assertEqual((self.state / "pins.json").read_bytes(), files[self.state / "pins.json"])

    def test_failed_reinstall_keeps_the_old_install_and_settings(self) -> None:
        self.assertEqual(self.unattended().returncode, 0)
        files = self.user_data()
        record = (self.w.lib / "install.env").read_bytes()
        # Same version, an AppImage that cannot be extracted.
        app = next(self.w.release.glob("*.AppImage"))
        app.write_text("#!/bin/bash\nexit 1\n")
        sums = [l for l in (self.w.release / "SHA256SUMS").read_text().splitlines() if ".AppImage" not in l]
        sums.append(f"{hashlib.sha256(app.read_bytes()).hexdigest()}  {app.name}")
        (self.w.release / "SHA256SUMS").write_text("\n".join(sums) + "\n")
        s = self.reinstall((DOWN, DOWN), (DOWN,))
        self.answer(s, b"default file manager?", DOWN)
        self.answer(s, b"Launch Kern now?", DOWN)
        s.expect(b"could not be extracted")
        self.assertEqual(s.finish(), 1)
        self.assertTrue((self.w.lib / VERSION / "AppRun").is_file())
        self.assertEqual((self.w.lib / "install.env").read_bytes(), record)
        self.assertTrue((self.w.home / ".local" / "bin" / "kern").is_symlink())
        for p, b in files.items():
            self.assertEqual(p.read_bytes(), b)

    def test_running_kern_asks_retry_or_cancel(self) -> None:
        self.installed_old()
        (self.w.root / "running").touch()
        s = self.install()
        self.answer(s, b"Update to")
        s.expect(b"Kern is running")
        s.expect(b"Cancel")
        (self.w.root / "running").unlink()
        s.send(ENTER)  # Retry
        s.expect(b"updated to " + VERSION.encode())
        self.assertEqual(s.finish(), 0)

    def test_running_kern_cancel_changes_nothing(self) -> None:
        self.installed_old()
        (self.w.root / "running").touch()
        s = self.install()
        self.answer(s, b"Update to")
        self.answer(s, b"Kern is running", DOWN)
        self.assertEqual(s.finish(), 0)
        self.assertTrue((self.w.lib / OLD_VERSION).exists())

    def test_uninstall_remove_deletes_kern_dirs_and_restores_the_file_manager(self) -> None:
        s = self.install()
        self.answer(s, b"Install Kern for")
        self.answer(s, b"Customise Kern now?", DOWN)
        self.answer(s, b"default file manager?", UP)
        self.answer(s, b"Launch Kern now?", DOWN)
        self.assertEqual(s.finish(), 0)
        self.user_data()
        u = self.run_script(UNINSTALL)
        self.answer(u, b"Remove Kern", UP)
        self.answer(u, b"Settings, pins and recents", DOWN)
        u.expect(b"removed")
        self.assertEqual(u.finish(), 0)
        self.assertFalse(self.config.exists())
        self.assertFalse(self.state.exists())
        self.assertFalse(self.w.lib.exists())
        self.assertEqual((self.w.root / "default-fm").read_text().strip(), "org.kde.dolphin.desktop")

    def test_uninstall_keep_leaves_kern_dirs(self) -> None:
        self.assertEqual(self.unattended().returncode, 0)
        files = self.user_data()
        u = self.run_script(UNINSTALL)
        self.answer(u, b"Remove Kern", UP)
        self.answer(u, b"Settings, pins and recents")
        self.assertEqual(u.finish(), 0)
        self.assertFalse(self.w.lib.exists())
        for p, b in files.items():
            self.assertEqual(p.read_bytes(), b)

    def test_uninstall_no_changes_nothing(self) -> None:
        self.assertEqual(self.unattended().returncode, 0)
        u = self.run_script(UNINSTALL)
        self.answer(u, b"Remove Kern")
        self.assertEqual(u.finish(), 0)
        self.assertTrue(self.w.lib.exists())

    def test_ctrl_c_during_download_leaves_no_install_files(self) -> None:
        (self.w.root / "slow").touch()
        s = self.run_script(INSTALL)
        self.answer(s, b"Install Kern for")
        self.answer(s, b"Customise Kern now?", DOWN)
        self.answer(s, b"default file manager?", DOWN)
        self.answer(s, b"Launch Kern now?", DOWN)
        for _ in range(100):
            if (self.w.root / "copying").exists():
                break
            time.sleep(0.05)
        self.assertTrue((self.w.root / "copying").exists())
        s.send(CTRL_C)
        status = s.finish()
        self.assertNotEqual(status, 0)
        self.assertIn(SHOW_CURSOR, s.out)
        self.assertFalse(self.w.lib.exists())
        self.assertFalse((self.w.home / ".local" / "bin" / "kern").exists())
        leftovers = [p for p in self.w.root.iterdir() if p.name.startswith("kern-install.")]
        self.assertEqual(leftovers, [])

    def test_online_install_downloads_the_latest_release(self) -> None:
        r = subprocess.run(
            ["setsid", "bash", str(INSTALL), "--defaults"],
            capture_output=True, text=True, env=self.w.env(), stdin=subprocess.DEVNULL, timeout=60,
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"releases/download/{VERSION}/SHA256SUMS", self.w.calls())
        self.assertIn("--proto =https", self.w.calls())
        self.assertTrue((self.w.lib / VERSION / "AppRun").is_file())

    def test_online_tag_that_disagrees_with_the_assets_is_refused(self) -> None:
        (self.w.root / "latest-tag").write_text("0.1.0.0.9\n")
        r = subprocess.run(
            ["setsid", "bash", str(INSTALL), "--defaults"],
            capture_output=True, text=True, env=self.w.env(), stdin=subprocess.DEVNULL, timeout=60,
        )
        self.assertEqual(r.returncode, 1)
        self.assertIn("0.1.0.0.9", r.stderr)
        self.assertFalse(self.w.lib.exists())

    def test_defaults_without_a_terminal_installs(self) -> None:
        r = self.unattended()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.w.lib / "install.env").is_file())
        self.assertFalse((self.w.root / "applied.json").exists())
        self.assertNotIn("launch", self.w.calls())

    def test_no_terminal_without_defaults_exits_2(self) -> None:
        r = subprocess.run(
            ["setsid", "bash", str(INSTALL), "--from", str(self.w.release)],
            capture_output=True, text=True, env=self.w.env(), stdin=subprocess.DEVNULL, timeout=60,
        )
        self.assertEqual(r.returncode, 2)
        self.assertIn("--defaults", r.stderr)
        self.assertFalse(self.w.lib.exists())

    def test_foreign_kern_is_left_alone(self) -> None:
        bin_dir = self.w.home / ".local" / "bin"
        bin_dir.mkdir(parents=True)
        os.symlink("/elsewhere/kern", bin_dir / "kern")
        r = self.unattended()
        self.assertEqual(r.returncode, 1)
        self.assertIn(str(bin_dir / "kern"), r.stderr)
        self.assertEqual(os.readlink(bin_dir / "kern"), "/elsewhere/kern")
        self.assertFalse(self.w.lib.exists())

    def test_help(self) -> None:
        for script in (INSTALL, UNINSTALL):
            r = subprocess.run(["bash", str(script), "--help"], capture_output=True, text=True,
                               env=self.w.env(), timeout=60)
            self.assertEqual(r.returncode, 0)
            self.assertIn("--defaults", r.stdout)

    def test_unknown_option_exits_2(self) -> None:
        r = subprocess.run(["bash", str(INSTALL), "--frobnicate"], capture_output=True, text=True,
                           env=self.w.env(), timeout=60)
        self.assertEqual(r.returncode, 2)


class Build(unittest.TestCase):
    def test_built_scripts_match_their_sources(self) -> None:
        r = subprocess.run([str(INSTALLER / "build.sh"), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    sys.exit(unittest.main())
