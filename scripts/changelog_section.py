#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
"""Print the body of the `## [<label>]` section of CHANGELOG.md.

Usage: changelog_section.py [--since <older-label>] <label> [changelog-path]

Without --since, the header is matched literally at the start of a line, so a
label's dots are not wildcards. The body runs to the next `## [` header or the
end of the file, with surrounding blank lines removed.

With --since, the output covers every version section newer than <older-label>
and no newer than <label>, in the order the file lists them (newest first).
Versions compare numerically, part by part, so 0.1.10.0 is newer than 0.1.9.0
and a label with no section of its own, such as a version that was never cut,
simply contributes nothing. Sections whose header is not a four-part version,
such as `[Unreleased]`, are ignored. A single matching section prints as its
body alone, as without --since; several print each under their own header line.

Exit status 1 when <label> has no section or an empty one, so a release is never
published with empty notes. Exit status 2 for a usage error, including a
--since label that is not older than <label>.
"""

import argparse
import re
import sys

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+\.\d+$")
SECTION_PREFIX = "## ["


def trim_blank_edges(body: list[str]) -> list[str]:
    """Return `body` without leading and trailing blank lines."""
    start, end = 0, len(body)
    while start < end and not body[start].strip():
        start += 1
    while end > start and not body[end - 1].strip():
        end -= 1
    return body[start:end]


def join_lines(lines: list[str]) -> str:
    return "".join(f"{line}\n" for line in lines)


def extract(text: str, label: str) -> str:
    """Return the body of the section for `label`, or "" if absent or empty."""
    header = f"## [{label}]"
    body: list[str] = []
    inside = False
    for line in text.splitlines():
        if inside:
            if line.startswith(SECTION_PREFIX):
                break
            body.append(line)
        elif line.startswith(header):
            inside = True
    return join_lines(trim_blank_edges(body))


def version_key(label: str) -> tuple[int, ...] | None:
    """Return the numeric parts of a four-part version label, else None."""
    if not VERSION_RE.match(label):
        return None
    return tuple(int(part) for part in label.split("."))


def sections(text: str) -> list[tuple[str, str, list[str]]]:
    """Return (label, header line, body lines) for every `## [` section."""
    found: list[tuple[str, str, list[str]]] = []
    for line in text.splitlines():
        if line.startswith(SECTION_PREFIX):
            close = line.find("]", len(SECTION_PREFIX))
            label = line[len(SECTION_PREFIX):close] if close != -1 else ""
            found.append((label, line, []))
        elif found:
            found[-1][2].append(line)
    return found


def extract_since(text: str, label: str, since: str) -> str:
    """Return the sections newer than `since` up to and including `label`.

    "" when `label` has no non-empty section of its own.
    """
    newest, oldest = version_key(label), version_key(since)
    if newest is None or oldest is None:
        raise ValueError("labels must be four-part versions")
    if oldest >= newest:
        raise ValueError(f"{since} is not older than {label}")
    wanted: list[tuple[str, str, list[str]]] = []
    own_section_has_body = False
    for found_label, header, body in sections(text):
        key = version_key(found_label)
        if key is None or not (oldest < key <= newest):
            continue
        trimmed = trim_blank_edges(body)
        if not trimmed:
            continue
        if found_label == label:
            own_section_has_body = True
        wanted.append((found_label, header, trimmed))
    if not own_section_has_body:
        return ""
    if len(wanted) == 1:
        return join_lines(wanted[0][2])
    return "\n".join(join_lines([header, "", *body]) for _, header, body in wanted)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="changelog_section.py",
        description="Print a CHANGELOG.md section, or the range of sections after an older version.",
    )
    parser.add_argument("--since", metavar="OLDER_LABEL", help="also include every section newer than this version")
    parser.add_argument("label")
    parser.add_argument("path", nargs="?", default="CHANGELOG.md")
    return parser.parse_args(argv[1:])


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        with open(args.path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        print(f"cannot read {args.path}: {e}", file=sys.stderr)
        return 1
    if args.since is None:
        body = extract(text, args.label)
    else:
        try:
            body = extract_since(text, args.label, args.since)
        except ValueError as e:
            print(f"changelog_section.py: {e}", file=sys.stderr)
            return 2
    if not body:
        print(f"no non-empty section '## [{args.label}]' in {args.path}", file=sys.stderr)
        return 1
    sys.stdout.write(body)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
