// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { isMainWindow, toWireError, type WireError } from "./ipc";
import MainWindow from "./shell/MainWindow";
import { useOpenDirectives } from "./shell/useOpenDirectives";
import { useUserDirs } from "./shell/user-dirs-store";
import { useTabs } from "./store/tabs";
import { useTheme } from "./theme/useTheme";

export default function App() {
  const { error, problems } = useTheme();
  const [homeError, setHomeError] = useState<WireError | null>(null);
  const tabCount = useTabs((s) => s.tabs.length);
  // Only the main window browses until document windows have their own shell;
  // a document window can only be closed for now.
  const [isMain] = useState(isMainWindow);
  const directives = useOpenDirectives(isMain ? "main" : "doc");
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
    if (!isMain || !directives.ready || tabCount !== 0 || homeError !== null) return;
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
  }, [isMain, directives.ready, tabCount, homeError]);

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
      {!isMain && (
        <p role="status">
          This window will show its document in a later version of Kern. It can be closed.
        </p>
      )}
      {isMain && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <MainWindow
            starting={!directives.ready}
            openingHome={directives.ready && tabCount === 0 && homeError === null}
          />
        </div>
      )}
    </div>
  );
}
