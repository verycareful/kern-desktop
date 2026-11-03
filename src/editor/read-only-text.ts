// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireReadOnly } from "../ipc";

// One sentence per reason a text file is shown but not saved
// (kernkraft_text::ReadOnly, as WireReadOnly names them). The sentence says
// what is wrong with the file and why Kern keeps its hands off it; `detail`,
// the backend's own words, follows where it says more than the sentence.

const SENTENCES: Record<string, string> = {
  NotUtf8:
    "This file is not valid UTF-8. Kern shows it with replacement characters and opens it read-only so the original bytes are not overwritten.",
  Utf16:
    "This file is UTF-16 text. Kern shows it but opens it read-only, because it saves only UTF-8.",
  MixedLineEndings:
    "This file mixes Windows and Unix line endings. Kern opens it read-only so none of them change.",
  TooLarge:
    "This file is too large to edit safely. Kern shows it read-only so a save cannot run out of memory.",
  OpenElsewhere:
    "This file is already open in another place, so this copy is read-only: two editors on one file would lose one of them. Save As keeps your changes in another file.",
  NoWritePermission:
    "You do not have permission to write this file. Kern opens it read-only; Save As keeps a copy elsewhere.",
};

/** The sentence for a reason, and its detail when the detail says more. */
export function readOnlyText(r: WireReadOnly): { sentence: string; detail: string | null } {
  const sentence = SENTENCES[r.kind];
  if (sentence === undefined) {
    // A reason this version does not know is still said, in the backend's words.
    return { sentence: `Kern opens this file read-only (${r.kind}).`, detail: r.detail || null };
  }
  const detail = r.detail.trim();
  return { sentence, detail: detail === "" ? null : detail };
}
