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
  adopted,
  currentWindowLabel,
  displayPath,
  docOpened,
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
import { parseHanded } from "../editor/handed-doc";
import { useTabs } from "../store/tabs";
import { closeWindow } from "./useCloseGuard";
import { useProperties } from "../files/properties-store";

// Design 4.4 and 4.5: what the backend tells the main window to do. The
// backend queues events for a window until it has asked for them once with
// open_pending_take, so the window subscribes first, takes the queue, applies
// it in order and then the live events, which wait behind the queue while it
// is being taken.
//
// A window asked to close goes through the close question (useCloseGuard.ts),
// which closes it at once when no document would lose anything. A document
// window takes its queue the same way and is told which document to show
// (load_doc). The main window takes over a document a document window sends
// with Home (adopt-doc): it opens a tab from the state handed over, registers
// it, and only then acknowledges, so the backend closes the other window once
// the tab holds the document; adopt-cancelled drops such a tab again. Events
// this window cannot act on are never dropped quietly: each is reported as a
// notice that names it.

/** Every event the main window listens to; those without a case in `apply` are reported. */
const EVENTS = [
  EVENT_OPEN,
  EVENT_SELECT,
  EVENT_OPEN_ERROR,
  EVENT_PROPERTIES,
  EVENT_ADOPT_DOC,
  EVENT_ADOPT_CANCELLED,
  EVENT_CLOSE_REQUESTED,
] as const;

/** What a document window listens to. */
const DOC_EVENTS = [EVENT_OPEN, EVENT_OPEN_ERROR, EVENT_CLOSE_REQUESTED] as const;

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
 * In the main window the full set. A document window (`doc-<n>`) is told which document to
 * show, of errors, and of its close request.
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
    /** Tabs made from a document window's Home, by that window's label, until it is gone. */
    const adoptions = new Map<string, string>();

    /** A document window: show the document it was given, from the state handed over if any. */
    const loadDoc = (path: WirePath, state: unknown) => {
      const label = currentWindowLabel();
      if (!label) {
        notice(`Kern was asked to show ${displayPath(path)}, but this window has no label.`);
        return;
      }
      let handed = undefined;
      if (state !== undefined && state !== null) {
        const parsed = parseHanded(state);
        if (!parsed) {
          addError({
            kind: "Ipc",
            message:
              "the text of this document did not arrive in a form Kern can read, so the file is shown as it is on disk",
            path,
            details: null,
          });
        } else handed = parsed;
      }
      if (!tabs().openDocAs(label, path, handed)) {
        notice(`This window already shows a document; ${displayPath(path)} was not opened here.`);
      }
    };

    /** The main window: take the document a document window sends with Home. */
    const adopt = async (payload: { path: WirePath; text_state: unknown; from: string }) => {
      const { path, text_state, from } = payload;
      let handed = undefined;
      if (text_state !== undefined && text_state !== null) {
        const parsed = parseHanded(text_state);
        // Not acknowledged: the backend leaves the document in its window.
        if (!parsed) {
          addError({
            kind: "Ipc",
            message: `the document of window ${from} did not arrive in a form Kern can read, so it stays in its window`,
            path,
            details: null,
          });
          return;
        }
        handed = parsed;
      }
      const id = crypto.randomUUID();
      if (!tabs().openDocAs(id, path, handed)) {
        addError({
          kind: "AlreadyOpen",
          message: `${displayPath(path)} is already open in a tab, so it stays in its window`,
          path,
          details: null,
        });
        return;
      }
      try {
        await docOpened(path, { kind: "tab", tab_id: id });
        await adopted(from);
        adoptions.set(from, id);
      } catch (e) {
        // The window keeps the document; the tab made for it goes, with nothing asked.
        tabs().close(id);
        addError(toWireError(e));
      }
    };

    const apply = async (item: Queued): Promise<void> => {
      switch (item.event) {
        case EVENT_OPEN: {
          const d = item.payload as Directive;
          if (mode === "doc") {
            if (d.kind === "load_doc") loadDoc(d.path, d.text_state);
            else notice(unhandled(EVENT_OPEN, ` (${d.kind})`));
            return;
          }
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
        case EVENT_PROPERTIES:
          useProperties.getState().show((item.payload as { paths: WirePath[] }).paths);
          return;
        case EVENT_ADOPT_DOC:
          await adopt(item.payload as { path: WirePath; text_state: unknown; from: string });
          return;
        case EVENT_ADOPT_CANCELLED: {
          const { label } = item.payload as { label: string };
          const id = adoptions.get(label);
          adoptions.delete(label);
          if (id && tabs().tabs.some((t) => t.id === id)) {
            // The document stays in its window, which still has it; this tab was a second copy.
            tabs().close(id);
            notice("A document could not move to this window, so it stays in its own window.");
          }
          return;
        }
        case EVENT_CLOSE_REQUESTED:
          // Not awaited: the question may stay open a while, and the events after it still apply.
          void closeWindow();
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
        const names: readonly (typeof EVENTS)[number][] = mode === "main" ? EVENTS : DOC_EVENTS;
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
        taken.current ??= openPendingTake();
        const queued = await taken.current;
        if (!alive) return;
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
