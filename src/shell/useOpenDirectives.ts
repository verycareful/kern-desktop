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
  refuseAdoption,
  refuseDetach,
  tabWindow,
  displayPath,
  docClosed,
  docOpened,
  on,
  openPendingTake,
  pathKey,
  toWireError,
  userDirs,
  type Directive,
  type Queued,
  type SessionTab,
  type UnlistenFn,
  type WireError,
  type WirePath,
} from "../ipc";
import { parseHanded } from "../editor/handed-doc";
import { handTo } from "./move-doc";
import { errorText } from "../ops/error-text";
import { isEditorLayout, useLayout } from "../store/layout";
import { useTabs } from "../store/tabs";
import { closeTab, closeWindow, isClosing } from "./useCloseGuard";
import { useProperties } from "../files/properties-store";
import { useSettingsNav } from "../settings/settings-nav";
import { useUserDirs } from "./user-dirs-store";

// What the backend tells the main window to do. The
// backend queues events for a window until it has asked for them once with
// open_pending_take, so the window subscribes first, takes the queue, applies
// it in order and then the live events, which wait behind the queue while it
// is being taken.
//
// A window asked to close goes through the close question (useCloseGuard.ts),
// which closes it at once when no document would lose anything. A document
// window takes its queue the same way and is told which document to show
// (load_doc); when a tab is being moved to it, it answers the backend once it
// holds the document (DocumentWindow), or refuses here when it cannot. An editor
// window (`editor-<n>`) is told its folder (editor_root) and opens documents into
// tabs of its own (doc_tab, focus_tab). A window opened again is told its tabs (restore). The main window takes over a document a document window sends
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

/** What the Settings window listens to: the category to show, and its close request. */
const SETTINGS_EVENTS = [EVENT_OPEN, EVENT_CLOSE_REQUESTED] as const;

/** What an editor window listens to: as a document window, and the documents handed to it. */
const EDITOR_EVENTS = [
  EVENT_OPEN,
  EVENT_OPEN_ERROR,
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

/**
 * The id of the window's one tab when it is Home and has not moved from it (its history is Home
 * alone), else null.
 */
function untouchedHome(): string | null {
  const { tabs } = useTabs.getState();
  const home = useUserDirs.getState().dirs?.home;
  const only = tabs.length === 1 ? tabs[0] : undefined;
  if (!home || only?.kind !== "folder" || only.history.length !== 1) return null;
  return pathKey(only.path) === pathKey(home) ? only.id : null;
}

/** A close request sent for a restart (restart.rs) carries `{"restart": true}`. */
const isRestart = (payload: unknown): boolean =>
  typeof payload === "object" &&
  payload !== null &&
  (payload as { restart?: unknown }).restart === true;

const unhandled = (name: string, detail = ""): string =>
  `Kern received "${name}"${detail} but this version cannot act on it yet.`;

/**
 * In the main window the full set. A document window (`doc-<n>`) is told which document to
 * show, of errors, and of its close request; an editor window (`editor-<n>`) its folder, the
 * documents to open in its tabs, the same errors and its close request; the Settings window
 * (`settings`) the category to show and its close request.
 */
export function useOpenDirectives(mode: "main" | "doc" | "editor" | "settings"): OpenDirectives {
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
    const loadDoc = async (path: WirePath, state: unknown, ack: boolean) => {
      const label = currentWindowLabel();
      if (!label) {
        notice(`Kern was asked to show ${displayPath(path)}, but this window has no label.`);
        return;
      }
      /** A tab is waiting for this window: it keeps the document, and is told why. */
      const refuseMove = async (reason: string) => {
        if (!ack) return;
        try {
          await refuseDetach(label, reason);
        } catch (e) {
          addError(toWireError(e));
        }
      };
      let handed = undefined;
      if (state !== undefined && state !== null) {
        const parsed = parseHanded(state);
        // The file on disk is not shown instead: it may lack what the text held, and showing it
        // as the document would hide that the text did not arrive.
        if (!parsed) {
          addError({
            kind: "Ipc",
            message:
              "the text of this document did not arrive in a form Kern can read, so it is not shown",
            path,
            details: null,
          });
          await refuseMove("the text did not arrive in a form the new window can read");
          return;
        }
        handed = parsed;
      }
      // The window answers once the document is open and registered (DocumentWindow).
      if (!tabs().openDocAs(label, path, handed, undefined, ack)) {
        notice(`This window already shows a document; ${displayPath(path)} was not opened here.`);
        await refuseMove("the new window already shows a document");
      }
    };

    /** This window will not take the document: the place that sent it keeps it and is told why. */
    const refuse = async (from: string, reason: string) => {
      try {
        await refuseAdoption(from, reason);
      } catch (e) {
        // The window still keeps it: its move ends when the backend stops waiting.
        addError(toWireError(e));
      }
    };

    /**
     * Take a document handed to this window: in the main window one a document window sends with
     * Home, in an editor window one opened from it while open elsewhere.
     */
    const adopt = async (payload: { path: WirePath; text_state: unknown; from: string }) => {
      const { path, text_state, from } = payload;
      // Taken now, the document would close with this window unasked.
      if (isClosing()) {
        await refuse(from, "the window it was moving to is closing, so the document stays");
        return;
      }
      let handed = undefined;
      if (text_state !== undefined && text_state !== null) {
        const parsed = parseHanded(text_state);
        if (!parsed) {
          await refuse(
            from,
            "the window it was moving to could not read the document's text, so it stays"
          );
          return;
        }
        handed = parsed;
      }
      const id = crypto.randomUUID();
      // Registered here, before it is acknowledged; the tab's editor does not register it again.
      if (!tabs().openDocAs(id, path, handed, true)) {
        await refuse(
          from,
          `${displayPath(path)} is already open in a tab of the window it was moving to`
        );
        return;
      }
      try {
        await docOpened(path, { kind: "tab", window: tabWindow(), tab_id: id }, from);
      } catch (e) {
        // Nothing was acknowledged: the window keeps the document.
        tabs().close(id);
        const err = toWireError(e);
        if (err.kind === "AdoptionOver") {
          // The backend took the move back before this tab registered; the window's registration
          // stands and the tab goes without releasing anything. Nobody waits for a refusal.
          notice("A document could not move to this window, so it stays where it was.");
          return;
        }
        addError(err);
        await refuse(
          from,
          `the window it was moving to could not register the document: ${errorText(err)}`
        );
        return;
      }
      try {
        await adopted(from);
        adoptions.set(from, id);
      } catch (e) {
        // The backend took the move back (or never had it) and registered the window for the
        // document again; the tab made for it goes with nothing asked.
        tabs().close(id);
        addError(toWireError(e));
      }
    };

    /**
     * A document tab for `path`, or the tab this window already has for it. The backend held the
     * path for this window when it routed it here, for a tab to register; when the window shows
     * it already (a tab that has not registered it: refused, or its file did not open) no tab
     * will, so that hold is let go.
     */
    const openDocTab = (path: WirePath) => {
      if (tabs().openDoc(path)) return;
      docClosed(path, { kind: "opening", window: tabWindow() }).catch((e: unknown) =>
        notice(`${displayPath(path)} could not be let go: ${errorText(toWireError(e))}`)
      );
    };

    /**
     * A window opened again: its tabs, in order, with tab `active` in front. A path that is gone
     * still gets its tab, which says why it shows nothing. The backend leaves out the main
     * window's folder tabs in the editor layout. The window may already show Home, as a launch
     * leaves it: when that is its only tab and it has not moved from it, the tabs take its place.
     */
    const restoreTabs = (list: SessionTab[], active: number | null) => {
      const untouched = untouchedHome();
      const ids = list.map((t) => {
        switch (t.kind) {
          case "folder":
            tabs().openFolder(t.path, true);
            break;
          case "doc":
            tabs().openDoc(t.path);
            break;
          case "trash":
            tabs().openTrash();
            break;
          case "documents":
            tabs().openDocuments();
            break;
        }
        return tabs().activeId;
      });
      if (untouched && list.length > 0 && !ids.includes(untouched)) tabs().close(untouched);
      const front = active === null ? undefined : ids[active];
      if (front) tabs().activate(front);
    };

    const apply = async (item: Queued): Promise<void> => {
      switch (item.event) {
        case EVENT_OPEN: {
          const d = item.payload as Directive;
          // Not awaited: the document may first be waited for, and the events after it still apply.
          if (d.kind === "hand_to") {
            void handTo(d.path, d.to);
            return;
          }
          if (mode === "settings") {
            if (d.kind === "settings_section") useSettingsNav.getState().show(d.section);
            else notice(unhandled(EVENT_OPEN, ` (${d.kind})`));
            return;
          }
          if (mode === "doc") {
            if (d.kind === "load_doc") await loadDoc(d.path, d.text_state, d.ack === true);
            else notice(unhandled(EVENT_OPEN, ` (${d.kind})`));
            return;
          }
          if (mode === "editor") {
            switch (d.kind) {
              case "editor_root":
                useLayout.getState().setTreeRoot(d.path);
                return;
              case "restore":
                restoreTabs(d.tabs, d.active);
                return;
              case "doc_tab":
                openDocTab(d.path);
                return;
              case "focus_tab":
                if (tabs().tabs.some((t) => t.id === d.tab_id)) tabs().activate(d.tab_id);
                else notice(`Kern was asked to show a tab that is gone (${d.tab_id}).`);
                return;
              default:
                notice(unhandled(EVENT_OPEN, ` (${d.kind})`));
                return;
            }
          }
          switch (d.kind) {
            // The editor layout holds no folder tabs: a folder roots its tree.
            case "folder_tab":
              if (isEditorLayout()) useLayout.getState().setTreeRoot(d.path);
              else tabs().focusOrOpenFolder(d.path);
              return;
            case "doc_tab":
              openDocTab(d.path);
              return;
            case "home_tab": {
              const home = (await userDirs()).home;
              if (isEditorLayout()) useLayout.getState().setTreeRoot(home);
              else tabs().focusOrOpenFolder(home);
              return;
            }
            case "focus_tab":
              if (tabs().tabs.some((t) => t.id === d.tab_id)) tabs().activate(d.tab_id);
              else notice(`Kern was asked to show a tab that is gone (${d.tab_id}).`);
              return;
            case "restore":
              restoreTabs(d.tabs, d.active);
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
          const tab = id ? tabs().tabs.find((t) => t.id === id) : undefined;
          if (tab?.kind === "doc") {
            // The document stays in its window, which still has it; this tab was a second copy.
            // The backend registered the window again; the tab's release does not touch that.
            // A copy with edits made here is asked about before it goes.
            closeTab(tab.id);
            notice(
              tab.dirty
                ? "A document could not move to this window, so it stays where it was. This copy has unsaved changes, so you are asked before it closes; Save writes this copy over the file the other window holds."
                : "A document could not move to this window, so it stays where it was."
            );
          }
          return;
        }
        case EVENT_CLOSE_REQUESTED:
          // Not awaited: the question may stay open a while, and the events after it still apply.
          void closeWindow(isRestart(item.payload));
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
          mode === "main"
            ? EVENTS
            : mode === "editor"
              ? EDITOR_EVENTS
              : mode === "settings"
                ? SETTINGS_EVENTS
                : DOC_EVENTS;
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
