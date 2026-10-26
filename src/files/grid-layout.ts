// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Card geometry in CSS pixels. The picture area is 128 wide (the cache's
// "normal" thumbnail size) by 96 (handoff README: the card's top area is
// 92 tall; 96 keeps a 4:3 box for photographs); the text under it takes 52.
export const CARD = { width: 152, height: 148, gap: 12, padding: 12 } as const;
/** How many cards fit in a row of the given width; at least one. */
export function columnsFor(width: number): number {
  return Math.max(1, Math.floor((width - 2 * CARD.padding + CARD.gap) / (CARD.width + CARD.gap)));
}

/** Pixel heights of a list row. 40 holds the 28 px badge with 6 px above and below; compact trims that to 32. */
export const ROW_HEIGHT = { cozy: 40, compact: 32 } as const;
