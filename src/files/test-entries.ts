// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { EntryKind, WireEntry } from "../ipc";

// Builders for tests: entries as list_dir sends them.
export function entry(name: string, over: Partial<WireEntry> = {}, parent = "/d"): WireEntry {
  return {
    path: { k: "Utf8", v: `${parent}/${name}` },
    name,
    kind: "file",
    target_is_dir: false,
    len: 0,
    modified_ms: null,
    hidden: name.startsWith("."),
    mime: "application/octet-stream",
    ...over,
  };
}

export function dir(name: string, over: Partial<WireEntry> = {}): WireEntry {
  return entry(name, { kind: "dir" satisfies EntryKind, target_is_dir: true, ...over });
}
