// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/** The suggested path of a compacted copy: the file's own, with `_compacted` before `.pdf`. */
export function compactedName(name: string): string {
  return name.toLowerCase().endsWith(".pdf")
    ? `${name.slice(0, -4)}_compacted${name.slice(-4)}`
    : `${name}_compacted.pdf`;
}
