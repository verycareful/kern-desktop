// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// A list of short notes a view keeps until the user dismisses them. The same words raised again
// are not listed twice; they are counted, so the view can flash (repeat-flash.tsx) and the user
// sees the second failure was not lost.

export interface NoteList {
  texts: readonly string[];
  /** How many times words already listed were raised again. */
  repeats: number;
}

export const NO_NOTES: NoteList = { texts: [], repeats: 0 };

/** `list` with `text` added, or with the repeat counted when `text` is listed already. */
export function raiseNote(list: NoteList, text: string): NoteList {
  return list.texts.includes(text)
    ? { texts: list.texts, repeats: list.repeats + 1 }
    : { texts: [...list.texts, text], repeats: list.repeats };
}
