// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  entryOf,
  pdfSave,
  textCheck,
  toWireError,
  type PdfExpect,
  type PdfHandle,
  type WireEntry,
  type WireError,
  type WirePath,
  type WireStamp,
} from "../ipc";
import { pdfDate } from "./pdf-date";

// One write of a PDF. The engine writes the opened bytes and one update to the path, atomically,
// as far as `expect` allows, and never replaces a file it was not told it may.

export type SaveFailure =
  /** The file at the path is not the one that was opened or last saved. Nothing was written. */
  | "external-modification"
  /** `expect` was nothing and something is at the path. Nothing was written. */
  | "exists"
  | "other";

export type SaveResult =
  { ok: true; stamp: WireStamp } | { ok: false; error: WireError; kind: SaveFailure };

/** How a refusal of the engine is told apart by what the caller does next. */
export function saveFailure(error: WireError): SaveFailure {
  if (error.kind === "ExternalModification") return "external-modification";
  if (error.kind === "Exists") return "exists";
  return "other";
}

/**
 * Writes the document of `handle` to `path`. The PDF date is the app's clock, read here, since the
 * engine reads none. Never rejects: a refusal is the result.
 */
export async function runSave(
  handle: PdfHandle,
  path: WirePath,
  expect: PdfExpect,
  now: Date = new Date()
): Promise<SaveResult> {
  try {
    return { ok: true, stamp: await pdfSave(handle, path, expect, pdfDate(now)) };
  } catch (e) {
    const error = toWireError(e);
    return { ok: false, error, kind: saveFailure(error) };
  }
}

/** Whether opening refused because the file has to be saved as a compacted copy instead. */
export const needsCompactedCopy = (error: WireError | undefined): boolean =>
  error?.kind === "RebuiltNotEditable" || error?.kind === "RevisionNotEditable";

/**
 * What the file at `path` is, looked at while its stamp still says it is the one that was opened or
 * saved (before and after the look); null when that cannot be told. A rename changes the change
 * time of a file and so its stamp, though nothing in it: this is what the rename is compared with.
 */
export async function entryAtStamp(path: WirePath, stamp: WireStamp): Promise<WireEntry | null> {
  try {
    if ((await textCheck(path, stamp)) !== "same") return null;
    const entry = await entryOf(path);
    return (await textCheck(path, stamp)) === "same" ? entry : null;
  } catch {
    return null;
  }
}
