// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { openDefault, settingsGet, toWireError, type Location, type WirePath } from "../ipc";
import { useViewSettings } from "../files/view-settings";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { ChangedOnDiskBanner } from "./ChangedOnDiskBanner";
import { ExternalModificationPrompt, RecreatePrompt, SaveAsDialog } from "./DocPrompts";
import { columnOf, useDocStatus } from "./doc-status";
import type { HandedDoc } from "./handed-doc";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { useTextDoc } from "./useTextDoc";
import "./editor.css";

// The text editor of a document tab (design 4.3, 5.4). CodeMirror
// 6 with line numbers, undo and redo, and find and replace; no language
// packages, the text is plain. The text is CodeMirror's: the React side holds
// only what the user must be told (useTextDoc), and the cursor position goes
// to the status bar through its own store (doc-status.ts), so a cursor move
// does not render this component.
//
// The editor of a tab that is not shown stays mounted, hidden, so the edits,
// the undo history and the watch on the file survive a switch of tab.

/** Mod-d selects the next occurrence in CodeMirror's search keymap; Kern gives Ctrl+D to Pin. */
const KEYS = [...defaultKeymap, ...historyKeymap, ...searchKeymap.filter((k) => k.key !== "Mod-d")];

/** The font size of the editor at zoom 1, before the zoom setting (store.rs ZOOM_MIN 0.25, ZOOM_MAX 5.0). */
const BASE_FONT_SIZE = "var(--kern-editor-font-size, 13px)";

const zoomTheme = (zoom: number): Extension =>
  EditorView.theme({ "&": { fontSize: `calc(${BASE_FONT_SIZE} * ${zoom})` } });

/** A zoom the settings did not give as a finite number is the unzoomed size. */
const safeZoom = (z: unknown): number => (typeof z === "number" && Number.isFinite(z) ? z : 1);

export function TextEditor(props: {
  tabId: string;
  path: WirePath;
  active: boolean;
  /** Where the document is open; a tab of `tabId` when not given. */
  location?: Location;
  /** The document as another window handed it over. */
  handed?: HandedDoc;
  /** Registered as open here before the editor mounted. */
  registered?: boolean;
  /**
   * Called once: with ok when the document is open and registered with the backend, else with why
   * it is not (the file could not be opened, the registration was refused). A document moved here
   * from another window is acknowledged on it.
   */
  onSettled?: (result: { ok: true } | { ok: false; reason: string }) => void;
}) {
  const { tabId, path, active } = props;
  const settled = useRef(false);
  const onSettled = useRef(props.onSettled);
  useEffect(() => {
    onSettled.current = props.onSettled;
  });
  const settle = (result: { ok: true } | { ok: false; reason: string }) => {
    if (settled.current) return;
    settled.current = true;
    onSettled.current?.(result);
  };
  const doc = useTextDoc(tabId, path, {
    location: props.location,
    handed: props.handed,
    registered: props.registered,
    onRegistered: (ok) =>
      settle(
        ok
          ? { ok: true }
          : { ok: false, reason: "the document could not be registered as open in this window" }
      ),
  });
  useEffect(() => {
    if (doc.phase === "failed") {
      settle({
        ok: false,
        reason: `${baseName(path)} could not be opened${doc.error ? `: ${errorText(doc.error)}` : ""}`,
      });
    }
    // `settle` only reads refs.
  }, [doc.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const wordWrap = useViewSettings((s) => s.wordWrap);
  const zoom = safeZoom(useViewSettings((s) => s.editorZoom));
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const scrollTop = useRef(0);
  const [openError, setOpenError] = useState<string | null>(null);
  const parts = useRef({
    readOnly: new Compartment(),
    wrap: new Compartment(),
    zoom: new Compartment(),
  });

  // What the editor's callbacks read, so they need not be rebuilt with each render.
  // A document moving to another window takes no edits: one made after its state was taken would be lost.
  const isReadOnly = doc.readOnly !== null || doc.moving;
  const latest = useRef({ edited: doc.edited, readOnly: isReadOnly, wordWrap, zoom });
  useEffect(() => {
    latest.current = { edited: doc.edited, readOnly: isReadOnly, wordWrap, zoom };
  });

  const ready = doc.phase === "ready";
  const initial = doc.doc;

  // ---- the CodeMirror view: built for each document the hook hands over ----
  useEffect(() => {
    if (!ready || !initial || !host.current) return;
    const publish = (state: EditorState) => {
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      useDocStatus
        .getState()
        .patch(tabId, { line: line.number, col: columnOf(line.text, head, line.from) });
    };
    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        search({ top: true }),
        keymap.of(KEYS),
        EditorView.updateListener.of((u: ViewUpdate) => {
          if (u.docChanged) latest.current.edited(u.state.doc);
          if (u.docChanged || u.selectionSet) publish(u.state);
        }),
        parts.current.readOnly.of(EditorState.readOnly.of(latest.current.readOnly)),
        parts.current.wrap.of(latest.current.wordWrap ? EditorView.lineWrapping : []),
        parts.current.zoom.of(zoomTheme(latest.current.zoom)),
        EditorView.contentAttributes.of({ "aria-label": `Text of ${baseName(path)}` }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    publish(state);
    return () => {
      v.destroy();
      view.current = null;
    };
    // `path` only names the editor for assistive technology; the view is rebuilt per document.
  }, [ready, initial, tabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- settings and read-only state, applied to the view that is there ----
  useEffect(() => {
    view.current?.dispatch({
      effects: parts.current.readOnly.reconfigure(EditorState.readOnly.of(isReadOnly)),
    });
  }, [isReadOnly, ready, initial]);
  useEffect(() => {
    view.current?.dispatch({
      effects: parts.current.wrap.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    });
  }, [wordWrap, ready, initial]);
  useEffect(() => {
    view.current?.dispatch({ effects: parts.current.zoom.reconfigure(zoomTheme(zoom)) });
  }, [zoom, ready, initial]);

  // ---- focus and scroll follow the tab being shown ----
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (active) {
      v.scrollDOM.scrollTop = scrollTop.current;
      v.focus();
    } else {
      scrollTop.current = v.scrollDOM.scrollTop;
    }
  }, [active, ready, initial]);

  const name = baseName(path);

  const openInDefaultApp = async () => {
    setOpenError(null);
    try {
      const terminal = (await settingsGet()).terminal;
      await openDefault([path], terminal ?? undefined);
    } catch (e) {
      setOpenError(`${name} could not be opened: ${errorText(toWireError(e))}`);
    }
  };

  let body;
  if (doc.phase === "loading") {
    body = (
      <div className="kern-doc-note" role="status" data-testid="doc-loading">
        <p>Opening {name}…</p>
      </div>
    );
  } else if (doc.phase === "failed") {
    const tooLarge = doc.error?.kind === "TooLargeToOpen";
    body = (
      <div className="kern-doc-note" role="alert" data-testid="doc-failed">
        <p>
          {tooLarge
            ? `${name} is too large to open in Kern's editor.`
            : `${name} could not be opened.`}
        </p>
        {doc.error && <p>{errorText(doc.error)}</p>}
        {tooLarge && (
          <button type="button" className="kern-button" onClick={() => void openInDefaultApp()}>
            Open in default app
          </button>
        )}
        {openError && <p role="alert">{openError}</p>}
      </div>
    );
  } else {
    body = null;
  }

  return (
    <section
      className="kern-doc-editor"
      hidden={!active}
      aria-label={`Editor for ${name}`}
      data-testid="text-editor"
      data-tab-id={tabId}
    >
      {ready && doc.readOnly && <ReadOnlyBanner readOnly={doc.readOnly} />}
      {ready && doc.deletedOnDisk && (
        <ChangedOnDiskBanner
          kind="deleted"
          dirty={doc.dirty}
          onReload={() => void doc.reload()}
          onSaveAs={doc.askSaveAs}
        />
      )}
      {ready && doc.changedOnDisk && !doc.deletedOnDisk && (
        <ChangedOnDiskBanner
          kind="changed"
          dirty={doc.dirty}
          onReload={() => void doc.reload()}
          onSaveAs={doc.askSaveAs}
        />
      )}
      {ready && doc.watchError && (
        <div className="kern-doc-banner" role="alert" data-testid="watch-banner">
          <p>
            Kern cannot watch the folder of this file, so it will not notice if the file changes or
            is deleted ({errorText(doc.watchError)}).
          </p>
        </div>
      )}
      {ready && doc.moving && (
        <div className="kern-doc-banner" role="status" data-testid="doc-moving">
          <p>Moving {name} to another window…</p>
        </div>
      )}
      {doc.problem && (
        <div className="kern-doc-banner" role="alert" data-testid="doc-problem">
          <p>{doc.problem}</p>
        </div>
      )}
      {body}
      <div className="kern-doc-host" ref={host} hidden={!ready} data-testid="editor-host" />
      {ready && active && doc.prompt === "external" && (
        <ExternalModificationPrompt
          path={path}
          dirty={doc.dirty}
          onReload={() => void doc.reload()}
          onOverwrite={() => void doc.overwrite()}
          onSaveAs={doc.askSaveAs}
          onCancel={doc.cancelPrompt}
        />
      )}
      {ready && active && doc.prompt === "recreate" && (
        <RecreatePrompt
          path={path}
          onRecreate={() => void doc.overwrite()}
          onSaveAs={doc.askSaveAs}
          onCancel={doc.cancelPrompt}
        />
      )}
      {ready && active && doc.prompt === "saveAs" && (
        <SaveAsDialog
          path={path}
          lossyNote={
            doc.readOnly &&
            doc.readOnly.kind !== "TooLarge" &&
            doc.readOnly.kind !== "NoWritePermission"
              ? "The text shown is a lossy copy of this file. Save As keeps it as shown."
              : null
          }
          save={doc.saveAs}
          onCancel={doc.cancelPrompt}
        />
      )}
    </section>
  );
}
