// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EVENT_ADOPT_CANCELLED,
  EVENT_ADOPT_DOC,
  EVENT_CLOSE_REQUESTED,
  EVENT_OPEN,
  EVENT_OPEN_ERROR,
  EVENT_PROPERTIES,
  EVENT_SELECT,
  confirmClose,
  displayPath,
  on,
  openPendingTake,
  pathKey,
  toWireError,
  userDirs,
  type Directive,
  type Queued,
  type UnlistenFn,
  type WireError,
  type WirePath,
} from "../ipc";
import { useTabs } from "../store/tabs";

// Design 4.4 and 4.5: what the backend tells the main window to do. The
// backend queues events for a window until it has asked for them once with
// open_pending_take, so the window subscribes first, takes the queue, applies
// it in order and then the live events, which wait behind the queue while it
// is being taken.
//
// A window asked to close with no dirty tab closes at once (design 4.5 with an
// empty list of dirty tabs). Events of features this window does not have yet
// (kern://properties, a document window's load_doc, adopt-doc, and a close
// with a dirty tab) are never dropped quietly: each is reported as a notice
// that names it.

/** Every event the window listens to; those without a case in `apply` are reported. */
const EVENTS = [
  EVENT_OPEN,
  EVENT_SELECT,
  EVENT_OPEN_ERROR,
  EVENT_PROPERTIES,
  EVENT_ADOPT_DOC,
  EVENT_ADOPT_CANCELLED,
  EVENT_CLOSE_REQUESTED,
] as const;

export interface Notice {
  id: number;
  text: string;
}

export interface OpenDirectives {
  /** True once the queue has been taken and applied: only then may the window decide it has no tab. */
  ready: boolean;
  /** Errors from the backend (kern://open-error) and things this window could not do. */
  errors: WireError[];
  notices: Notice[];
  dismissError(index: number): void;
  dismissNotice(id: number): void;
}

const unhandled = (name: string, detail = ""): string =>
  `Kern received "${name}"${detail} but this version cannot act on it yet.`;

/**
 * In the main window the full set. A document window (`doc-<n>`) listens only
 * for its close request, so it can be closed, and leaves what is queued for it
 * (the document to show) untaken for the shell that will show it.
 */
export function useOpenDirectives(mode: "main" | "doc"): OpenDirectives {
  const [ready, setReady] = useState(false);
  const [errors, setErrors] = useState<WireError[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);
  // One take for the life of the window, also across the double effect of StrictMode.
  const taken = useRef<Promise<Queued[]> | null>(null);

  const addError = useCallback((e: WireError) => setErrors((list) => [...list, e]), []);
  const notice = useCallback(
    (text: string) => setNotices((list) => [...list, { id: nextId.current++, text }]),
    []
  );

  useEffect(() => {
    let alive = true;
    const unlisten: UnlistenFn[] = [];
    let waiting: Queued[] | null = [];
    // Events apply one after another, so an asynchronous one (Home) keeps its place.
    let chain: Promise<void> = Promise.resolve();

    const tabs = () => useTabs.getState();
    const apply = async (item: Queued): Promise<void> => {
      switch (item.event) {
        case EVENT_OPEN: {
          const d = item.payload as Directive;
          switch (d.kind) {
            case "folder_tab":
              tabs().focusOrOpenFolder(d.path);
              return;
            case "doc_tab":
              tabs().openDoc(d.path);
              return;
            case "home_tab":
              tabs().focusOrOpenFolder((await userDirs()).home);
              return;
            case "focus_tab":
              if (tabs().tabs.some((t) => t.id === d.tab_id)) tabs().activate(d.tab_id);
              else notice(`Kern was asked to show a tab that is gone (${d.tab_id}).`);
              return;
            default:
              notice(unhandled(EVENT_OPEN, ` (${(d as { kind: string }).kind})`));
              return;
          }
        }
        case EVENT_SELECT: {
          const { tab, paths } = item.payload as { tab: WirePath; paths: WirePath[] };
          const key = pathKey(tab);
          const target = tabs().tabs.find((t) => t.kind === "folder" && pathKey(t.path) === key);
          if (target) tabs().requestSelect(target.id, paths);
          else notice(`Kern was asked to select items in ${displayPath(tab)}, which is not open.`);
          return;
        }
        case EVENT_OPEN_ERROR:
          addError(item.payload as WireError);
          return;
        case EVENT_CLOSE_REQUESTED:
          if (tabs().tabs.some((t) => t.kind === "doc" && t.dirty)) {
            notice(
              "Kern cannot close this window while a document has unsaved changes " +
                "in this version. Save the document first."
            );
          } else await confirmClose();
          return;
        default:
          notice(unhandled(item.event));
      }
    };
    const enqueue = (item: Queued) => {
      chain = chain.then(() =>
        apply(item).catch((e: unknown) => {
          if (alive) addError(toWireError(e));
        })
      );
    };

    (async () => {
      try {
        const names: readonly (typeof EVENTS)[number][] =
          mode === "main" ? EVENTS : [EVENT_CLOSE_REQUESTED];
        for (const name of names) {
          const un = await on(name, (payload) => {
            const item: Queued = { event: name, payload };
            if (waiting) waiting.push(item);
            else enqueue(item);
          });
          if (alive) unlisten.push(un);
          else un();
        }
        // A cleaned-up run (StrictMode's first) leaves the take to the one that replaced it.
        if (!alive) return;
        // Events that arrived while the subscriptions were being placed are applied, after the queue.
        let queued: Queued[] = [];
        if (mode === "main") {
          taken.current ??= openPendingTake();
          queued = await taken.current;
          if (!alive) return;
        }
        const late = waiting ?? [];
        waiting = null;
        for (const item of [...queued, ...late]) enqueue(item);
      } catch (e) {
        if (alive) {
          // What arrived while the take was out is still applied.
          const late = waiting ?? [];
          waiting = null;
          late.forEach(enqueue);
          addError(toWireError(e));
        }
      }
      await chain;
      if (alive) setReady(true);
    })();

    return () => {
      alive = false;
      unlisten.forEach((u) => u());
    };
  }, [addError, notice, mode]);

  return {
    ready,
    errors,
    notices,
    dismissError: (index) => setErrors((list) => list.filter((_, i) => i !== index)),
    dismissNotice: (id) => setNotices((list) => list.filter((n) => n.id !== id)),
  };
}
