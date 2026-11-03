// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { useViewSettingsSync } from "../files/view-settings";
import { useShortcuts } from "../keys/useShortcuts";
import type { Action } from "../keys/actions";
import { OpsHost } from "../ops/OpsHost";
import { activeTab, useTabs, type DocTab } from "../store/tabs";
import { usePinnedRecent } from "./pinned-recent-store";
import { ClosePrompt } from "./ClosePrompt";
import { EditorCentre, EditorLayout } from "./EditorLayout";
import { StatusBar } from "./StatusBar";
import { useLayoutSync } from "./use-layout-sync";
import "./shell.css";

// An editor window (`editor-<n>`): the editor layout (EditorLayout.tsx) rooted at the folder it was
// opened for, with tabs of documents. Its documents are tabs of this window's own store,
// registered with the backend under this window's label (open_paths from here opens a text file
// as a tab here). It holds documents only: the folder views, the Trash and All documents live in
// the main window, and its layout is always the editor's.

/**
 * What an editor window answers to: the document's keys, closing and switching tabs, and the
 * interface size. Not the places (Trash, All documents, Settings), which are the main window's.
 */
export const EDITOR_WINDOW_KEYS = (a: Action): boolean =>
  a.when === "doc" ||
  a.id.startsWith("tab.") ||
  a.id.startsWith("view.size.") ||
  a.id.startsWith("layout.") ||
  a.id.startsWith("panel.right");

export function EditorWindow(props: { starting: boolean }) {
  useShortcuts(EDITOR_WINDOW_KEYS);
  useViewSettingsSync();
  // Starts with the column width the main window ended with.
  useLayoutSync(false);
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
  const tabs = useTabs((s) => s.tabs);
  const tab = useTabs((s) => activeTab(s));
  const docs = tabs.filter((t): t is DocTab => t.kind === "doc");
  return (
    <div className="kern-window kern-editor-window" data-testid="editor-window">
      <EditorLayout allow={EDITOR_WINDOW_KEYS}>
        <EditorCentre tab={tab} docs={docs} starting={props.starting} />
      </EditorLayout>
      <OpsHost />
      <StatusBar />
      <ClosePrompt />
    </div>
  );
}
