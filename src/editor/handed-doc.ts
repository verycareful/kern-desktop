// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { LineEnding, WireReadOnly, WireStamp } from "../ipc";

// A document handed from one window to another (design 4.4): Home in a
// document window gives it to a tab of the main window, and "Move to new
// window" gives a tab to a window of its own. The backend passes it through
// untouched (windows.rs move_doc_to_main, detach_doc), so the receiving editor
// starts from exactly what the user saw, unsaved edits included, and the file
// is not read again.

export interface HandedDoc {
  /** The text as shown, unsaved edits included, with "\n" line endings. */
  text: string;
  /** The text as opened or last saved: what the shown text is dirty against. */
  saved: string;
  /** The stamp of the file as opened or last saved. */
  stamp: WireStamp;
  ending: LineEnding;
  bom: boolean;
  read_only: WireReadOnly | null;
}

const isReadOnly = (v: unknown): v is WireReadOnly =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as WireReadOnly).kind === "string" &&
  typeof (v as WireReadOnly).detail === "string";

/**
 * The handed document in `value`, or null when it is not one. It arrives as JSON from another
 * window, so every field is checked: a document taken on with a wrong field could be saved
 * wrong.
 */
export function parseHanded(value: unknown): HandedDoc | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== "string" || typeof v.saved !== "string") return null;
  if (typeof v.stamp !== "string") return null;
  if (v.ending !== "lf" && v.ending !== "crlf") return null;
  if (typeof v.bom !== "boolean") return null;
  if (v.read_only !== null && !isReadOnly(v.read_only)) return null;
  return {
    text: v.text,
    saved: v.saved,
    stamp: v.stamp,
    ending: v.ending,
    bom: v.bom,
    read_only: v.read_only,
  };
}
