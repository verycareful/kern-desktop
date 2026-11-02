// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useState } from "react";
import { House } from "lucide-react";
import { TextEditor } from "../editor/TextEditor";
import { useViewSettingsSync } from "../files/view-settings";
import { useShortcuts } from "../keys/useShortcuts";
import type { Action } from "../keys/actions";
import { tabTitle, useTabs } from "../store/tabs";
import { ClosePrompt } from "./ClosePrompt";
import { moveDocHome } from "./move-doc";
import { StatusBar } from "./StatusBar";
import "./shell.css";

// A standalone document window (design 4.4): only the document, with Home at
// the top left and the status bar along the bottom; no tabs and no side panels.
// Its document is a document tab of this window's own store, under the
// window's label, registered with the backend as open in this window. Home
// moves it, unsaved text included, to a tab of the main window (move-doc.ts).

/** The window shows one document: its keys are the document's and closing (which closes the window). */
const DOC_WINDOW_KEYS = (a: Action) => a.when === "doc" || a.id === "tab.close";

export function DocumentWindow(props: { label: string; starting: boolean }) {
  const { label } = props;
  useShortcuts(DOC_WINDOW_KEYS);
  useViewSettingsSync();
  const tab = useTabs((s) => s.tabs.find((t) => t.id === label && t.kind === "doc"));
  const [moving, setMoving] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const doc = tab?.kind === "doc" ? tab : null;

  const home = async () => {
    setMoving(true);
    setHomeError(null);
    // On success the backend closes this window.
    const failed = await moveDocHome();
    if (failed) {
      setHomeError(failed);
      setMoving(false);
    }
  };

  return (
    <div className="kern-window kern-doc-window" data-testid="document-window">
      <header className="kern-doc-window-bar">
        <button
          type="button"
          className="kern-icon-button"
          aria-label="Home: move this document to the main window"
          title="Home: move this document to the main window"
          disabled={!doc || moving}
          onClick={() => void home()}
        >
          <House size={18} strokeWidth={2} aria-hidden />
        </button>
        <span className="kern-doc-window-title">{doc ? tabTitle(doc) : ""}</span>
      </header>
      {homeError && (
        <div role="alert" className="kern-banner" data-testid="home-error">
          {homeError}
        </div>
      )}
      <main className="kern-doc-area" data-testid="doc-area">
        {doc ? (
          <TextEditor
            tabId={label}
            path={doc.path}
            active
            location={{ kind: "window", label }}
            handed={doc.handed}
          />
        ) : (
          <p role="status" className="kern-doc-window-wait">
            {props.starting ? "Starting…" : "This window has no document to show."}
          </p>
        )}
      </main>
      <StatusBar />
      <ClosePrompt />
    </div>
  );
}
