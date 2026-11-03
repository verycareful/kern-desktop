// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { TextEditor } from "../editor/TextEditor";
import { useViewSettingsSync } from "../files/view-settings";
import { useShortcuts } from "../keys/useShortcuts";
import type { Action } from "../keys/actions";
import { OpsHost } from "../ops/OpsHost";
import { useTabs, type DocTab } from "../store/tabs";
import { ClosePrompt } from "./ClosePrompt";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import "./shell.css";

// An editor window (`editor-<n>`): tabs of documents. Its documents are tabs of this window's own
// store, registered with the backend under this window's label (open_paths from here opens a
// text file as a tab here). It holds documents only: the folder views, the Trash and All
// documents live in the main window.

/**
 * What an editor window answers to: the document's keys, closing and switching tabs, and the
 * interface size. Not the places (Trash, All documents, Settings), which are the main window's.
 */
export const EDITOR_WINDOW_KEYS = (a: Action): boolean =>
  a.when === "doc" || a.id.startsWith("tab.") || a.id.startsWith("view.size.");

export function EditorWindow(props: { starting: boolean }) {
  useShortcuts(EDITOR_WINDOW_KEYS);
  useViewSettingsSync();
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const docs = tabs.filter((t): t is DocTab => t.kind === "doc");
  return (
    <div className="kern-window kern-editor-window" data-testid="editor-window">
      <TabBar allow={EDITOR_WINDOW_KEYS} />
      <main className="kern-doc-area kern-editor-body" data-testid="doc-area">
        {docs.length === 0 && (
          <p role="status" className="kern-doc-window-wait">
            {props.starting ? "Starting…" : "No document is open in this window."}
          </p>
        )}
        {docs.map((d) => (
          <TextEditor
            key={d.id}
            tabId={d.id}
            path={d.path}
            active={d.id === activeId}
            handed={d.handed}
            registered={d.registered}
          />
        ))}
      </main>
      <OpsHost />
      <StatusBar />
      <ClosePrompt />
    </div>
  );
}
