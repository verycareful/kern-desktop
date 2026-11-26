// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PdfLayout } from "../ipc";

// The layout a click on a page of the grid goes back to: the one the grid replaced. The layout is
// one setting every PDF follows, so this is a fact of the whole window. It is the continuous scroll
// until the grid has replaced another layout. The viewer reports each layout it shows.

let seen: PdfLayout | null = null;
let before: PdfLayout = "scroll";

/** Records that `layout` is the one in use now. */
export function noteLayout(layout: PdfLayout): void {
  if (layout === "grid" && seen !== null && seen !== "grid") before = seen;
  seen = layout;
}

/** The layout that was in use before the grid; never the grid itself. */
export const layoutBeforeGrid = (): PdfLayout => before;
