// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { displayPath, type WirePath } from "../ipc";
import { baseName } from "../ops/labels";

/** `path` for display, with the home folder as `~`. */
export function homeRelative(path: WirePath, home: WirePath | null): string {
  const text = displayPath(path);
  if (!home) return text;
  const h = displayPath(home).replace(/\/+$/, "");
  if (text === h) return "~";
  return text.startsWith(`${h}/`) ? `~${text.slice(h.length)}` : text;
}

/**
 * `path` as it lies below `root` (`src/pdf` for `/work/kern/src/pdf` under `/work/kern`), and the
 * root's own name for the root itself; null when `path` is not inside `root`.
 */
export function rootRelative(path: WirePath, root: WirePath): string | null {
  const text = displayPath(path);
  const base = displayPath(root).replace(/\/+$/, "");
  if (text === base || text === `${base}/`) return baseName(root);
  return text.startsWith(`${base}/`) ? text.slice(base.length + 1) : null;
}
