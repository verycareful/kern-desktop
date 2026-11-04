#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
"""Find calls that use an IPv4 or IPv6 address in an strace log.

Usage: inet_calls.py [--min-calls N] <strace-log>

The log comes from `strace -f -e trace=connect,sendto,sendmsg,sendmmsg`. A
call counts when its socket address has family AF_INET or AF_INET6 (strace
prints it as `sa_family=AF_INET`, strace(1) "Socket addresses"). Unix-domain
(AF_UNIX) and netlink (AF_NETLINK) addresses are local and do not count.
Quoted strings are dropped before matching, so data a call carries cannot
look like an address.

Prints each offending line, then a summary line. Exit status: 0 no call used an
inet address, 1 at least one did, 2 the log could not be read or holds fewer
than --min-calls traced calls (a log that is empty because strace did not run
must not read as clean).
"""

import re
import sys

# `connect(...)`, optionally after a pid in the forms strace -f writes:
# `1234 ` (to a file) or `[pid  1234] ` (to the terminal).
CALL = re.compile(r"^(?:\[pid\s+\d+\]\s+|\d+\s+)?(?:connect|sendto|sendmsg|sendmmsg)\(")
QUOTED = re.compile(r'"(?:[^"\\]|\\.)*"(?:\.\.\.)?')
INET = re.compile(r"\bsa_family=AF_INET6?\b")


def scan(lines: list[str]) -> tuple[int, list[str]]:
    """Return how many traced calls the lines hold and which of them used an inet address."""
    calls = 0
    found: list[str] = []
    for line in lines:
        if not CALL.match(line):
            continue
        calls += 1
        if INET.search(QUOTED.sub('""', line)):
            found.append(line.rstrip("\n"))
    return calls, found


def main(argv: list[str]) -> int:
    min_calls = 0
    args = argv[1:]
    if len(args) == 3 and args[0] == "--min-calls" and args[1].isdigit():
        min_calls = int(args[1])
        args = args[2:]
    if len(args) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        with open(args[0], encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError as e:
        print(f"error: cannot read {args[0]}: {e}", file=sys.stderr)
        return 2
    calls, found = scan(lines)
    for line in found:
        print(line)
    print(f"checked {calls} calls, {len(found)} with an inet address")
    if calls < min_calls:
        print(f"error: fewer than {min_calls} traced calls: strace may not have run", file=sys.stderr)
        return 2
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
