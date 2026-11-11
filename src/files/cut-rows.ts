// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

import { pathKey, type WirePath } from "../ipc";
import { within } from "../shell/place-nav";
import type { Row } from "./tree";

/**
 * The keys of the tree rows that are cut: a row whose own path is cut, and every row listed below
 * a cut folder, however deep. Rows come in tree order, so what lies below a folder is the run of
 * rows deeper than it. When the root is itself cut, or lies inside a cut folder, every row is cut.
 */
export function cutRowKeys(
  rows: readonly Row[],
  root: WirePath,
  cutKeys: ReadonlySet<string>,
  cutPaths: readonly WirePath[]
): Set<string> {
  const out = new Set<string>();
  if (cutKeys.size === 0) return out;
  const everything = cutPaths.some((c) => within(c, root, true));
  // Depth of the outermost cut folder whose rows are being walked, or null outside one.
  let below: number | null = null;
  for (const row of rows) {
    if (below !== null && row.depth <= below) below = null;
    const inside = everything || below !== null;
    if (row.kind !== "entry") {
      if (inside) out.add(row.key);
      continue;
    }
    const own = cutKeys.has(pathKey(row.entry.path));
    if (own || inside) out.add(row.key);
    if (own && row.folder && !row.loop && below === null) below = row.depth;
  }
  return out;
}
