// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { actions as table, type Action } from "../keys/actions";

// The keyboard tips of the welcome pane, read from the action table (keys/actions.ts), never listed
// by hand: a key that changes or goes changes here with it.

/** How long a tip or fact stays before the next: long enough to read a line twice. */
export const ROTATE_MS = 12_000;

export interface Tip {
  /** The action's id. */
  id: string;
  label: string;
  /** The shortcut, as the table spells it ("Ctrl+S"). */
  key: string;
}

/** The kinds of action worth a tip: of the window and the document, not of one list or menu. */
const TIP_KINDS: readonly Action["when"][] = ["any", "doc", "folder"];

/**
 * One tip for each shortcut of the table that starts with Ctrl or Alt or is a function key: the
 * plain movement keys (arrows, Enter, Delete) are not tips. A key bound in several contexts is
 * one tip.
 */
export function tipsFromActions(list: readonly Action[] = table): Tip[] {
  const seen = new Set<string>();
  const tips: Tip[] = [];
  for (const a of list) {
    if (!TIP_KINDS.includes(a.when)) continue;
    const key = a.keys.find((k) => /^(Ctrl|Alt)\+|^F\d+$/.test(k));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tips.push({ id: a.id, label: a.label, key });
  }
  return tips;
}
