// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useState } from "react";

// The count behind the flash that tells the user a message they already see was raised again: the
// same failure twice looks like nothing happened unless the second one shows. A message that
// changes, or one shown after it was cleared, is new and does not flash (repeat-flash.tsx draws it).

/** What `watch` says, as text; empty when nothing is shown. */
function words(watch: unknown): string {
  if (watch === null || watch === undefined || watch === false) return "";
  if (Array.isArray(watch) && watch.length === 0) return "";
  return JSON.stringify(watch) ?? "";
}

/**
 * How many times `watch` has been replaced by a value that says the same as the one before. `watch`
 * is what a message is kept in (a state value or an array of them): a value rendered again is the
 * same value and is not a repeat, so it must be the state itself and not something made while
 * rendering.
 */
export function useRepeatFlash(watch: unknown): number {
  const [seen, setSeen] = useState({ watch, text: words(watch), flashes: 0 });
  if (seen.watch !== watch) {
    const text = words(watch);
    setSeen({
      watch,
      text,
      flashes: text !== "" && text === seen.text ? seen.flashes + 1 : seen.flashes,
    });
  }
  return seen.flashes;
}
