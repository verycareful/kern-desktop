// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Which revision of a page is on the screen. An edit to a page is answered by the engine before the
// page's new picture is drawn, so what a tool put on show itself (a line being drawn) has to stay
// until the picture that holds the change is there, or it vanishes for the time the page takes to
// draw and comes back. The page's canvases say here when a revision is painted; a tool waits here.

const painted = new Map<string, number>();
const waiting = new Map<string, { revision: number; resolve: () => void }[]>();

const keyOf = (handle: number, page: number): string => `${handle}:${page}`;

/** The page's picture is on screen at `revision` (or the picture failed, which is shown in its place). */
export function markPainted(handle: number, page: number, revision: number): void {
  const key = keyOf(handle, page);
  if (revision > (painted.get(key) ?? -1)) painted.set(key, revision);
  const list = waiting.get(key);
  if (!list) return;
  const rest = list.filter((w) => {
    if (w.revision > revision) return true;
    w.resolve();
    return false;
  });
  if (rest.length > 0) waiting.set(key, rest);
  else waiting.delete(key);
}

/** Resolves when the page has been painted at `revision` or later; at once when it has been. */
export function whenPainted(handle: number, page: number, revision: number): Promise<void> {
  if ((painted.get(keyOf(handle, page)) ?? -1) >= revision) return Promise.resolve();
  return new Promise((resolve) => {
    const key = keyOf(handle, page);
    waiting.set(key, [...(waiting.get(key) ?? []), { revision, resolve }]);
  });
}

/** The document is closed: nothing will be painted for it, so nothing waits. */
export function forgetPaint(handle: number): void {
  const prefix = `${handle}:`;
  for (const key of [...painted.keys()]) if (key.startsWith(prefix)) painted.delete(key);
  for (const [key, list] of [...waiting.entries()]) {
    if (!key.startsWith(prefix)) continue;
    for (const w of list) w.resolve();
    waiting.delete(key);
  }
}
