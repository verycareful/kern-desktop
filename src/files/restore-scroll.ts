// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useLayoutEffect, useRef } from "react";

/**
 * Puts a scroller back at the offset a tab view kept, once, when the list
 * mounts (or, with `ready` false at first, when it becomes ready: a grid is
 * laid out only once it has measured its width). The offset is held within the
 * scrollable range of what is listed now: entries that went away while the tab
 * was not shown leave it shorter than it was.
 */
export function useRestoredScroll(
  scroller: React.RefObject<HTMLElement | null>,
  top: number,
  ready = true
): void {
  const done = useRef(false);
  // The offset asked for at mount: the view's kept state is dropped once it has listed.
  const wanted = useRef(top);
  useLayoutEffect(() => {
    const el = scroller.current;
    // Once only: a later relist or resize must not pull the list back.
    if (!ready || done.current || !el) return;
    done.current = true;
    const at = wanted.current;
    if (at > 0) el.scrollTop = Math.min(at, Math.max(0, el.scrollHeight - el.clientHeight));
  }, [ready, scroller]);
}
