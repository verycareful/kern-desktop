# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

"""The installer's terminal UI (installer/ui.sh), driven through a pty.

Each test runs a small bash program that sources ui.sh, asks one question
and writes `RESULT=<answer>` to the terminal, then sends keys as a user
would.
"""

import os
import pty
import select
import signal
import sys
import termios
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "installer" / "ui.sh"
LOGO = ROOT / "installer" / "logo.sh"

UP = b"\x1b[A"
DOWN = b"\x1b[B"
ENTER = b"\r"
CTRL_C = b"\x03"
SHOW_CURSOR = b"\x1b[?25h"
# Long enough for bash to start on a loaded machine; a passing test waits
# only until its RESULT line.
BOUND_S = 10.0


class Session:
    """A bash program on a pty: send keys, read everything it draws."""

    def __init__(self, program: str, env: dict | None = None) -> None:
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.execve(
                "/bin/bash",
                ["bash", "--noprofile", "--norc", "-c", program],
                {"PATH": os.environ["PATH"], "TERM": "xterm-256color", **(env or {})},
            )
        self.out = b""
        self.seen = 0
        self.status: int | None = None

    def expect(self, needle: bytes) -> None:
        """Waits for `needle` after the last one expected, so a prompt
        drawn twice is told apart from the next one."""
        end = time.monotonic() + BOUND_S
        while self.out.find(needle, self.seen) < 0 and time.monotonic() < end:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if r:
                try:
                    chunk = os.read(self.fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                self.out += chunk
        at = self.out.find(needle, self.seen)
        if at < 0:
            raise AssertionError(f"{needle!r} not drawn; output: {self.out[self.seen:]!r}")
        self.seen = at + len(needle)

    def read_until(self, needle: bytes) -> bytes:
        end = time.monotonic() + BOUND_S
        while needle not in self.out and time.monotonic() < end:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if r:
                try:
                    chunk = os.read(self.fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                self.out += chunk
        return self.out

    def send(self, *keys: bytes) -> None:
        for k in keys:
            os.write(self.fd, k)
            # The menu redraws between keys; separate reads keep an escape
            # sequence from being split across two of them.
            time.sleep(0.05)

    def attrs(self) -> list:
        return termios.tcgetattr(self.fd)

    def finish(self) -> int:
        """Waits for the program to exit, keeping what it drew last."""
        end = time.monotonic() + BOUND_S
        st = None
        while st is None and time.monotonic() < end:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                st = status
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if r:
                try:
                    self.out += os.read(self.fd, 4096)
                except OSError:
                    pass
        if st is None:
            os.kill(self.pid, signal.SIGKILL)
            _, st = os.waitpid(self.pid, 0)
            raise AssertionError(f"program did not exit: {self.out!r}")
        os.close(self.fd)
        self.status = os.waitstatus_to_exitcode(st)
        return self.status

    def result(self) -> str:
        self.read_until(b"RESULT=")
        self.read_until(b"\n")
        tail = self.out.split(b"RESULT=", 1)
        if len(tail) < 2:
            raise AssertionError(f"no RESULT in output: {self.out!r}")
        return tail[1].split(b"\r", 1)[0].split(b"\n", 1)[0].decode()


def program(body: str) -> str:
    return f"source {UI}; ui_init; {body}; printf 'RESULT=%s\\n' \"$R\" >&3"


class Menu(unittest.TestCase):
    def ask4(self) -> Session:
        s = Session(program('ui_menu R 0 "Pick one" alpha beta gamma delta'))
        s.read_until(b"delta")
        return s

    def test_down_down_enter_picks_index_2(self) -> None:
        s = self.ask4()
        s.send(DOWN, DOWN, ENTER)
        self.assertEqual(s.result(), "2")
        self.assertEqual(s.finish(), 0)

    def test_up_at_the_top_stays_at_0(self) -> None:
        s = self.ask4()
        s.send(UP, UP, ENTER)
        self.assertEqual(s.result(), "0")
        s.finish()

    def test_down_at_the_bottom_stays_at_the_last(self) -> None:
        s = self.ask4()
        s.send(DOWN, DOWN, DOWN, DOWN, DOWN, ENTER)
        self.assertEqual(s.result(), "3")
        s.finish()

    def test_j_and_k_move(self) -> None:
        s = self.ask4()
        s.send(b"j", b"j", b"j", b"k", ENTER)
        self.assertEqual(s.result(), "2")
        s.finish()

    def test_default_index_is_highlighted_first(self) -> None:
        s = Session(program('ui_menu R 2 "Pick one" alpha beta gamma delta'))
        s.read_until(b"delta")
        s.send(ENTER)
        self.assertEqual(s.result(), "2")
        s.finish()


class YesNo(unittest.TestCase):
    def test_enter_takes_default_no(self) -> None:
        s = Session(program('ui_yesno R n "Launch Kern now?"'))
        s.read_until(b"No")
        s.send(ENTER)
        self.assertEqual(s.result(), "n")
        s.finish()

    def test_enter_takes_default_yes(self) -> None:
        s = Session(program('ui_yesno R y "Launch Kern now?"'))
        s.read_until(b"No")
        s.send(ENTER)
        self.assertEqual(s.result(), "y")
        s.finish()

    def test_down_from_yes_is_no(self) -> None:
        s = Session(program('ui_yesno R y "Launch Kern now?"'))
        s.read_until(b"No")
        s.send(DOWN, ENTER)
        self.assertEqual(s.result(), "n")
        s.finish()


class Text(unittest.TestCase):
    def test_empty_line_takes_default(self) -> None:
        s = Session(program('ui_text R "/home/a" "Folder"'))
        s.read_until(b"Folder")
        s.send(ENTER)
        self.assertEqual(s.result(), "/home/a")
        s.finish()

    def test_typed_line_is_taken_as_is(self) -> None:
        s = Session(program('ui_text R "" "Folder"'))
        s.read_until(b"Folder")
        s.send(b"/srv/my files", ENTER)
        self.assertEqual(s.result(), "/srv/my files")
        s.finish()


class Interrupt(unittest.TestCase):
    def test_ctrl_c_restores_the_terminal(self) -> None:
        s = Session(program('ui_menu R 0 "Pick one" alpha beta'))
        s.read_until(b"beta")
        s.send(CTRL_C)
        s.read_until(SHOW_CURSOR)
        # Read the line discipline before the pty closes.
        time.sleep(0.2)
        lflag = s.attrs()[3]
        status = s.finish()
        self.assertIn(SHOW_CURSOR, s.out)
        self.assertTrue(lflag & termios.ECHO, "echo left off")
        self.assertTrue(lflag & termios.ICANON, "canonical mode left off")
        # Killed by SIGINT, so a calling shell sees the interrupt (130).
        self.assertEqual(status, -signal.SIGINT)


class NoTerminal(unittest.TestCase):
    def test_ui_init_without_a_tty_fails_with_2(self) -> None:
        import subprocess

        r = subprocess.run(
            ["setsid", "bash", "--noprofile", "--norc", "-c", f"source {UI}; ui_init"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            env={"PATH": os.environ["PATH"]},
        )
        self.assertEqual(r.returncode, 2)
        self.assertIn(b"--defaults", r.stderr)


class Logo(unittest.TestCase):
    def test_logo_fits_60_columns_and_16_rows(self) -> None:
        s = Session(f"source {UI}; source {LOGO}; ui_init; show_logo; printf 'RESULT=done\\n' >&3",
                    env={"NO_COLOR": "1"})
        s.result()
        s.finish()
        drawn = s.out.split(b"RESULT=", 1)[0].decode()
        rows = [r for r in drawn.replace("\r", "").split("\n") if "█" in r]
        self.assertGreaterEqual(len(rows), 8)
        self.assertLessEqual(len(rows), 16)
        self.assertTrue(all(len(r) <= 60 for r in rows))
        self.assertNotIn("\x1b[38", drawn, "NO_COLOR still coloured")


if __name__ == "__main__":
    sys.exit(unittest.main())
