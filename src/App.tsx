// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import {
  currentWindowLabel,
  isEditorWindow,
  isMainWindow,
  toWireError,
  type WireError,
} from "./ipc";
import { DocumentWindow } from "./shell/DocumentWindow";
import { EditorWindow } from "./shell/EditorWindow";
import MainWindow from "./shell/MainWindow";
import { useOpenDirectives } from "./shell/useOpenDirectives";
import { useUserDirs } from "./shell/user-dirs-store";
import { useLayout } from "./store/layout";
import { useTabs } from "./store/tabs";
import { useTheme } from "./theme/useTheme";

export default function App() {
  const { error, problems } = useTheme();
  const [homeError, setHomeError] = useState<WireError | null>(null);
  const tabCount = useTabs((s) => s.tabs.length);
  // The main window opens Home when it has no tab, in the file manager layout: the editor layout's
  // centre shows the welcome pane instead. Which layout it has is known once the stored one is read.
  const layoutReady = useLayout((s) => s.loaded);
  const wantsHome = useLayout((s) => s.layout === "file_manager");
  // The main window browses; a document window (design 4.4) shows one document.
  const [isMain] = useState(isMainWindow);
  // An editor window has tabs of its own and a folder tree; a document window shows one document.
  const [isEditor] = useState(isEditorWindow);
  const [label] = useState(currentWindowLabel);
  const directives = useOpenDirectives(isMain ? "main" : isEditor ? "editor" : "doc");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Design 4.4 names a Home folder tab for the main window, and the window
  // never sits without a tab: a new window, and closing the last tab, both
  // open Home. Retry only clears the error; this effect then looks Home up
  // again. A tab opened while the lookup ran wins. A start that was asked to
  // open something (`kern ~/Documents`, 4.5) shows that and no Home: Home is
  // only opened once what was queued for the window has been applied and left
  // it without a tab.
  useEffect(() => {
    if (!isMain || !directives.ready || !layoutReady || !wantsHome) return;
    if (tabCount !== 0 || homeError !== null) return;
    useUserDirs
      .getState()
      .load()
      .then(
        (dirs) => {
          if (mounted.current && useTabs.getState().tabs.length === 0) {
            useTabs.getState().openFolder(dirs.home, false);
          }
        },
        (e: unknown) => mounted.current && setHomeError(toWireError(e))
      );
  }, [isMain, directives.ready, layoutReady, wantsHome, tabCount, homeError]);

  return (
    <div data-testid="shell" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {error && (
        <p role="alert">
          The system theme could not be applied, so Kern shows its own colours: {error.kind}:{" "}
          {error.message}
        </p>
      )}
      {homeError && (
        <p role="alert">
          The Home folder could not be located: {homeError.kind}: {homeError.message}{" "}
          <button type="button" onClick={() => setHomeError(null)}>
            Retry
          </button>
        </p>
      )}
      {directives.errors.map((e, i) => (
        <p role="alert" key={`e${i}`}>
          {e.kind}: {e.message}{" "}
          <button type="button" onClick={() => directives.dismissError(i)}>
            Dismiss
          </button>
        </p>
      ))}
      {directives.notices.map((n) => (
        <p role="alert" key={`n${n.id}`}>
          {n.text}{" "}
          <button type="button" onClick={() => directives.dismissNotice(n.id)}>
            Dismiss
          </button>
        </p>
      ))}
      {problems.length > 0 && (
        <ul role="status" aria-label="System theme problems">
          {problems.map((p) => (
            <li key={JSON.stringify(p)}>
              {p.kind}: {p.message}
            </li>
          ))}
        </ul>
      )}
      {isEditor && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <EditorWindow starting={!directives.ready} />
        </div>
      )}
      {!isMain && !isEditor && label && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <DocumentWindow label={label} starting={!directives.ready} />
        </div>
      )}
      {isMain && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <MainWindow
            starting={!directives.ready}
            openingHome={
              directives.ready && layoutReady && wantsHome && tabCount === 0 && homeError === null
            }
          />
        </div>
      )}
    </div>
  );
}
