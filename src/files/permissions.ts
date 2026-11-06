// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Permission bits (st_mode & 07777, kernkraft-fs Entry::mode) as `ls -l`
// shows them and as the octal number chmod takes (POSIX.1-2017, ls,
// "The file mode written under the -l option"): r, w and x for owner, group
// and other; setuid and setgid show as s in the owner's and the group's
// execute place (S when that execute bit is off); the sticky bit shows as t
// in other's (T when other cannot execute).

const S_ISUID = 0o4000;
const S_ISGID = 0o2000;
const S_ISVTX = 0o1000;

function triplet(bits: number, special: boolean, mark: "s" | "t"): string {
  const r = bits & 4 ? "r" : "-";
  const w = bits & 2 ? "w" : "-";
  const exec = (bits & 1) !== 0;
  const x = special ? (exec ? mark : mark.toUpperCase()) : exec ? "x" : "-";
  return r + w + x;
}

/** `rwxr-x---` for 0750. */
export function modeText(mode: number): string {
  return (
    triplet((mode >> 6) & 7, (mode & S_ISUID) !== 0, "s") +
    triplet((mode >> 3) & 7, (mode & S_ISGID) !== 0, "s") +
    triplet(mode & 7, (mode & S_ISVTX) !== 0, "t")
  );
}

/** The four-digit octal form, `0750` or `1777`. */
export function modeOctal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}
