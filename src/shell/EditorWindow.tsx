// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { useViewSettingsSync } from "../files/view-settings";
import { useCutSync } from "../ops/cut-store";
import { useShortcuts } from "../keys/useShortcuts";
import type { Action } from "../keys/actions";
import { activeTab, useTabs, type DocTab } from "../store/tabs";
import { OpsHost } from "../ops/OpsHost";
import { usePinnedRecent } from "./pinned-recent-store";
import { recordEditorFolder } from "./editor-recent";
import { useLayout } from "../store/layout";
import { ClosePrompt } from "./ClosePrompt";
import { EditorCentre, EditorLayout } from "./EditorLayout";
import { StatusBar } from "./StatusBar";
import { useEditorDrop } from "./use-editor-drop";
import { useLayoutSync } from "./use-layout-sync";
import "./shell.css";

// An editor window (`editor-<n>`): the editor layout (EditorLayout.tsx) rooted at the folder it was
// opened for, with tabs of documents. Its documents are tabs of this window's own store,
// registered with the backend under this window's label (open_paths from here opens a text file
// as a tab here). It holds documents only: the folder views, the Trash and the Library live in
// the main window, and its layout is always the editor's. Files dropped on it from another program
// are copied or moved into a folder of its tree, or opened (use-editor-drop.ts); it hosts the
// progress, questions and reports of those operations (OpsHost).

/**
 * What an editor window answers to: the document's keys, closing and switching tabs, both side
 * panels (the folder column and Pinned and Recent), its folder opened in the file manager, and
 * Settings (a window of its own). Not Trash or the Library, which are the main window's, and not
 * the new tabs: an editor's tabs are documents of its folder.
 */
export const EDITOR_WINDOW_KEYS = (a: Action): boolean =>
  a.when === "doc" ||
  a.id.startsWith("tab.") ||
  a.id === "place.settings" ||
  a.id.startsWith("panel.") ||
  a.id === "editor.openInFileManager";

export function EditorWindow(props: { starting: boolean }) {
  useShortcuts(EDITOR_WINDOW_KEYS);
  useViewSettingsSync();
  useCutSync();
  // Starts with the column width the main window ended with.
  useLayoutSync(false);
  useEditorDrop();
  // Ctrl+D pins the document, which needs to know the pins even while the panel is folded away.
  useEffect(() => {
    let live = true;
    let stop: (() => void) | undefined;
    void usePinnedRecent
      .getState()
      .follow({ prune: false })
      .then((off) => (live ? (stop = off) : off()));
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  // The folder goes into Recent as soon as the window has it, and again if it changes.
  const root = useLayout((s) => s.treeRoot);
  useEffect(() => {
    if (root) void recordEditorFolder();
  }, [root]);
  const tabs = useTabs((s) => s.tabs);
  const tab = useTabs((s) => activeTab(s));
  const docs = tabs.filter((t): t is DocTab => t.kind === "doc");
  return (
    <div className="kern-window kern-editor-window" data-testid="editor-window">
      <EditorLayout allow={EDITOR_WINDOW_KEYS}>
        <EditorCentre tab={tab} docs={docs} starting={props.starting} />
      </EditorLayout>
      <OpsHost editor />
      <StatusBar />
      <ClosePrompt />
    </div>
  );
}
