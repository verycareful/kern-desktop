// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useState } from "react";
import { toWireError, userDirs, type WireError } from "./ipc";
import MainWindow from "./shell/MainWindow";
import { useTabs } from "./store/tabs";
import { useTheme } from "./theme/useTheme";

export default function App() {
  const { error, problems } = useTheme();
  const [homeError, setHomeError] = useState<WireError | null>(null);

  // A new main window starts on the Home folder (design 4.4 names a Home
  // folder tab for the main window). Only when nothing else opened a tab first.
  useEffect(() => {
    let live = true;
    userDirs().then(
      (dirs) => {
        if (live && useTabs.getState().tabs.length === 0) {
          useTabs.getState().openFolder(dirs.home, false);
        }
      },
      (e: unknown) => live && setHomeError(toWireError(e))
    );
    return () => {
      live = false;
    };
  }, []);

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
          The Home folder could not be located: {homeError.kind}: {homeError.message}
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
