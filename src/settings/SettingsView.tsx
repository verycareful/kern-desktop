// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { NO_FILE_KEYS_ATTR } from "../keys/file-keys";
import { errorText } from "../ops/error-text";
import { corruptText, useStoreErrors } from "../store/store-errors";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { EditorSection } from "./EditorSection";
import { FilesSection } from "./FilesSection";
import { SETTINGS_FILE, useSettings } from "./settings-store";
import "./settings.css";

// The Settings tab: Appearance, Files, Editor and About. Each
// change is stored at once (settings-store.ts); one that fails is said at the
// top until the next one succeeds. A settings.json Kern could not read is
// reported here, as it was found: what was wrong and where the file went.

export function SettingsView() {
  const settings = useSettings((s) => s.settings);
  const loadError = useSettings((s) => s.loadError);
  const problem = useSettings((s) => s.problem);
  const listenError = useSettings((s) => s.listenError);
  // The whole list is selected and filtered here: a filtered list made in the selector is a new
  // array on every read, which the store takes for a change.
  const reports = useStoreErrors((s) => s.reports).filter((r) => r.file === SETTINGS_FILE);
  const reportsError = useStoreErrors((s) => s.error);

  useEffect(() => {
    let live = true;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => (live ? stops.push(stop) : stop());
    void useSettings.getState().follow().then(keep);
    void useStoreErrors.getState().follow().then(keep);
    return () => {
      live = false;
      stops.forEach((stop) => stop());
    };
  }, []);

  return (
    <div className="kern-settings" data-testid="settings-view" {...{ [NO_FILE_KEYS_ATTR]: "" }}>
      <h1 className="kern-settings-title">Settings</h1>
      {reports.map((r, i) => (
        <div key={i} role="alert" className="kern-banner">
          {corruptText(r)}
        </div>
      ))}
      {reportsError && (
        <div role="alert" className="kern-banner">
          The reports of unreadable settings files could not be read: {errorText(reportsError)}
        </div>
      )}
      {problem && (
        <div role="alert" className="kern-banner" data-testid="settings-problem">
          {problem}
        </div>
      )}
      {listenError && (
        <div role="alert" className="kern-banner">
          Settings changed in another window will not show here: {errorText(listenError)}
        </div>
      )}
      {loadError && (
        <div role="alert" className="kern-banner">
          The settings could not be read: {errorText(loadError)}{" "}
          <button
            type="button"
            className="kern-button"
            onClick={() => void useSettings.getState().reload()}
          >
            Retry
          </button>
        </div>
      )}
      {!settings && !loadError && <p role="status">Reading the settings…</p>}
      {settings && (
        <>
          <AppearanceSection settings={settings} />
          <FilesSection settings={settings} />
          <EditorSection settings={settings} />
        </>
      )}
      <AboutSection />
    </div>
  );
}
