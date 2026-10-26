// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState } from "react";
import { toWireError, userDirs, type WireError } from "./ipc";
import MainWindow from "./shell/MainWindow";
import { useTabs } from "./store/tabs";
import { useTheme } from "./theme/useTheme";

export default function App() {
  const { error, problems } = useTheme();
  const [homeError, setHomeError] = useState<WireError | null>(null);
  const tabCount = useTabs((s) => s.tabs.length);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Design 4.4 names a Home folder tab for the main window, and the window
  // never sits without a tab: a new window, and closing the last tab, both
  // open Home. Opened only if nothing else opened a tab while the lookup ran.
  const openHome = useCallback(() => {
    setHomeError(null);
    userDirs().then(
      (dirs) => {
        if (mounted.current && useTabs.getState().tabs.length === 0) {
          useTabs.getState().openFolder(dirs.home, false);
        }
      },
      (e: unknown) => mounted.current && setHomeError(toWireError(e))
    );
  }, []);

  useEffect(() => {
    if (tabCount === 0 && homeError === null) openHome();
  }, [tabCount, homeError, openHome]);

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
          <button type="button" onClick={openHome}>
            Retry
          </button>
        </p>
      )}
      {problems.length > 0 && (
        <ul role="status" aria-label="System theme problems">
          {problems.map((p) => (
            <li key={JSON.stringify(p)}>
              {p.kind}: {p.message}
            </li>
          ))}
        </ul>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <MainWindow />
      </div>
    </div>
  );
}
