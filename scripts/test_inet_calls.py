# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
"""Tests for inet_calls.py. Run: python3 -I scripts/test_inet_calls.py

The cases are strace lines in the format of strace(1): a socket address is
`{sa_family=AF_..., ...}`, and with -f every line starts with the pid.
"""

import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import inet_calls  # noqa: E402

SCRIPT = os.path.join(HERE, "inet_calls.py")

AF_INET = '1201 connect(3, {sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("127.0.0.1")}, 16) = -1 ENETUNREACH (Network is unreachable)'
AF_INET6 = '1201 connect(4, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2001:db8::1", &sin6_addr), sin6_scope_id=0}, 28) = -1 ENETUNREACH (Network is unreachable)'
AF_UNIX = '1202 connect(5, {sa_family=AF_UNIX, sun_path="/run/user/1000/bus"}, 21) = 0'
AF_NETLINK = "1202 connect(6, {sa_family=AF_NETLINK, nl_pid=0, nl_groups=00000000}, 12) = 0"
SENDTO_INET = '1203 sendto(7, "\\0\\1\\1\\0\\0\\1\\0\\0\\0\\0\\0\\0", 12, MSG_NOSIGNAL, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("192.0.2.1")}, 16) = -1 ENETUNREACH (Network is unreachable)'
SENDTO_UNIX = '1203 sendto(8, "<14>kern", 8, MSG_NOSIGNAL, {sa_family=AF_UNIX, sun_path="/dev/log"}, 110) = 8'
SENDMSG_INET6 = '1204 sendmsg(9, {msg_name={sa_family=AF_INET6, sin6_port=htons(5353), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "ff02::fb", &sin6_addr), sin6_scope_id=0}, msg_namelen=28, msg_iov=[{iov_base="x", iov_len=1}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, 0) = 1'
SENDMSG_UNIX = "1204 sendmsg(10, {msg_name=NULL, msg_namelen=0, msg_iov=[{iov_base=\"l\\1\", iov_len=2}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, MSG_NOSIGNAL) = 2"


class Scan(unittest.TestCase):
    def inet(self, *lines: str) -> list[str]:
        return inet_calls.scan([line + "\n" for line in lines])[1]

    def test_ipv4_connect_is_found(self) -> None:
        self.assertEqual(self.inet(AF_INET), [AF_INET])

    def test_ipv6_connect_is_found(self) -> None:
        self.assertEqual(self.inet(AF_INET6), [AF_INET6])

    def test_unix_and_netlink_are_not_found(self) -> None:
        self.assertEqual(self.inet(AF_UNIX, AF_NETLINK, SENDTO_UNIX, SENDMSG_UNIX), [])

    def test_sendto_and_sendmsg_are_found(self) -> None:
        self.assertEqual(self.inet(SENDTO_INET, SENDMSG_INET6), [SENDTO_INET, SENDMSG_INET6])

    def test_only_the_inet_lines_are_found_among_local_ones(self) -> None:
        self.assertEqual(self.inet(AF_UNIX, AF_INET, AF_NETLINK, AF_INET6), [AF_INET, AF_INET6])

    def test_pid_prefix_forms(self) -> None:
        bracket = "[pid  77] " + AF_INET.split(" ", 1)[1]
        bare = AF_INET.split(" ", 1)[1]
        self.assertEqual(self.inet(bracket), [bracket])
        self.assertEqual(self.inet(bare), [bare])

    def test_unfinished_call_is_found_and_its_resume_is_not_counted_twice(self) -> None:
        first = "[pid 9] connect(3, {sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr(\"127.0.0.1\")}, 16 <unfinished ...>"
        resumed = "[pid 9] <... connect resumed>) = -1 ENETUNREACH (Network is unreachable)"
        calls, found = inet_calls.scan([first + "\n", resumed + "\n"])
        self.assertEqual((calls, found), (1, [first]))

    def test_address_text_inside_a_string_is_not_an_address(self) -> None:
        line = '1205 sendto(3, "sa_family=AF_INET", 17, 0, {sa_family=AF_UNIX, sun_path="/x"}, 110) = 17'
        self.assertEqual(self.inet(line), [])

    def test_other_calls_are_ignored(self) -> None:
        other = '1206 write(2, "connect(3, {sa_family=AF_INET}", 30) = 30'
        self.assertEqual(inet_calls.scan([other + "\n"]), (0, []))

    def test_family_prefix_only_matches_inet_and_inet6(self) -> None:
        line = "1207 connect(3, {sa_family=AF_INETX}, 2) = -1 EAFNOSUPPORT (Address family not supported by protocol)"
        self.assertEqual(self.inet(line), [])


class Cli(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def run_on(self, text: str, *extra: str) -> subprocess.CompletedProcess:
        path = os.path.join(self._tmp.name, "strace.log")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return subprocess.run(
            [sys.executable, "-I", SCRIPT, *extra, path], capture_output=True, text=True, check=False
        )

    def test_clean_log_exits_0(self) -> None:
        r = self.run_on("\n".join([AF_UNIX, AF_NETLINK, SENDTO_UNIX]) + "\n")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("checked 3 calls, 0 with an inet address", r.stdout)

    def test_inet_log_exits_1_and_prints_the_line(self) -> None:
        r = self.run_on("\n".join([AF_UNIX, AF_INET]) + "\n")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn(AF_INET, r.stdout)
        self.assertNotIn(AF_UNIX, r.stdout)

    def test_empty_log_with_a_minimum_exits_2(self) -> None:
        r = self.run_on("", "--min-calls", "1")
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)

    def test_empty_log_without_a_minimum_exits_0(self) -> None:
        self.assertEqual(self.run_on("").returncode, 0)

    def test_minimum_is_met(self) -> None:
        self.assertEqual(self.run_on(AF_UNIX + "\n", "--min-calls", "1").returncode, 0)

    def test_missing_log_exits_2(self) -> None:
        r = subprocess.run(
            [sys.executable, "-I", SCRIPT, os.path.join(self._tmp.name, "absent.log")],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(r.returncode, 2)

    def test_no_argument_exits_2(self) -> None:
        r = subprocess.run([sys.executable, "-I", SCRIPT], capture_output=True, text=True, check=False)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
