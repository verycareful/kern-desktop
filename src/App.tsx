// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import {
  currentWindowLabel,
  isEditorWindow,
  isMainWindow,
  isSettingsWindow,
  toWireError,
  type WireError,
} from "./ipc";
import { DocumentWindow } from "./shell/DocumentWindow";
import { EditorWindow } from "./shell/EditorWindow";
import { SettingsWindow } from "./settings/SettingsWindow";
import MainWindow from "./shell/MainWindow";
import { useOpenDirectives } from "./shell/useOpenDirectives";
import { useSessionSync } from "./shell/use-session-sync";
import { useUserDirs } from "./shell/user-dirs-store";
import { useViewSettings } from "./files/view-settings";
import { RepeatFlash } from "./ops/repeat-flash";
import { useLayout } from "./store/layout";
import { useTabs } from "./store/tabs";
import { useTheme } from "./theme/useTheme";

export default function App() {
  const { error, problems } = useTheme();
  const [homeError, setHomeError] = useState<WireError | null>(null);
  // Home was opened because the settings, which name the new tab folder, could not be read.
  const [startNote, setStartNote] = useState(false);
  const settingsLoaded = useViewSettings((s) => s.loaded);
  const settingsError = useViewSettings((s) => s.error);
  const tabCount = useTabs((s) => s.tabs.length);
  // The main window opens Home when it has no tab, in the file manager layout: the editor layout's
  // centre shows the welcome pane instead. Which layout it has is known once the stored one is read.
  const layoutReady = useLayout((s) => s.loaded);
  const wantsHome = useLayout((s) => s.layout === "file_manager");
  // The main window browses; a document window shows one document.
  const [isMain] = useState(isMainWindow);
  // An editor window has tabs of its own and a folder tree; a document window shows one document.
  const [isEditor] = useState(isEditorWindow);
  // The Settings window shows the settings and nothing else.
  const [isSettings] = useState(isSettingsWindow);
  const [label] = useState(currentWindowLabel);
  const mode = isMain ? "main" : isEditor ? "editor" : isSettings ? "settings" : "doc";
  const directives = useOpenDirectives(mode);
  // The tabs are kept for the next launch once what was queued for the window is applied.
  const session = useSessionSync(mode === "settings" ? null : mode, directives.ready);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The main window never sits without a tab: a new window, and closing the
  // last tab, both open the new tab folder of the settings (Home when none is
  // set), the folder a new tab opens. The settings are waited for; when they
  // cannot be read the window opens Home and says why. Retry only clears the
  // error; this effect then looks Home up again. A tab opened while the lookup
  // ran wins. A start that was asked to open something (`kern ~/Documents`)
  // shows that and no start folder: it is only opened once what was queued for
  // the window has been applied and left it without a tab.
  useEffect(() => {
    if (!isMain || !directives.ready || !layoutReady || !wantsHome) return;
    if (tabCount !== 0 || homeError !== null) return;
    if (!settingsLoaded && settingsError === null) return;
    const chosen = settingsLoaded ? useViewSettings.getState().newTabFolder : null;
    const start = chosen
      ? Promise.resolve(chosen)
      : useUserDirs
          .getState()
          .load()
          .then((dirs) => dirs.home);
    start.then(
      (folder) => {
        if (mounted.current && useTabs.getState().tabs.length === 0) {
          useTabs.getState().openFolder(folder, false);
          if (!settingsLoaded) setStartNote(true);
        }
      },
      (e: unknown) => mounted.current && setHomeError(toWireError(e))
    );
  }, [
    isMain,
    directives.ready,
    layoutReady,
    wantsHome,
    tabCount,
    homeError,
    settingsLoaded,
    settingsError,
  ]);

  return (
    <div data-testid="shell" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {error && (
        <p role="alert">
          The system theme could not be applied, so Kern shows its own colours: {error.kind}:{" "}
          {error.message}
        </p>
      )}
      {homeError && (
        <p role="alert" className="kern-flash-host">
          <RepeatFlash watch={homeError} />
          The Home folder could not be located: {homeError.kind}: {homeError.message}{" "}
          <button type="button" onClick={() => setHomeError(null)}>
            Retry
          </button>
        </p>
      )}
      {startNote && settingsError && (
        <p role="alert">
          The settings could not be read, so Home opened instead of the new tab folder:{" "}
          {settingsError.kind}: {settingsError.message}{" "}
          <button type="button" onClick={() => setStartNote(false)}>
            Dismiss
          </button>
        </p>
      )}
      {session.error && (
        <p role="alert" className="kern-flash-host">
          <RepeatFlash watch={session.error} />
          The open tabs could not be kept for the next launch: {session.error.kind}:{" "}
          {session.error.message}{" "}
          <button type="button" onClick={session.dismiss}>
            Dismiss
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
      {isSettings && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <SettingsWindow />
        </div>
      )}
      {!isMain && !isEditor && !isSettings && label && (
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
