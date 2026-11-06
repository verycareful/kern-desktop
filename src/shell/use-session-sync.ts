// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useState } from "react";
import { sessionPut, toWireError, type SessionTab, type WireError, type WirePath } from "../ipc";
import { useLayout } from "../store/layout";
import { useTabs, type Tab } from "../store/tabs";

// Keeps this window's tabs in session.json (session.rs), so the next launch opens the window
// again as it is. Once the window has applied what was queued for it, it reports its tabs, and
// again whenever they or (in an editor window) its folder change. One report is sent at a time and
// only the latest state waits behind it, so an older state never lands after a newer one. A report
// that fails is said in the window, and the next change sends the state again.

/** The windows that keep their tabs: the main window, editor windows and document windows. */
export type SessionMode = "main" | "editor" | "doc";

export interface SessionSnapshot {
  root: WirePath | null;
  tabs: SessionTab[];
  active: number | null;
}

function sessionTab(tab: Tab): SessionTab {
  switch (tab.kind) {
    case "folder":
      return { kind: "folder", path: tab.path };
    case "doc":
      return { kind: "doc", path: tab.path };
    case "trash":
      return { kind: "trash" };
    case "documents":
      return { kind: "documents" };
  }
}

/** The tabs as the session keeps them; `root` is the editor window's folder, else null. */
export function sessionSnapshot(
  tabs: Tab[],
  activeId: string | null,
  root: WirePath | null
): SessionSnapshot {
  const i = tabs.findIndex((t) => t.id === activeId);
  return { root, tabs: tabs.map(sessionTab), active: i < 0 ? null : i };
}

export interface SessionSync {
  /** The last report that failed, until one succeeds or it is dismissed. */
  error: WireError | null;
  dismiss(): void;
}

/** Reports this window's tabs once `ready`; `mode` null (the Settings window) reports nothing. */
export function useSessionSync(mode: SessionMode | null, ready: boolean): SessionSync {
  const [error, setError] = useState<WireError | null>(null);

  useEffect(() => {
    if (!mode || !ready) return;
    let alive = true;
    let sent: string | null = null;
    let busy = false;
    let next: SessionSnapshot | null = null;

    const snapshot = (): SessionSnapshot => {
      const { tabs, activeId } = useTabs.getState();
      return sessionSnapshot(
        tabs,
        activeId,
        mode === "editor" ? useLayout.getState().treeRoot : null
      );
    };

    const pump = async () => {
      if (busy) return;
      busy = true;
      while (alive && next) {
        const snap = next;
        next = null;
        const key = JSON.stringify(snap);
        if (key === sent) continue;
        try {
          await sessionPut(snap.root, snap.tabs, snap.active);
          sent = key;
          if (alive) setError(null);
        } catch (e) {
          if (alive) setError(toWireError(e));
        }
      }
      busy = false;
    };

    const push = () => {
      next = snapshot();
      void pump();
    };

    push();
    const unTabs = useTabs.subscribe((s, prev) => {
      if (s.tabs !== prev.tabs || s.activeId !== prev.activeId) push();
    });
    const unLayout =
      mode === "editor"
        ? useLayout.subscribe((s, prev) => {
            if (s.treeRoot !== prev.treeRoot) push();
          })
        : () => {};
    return () => {
      alive = false;
      unTabs();
      unLayout();
    };
  }, [mode, ready]);

  return { error, dismiss: () => setError(null) };
}
