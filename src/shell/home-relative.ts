// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { displayPath, type WirePath } from "../ipc";

/** `path` for display, with the home folder as `~`. */
export function homeRelative(path: WirePath, home: WirePath | null): string {
  const text = displayPath(path);
  if (!home) return text;
  const h = displayPath(home).replace(/\/+$/, "");
  if (text === h) return "~";
  return text.startsWith(`${h}/`) ? `~${text.slice(h.length)}` : text;
}
