// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { displayPath, type OpKind, type WirePath, type WireReport } from "../ipc";

// The words of the file operations: what a running one says it is doing, what
// the heading of its report is, and what the status bar says when it ended
// without anything to report. Names are shown as text (U+FFFD for bytes that
// are not UTF-8) and never turned back into paths.

/** The last component of a path, or "/" for the root. */
export function baseName(p: WirePath): string {
  const t = displayPath(p).replace(/\/+$/, "");
  return t.slice(t.lastIndexOf("/") + 1) || "/";
}

export const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** `notes.md` for one item, `3 items` for several. */
export function itemsText(paths: readonly WirePath[]): string {
  const [only] = paths;
  return paths.length === 1 && only ? baseName(only) : plural(paths.length, "item", "items");
}

/** Up to this many names are listed in a question; more are counted, with the first few named. */
export const NAMED_UP_TO = 3;

/** `a, b, c` for a few names; `5 items, including a, b, c` for more. */
export function namesText(names: readonly string[]): string {
  if (names.length <= NAMED_UP_TO) return names.join(", ");
  return `${plural(names.length, "item", "items")}, including ${names.slice(0, NAMED_UP_TO).join(", ")}`;
}

export interface OpLabels {
  /** What the progress panel says while it runs. */
  running: string;
  /** The heading of its report. */
  title: string;
  /** The status bar's message when it ended cleanly. */
  done(report: WireReport | null): string;
}

export function opLabels(kind: OpKind, sources: readonly WirePath[], dest?: WirePath): OpLabels {
  const items = itemsText(sources);
  const to = dest ? baseName(dest) : "";
  // A clean end is told by what was done, which can differ from what was asked for.
  const counted = (r: WireReport | null) =>
    r && !(sources.length === 1 && r.done.length === 1)
      ? plural(r.done.length, "item", "items")
      : items;
  switch (kind) {
    case "copy":
      return {
        running: `Copying ${items} to ${to}`,
        title: `Copy of ${items} to ${dest ? displayPath(dest) : ""}`,
        done: (r) => `Copied ${counted(r)} to ${to}`,
      };
    case "move":
      return {
        running: `Moving ${items} to ${to}`,
        title: `Move of ${items} to ${dest ? displayPath(dest) : ""}`,
        done: (r) => `Moved ${counted(r)} to ${to}`,
      };
    case "trash":
      return {
        running: `Moving ${items} to the Trash`,
        title: `Move ${items} to the Trash`,
        done: (r) => `Moved ${counted(r)} to the Trash`,
      };
    case "delete":
      return {
        running: `Deleting ${items}`,
        title: `Permanent delete of ${items}`,
        done: (r) => `Deleted ${counted(r)}`,
      };
    case "empty_trash":
      return {
        running: "Emptying the Trash",
        title: "Empty Trash",
        done: () => "Emptied the Trash",
      };
  }
}
