// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  displayPath,
  documents,
  pathKey,
  type WireEntry,
  type WireError,
  type WirePath,
} from "../ipc";
import { NO_FILE_KEYS_ATTR } from "../keys/file-keys";
import { errorText } from "../ops/error-text";
import { plural } from "../ops/labels";
import { homeRelative } from "../shell/home-relative";
import { useUserDirs } from "../shell/user-dirs-store";
import { registerDocuments } from "./documents-controller";
import { openFiles } from "./open-entries";
import { ScanResults } from "./ScanResults";
import { useScan } from "./use-scan";
import { setScanFolder, useViewSettings } from "./view-settings";

// All documents: every document under the Documents and
// Downloads folders, each when its switch is on, and under the folders the
// settings add (scan_roots), found by a walk and shown as found. A switch
// is the stored setting, so it holds in every window and after a restart;
// changing one walks again, and so does F5. A folder the switches name that
// does not exist is said, never skipped quietly.

export function DocumentsView() {
  const settings = useViewSettings();
  const dirs = useUserDirs((s) => s.dirs);
  const dirsError = useUserDirs((s) => s.error);
  const home = dirs?.home ?? null;
  const scan = useScan();
  const { start, stop } = scan;
  const [openErrors, setOpenErrors] = useState<WireError[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    useUserDirs
      .getState()
      .load()
      .catch(() => undefined);
  }, []);
  useEffect(() => registerDocuments({ refresh: () => setTick((t) => t + 1) }), []);

  const plan = useMemo(() => {
    const roots: WirePath[] = [];
    const missing: string[] = [];
    const add = (p: WirePath) => {
      if (!roots.some((r) => pathKey(r) === pathKey(p))) roots.push(p);
    };
    const xdg = (name: string, label: string, on: boolean) => {
      if (!on || !dirs) return;
      const found = dirs.dirs.find((d) => d.name === name);
      if (found) add(found.path);
      else missing.push(label);
    };
    xdg("documents", "Documents", settings.scanDocuments);
    xdg("download", "Downloads", settings.scanDownloads);
    settings.scanRoots.forEach(add);
    return { roots, missing };
  }, [dirs, settings.scanDocuments, settings.scanDownloads, settings.scanRoots]);

  // The walk waits for the settings and the user's folders, which say where to look.
  const ready = settings.loaded && dirs !== null;
  const rootsKey = plan.roots.map(pathKey).join("\n");
  useEffect(() => {
    if (!ready || plan.roots.length === 0) {
      stop();
      return;
    }
    start((key) => documents(key, plan.roots));
    // `rootsKey` stands for `plan.roots`; `tick` is a request to walk again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, rootsKey, tick, start, stop]);

  const onOpen = useCallback((entry: WireEntry, newWindow: boolean) => {
    void openFiles([entry.path], newWindow).then((errors) => {
      if (errors.length > 0) setOpenErrors(errors);
    });
  }, []);

  let status: React.ReactNode = null;
  if (scan.phase === "running") status = `Looking… ${plural(scan.count, "found", "found")}`;
  else if (scan.phase === "done" && scan.done) {
    const d = scan.done;
    status = (
      <>
        {d.found === 0 ? "No documents were found." : plural(d.found, "document", "documents")}
        {d.cancelled && " The walk was stopped before the end."}
        {d.unreadable.length > 0 && (
          <details>
            <summary>{plural(d.unreadable.length, "folder", "folders")} could not be read</summary>
            <ul>
              {d.unreadable.map((p, i) => (
                <li key={i}>{displayPath(p)}</li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }

  return (
    <div className="kern-files" data-testid="documents-view">
      <div className="kern-search" {...{ [NO_FILE_KEYS_ATTR]: "" }}>
        <div className="kern-search-bar kern-documents-bar" role="group" aria-label="Where to look">
          <h2 className="kern-label">All documents</h2>
          <label className="kern-modal-check">
            <input
              type="checkbox"
              checked={settings.scanDocuments}
              disabled={!settings.loaded}
              onChange={(e) => void setScanFolder("documents", e.target.checked)}
            />
            Documents
          </label>
          <label className="kern-modal-check">
            <input
              type="checkbox"
              checked={settings.scanDownloads}
              disabled={!settings.loaded}
              onChange={(e) => void setScanFolder("downloads", e.target.checked)}
            />
            Downloads
          </label>
          <button
            type="button"
            className="kern-button"
            disabled={!ready || plan.roots.length === 0}
            onClick={() => setTick((t) => t + 1)}
          >
            Look again
          </button>
        </div>
        {settings.error && (
          <div role="alert" className="kern-banner">
            Settings: {errorText(settings.error)}
          </div>
        )}
        {dirsError && (
          <div role="alert" className="kern-banner">
            The user&apos;s folders could not be looked up: {errorText(dirsError)}
          </div>
        )}
        {plan.missing.length > 0 && (
          <div role="alert" className="kern-banner">
            There is no {plan.missing.join(" or ")} folder to look in (xdg-user-dirs names none).
          </div>
        )}
        {scan.phase === "failed" && scan.error && (
          <div role="alert" className="kern-banner">
            The documents could not be looked for: {errorText(scan.error)}
          </div>
        )}
        {openErrors.length > 0 && (
          <div role="alert" className="kern-banner">
            <ul>
              {openErrors.map((e, i) => (
                <li key={i}>{errorText(e)}</li>
              ))}
            </ul>
            <button
              type="button"
              className="kern-icon-button"
              aria-label="Dismiss"
              onClick={() => setOpenErrors([])}
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>
        )}
        {ready && plan.roots.length === 0 ? (
          <p className="kern-note-body">
            There is nowhere to look: turn on Documents or Downloads, or add folders in the
            settings.
          </p>
        ) : (
          plan.roots.length > 0 && (
            <p className="kern-note-body" data-testid="documents-roots">
              Looking in {plan.roots.map((r) => homeRelative(r, home)).join(", ")}
            </p>
          )
        )}
        {status && (
          <div role="status" className="kern-note-body">
            {status}
          </div>
        )}
        <div className="kern-search-results">
          <ScanResults
            // A new run is a new list: the active row starts at the top again.
            key={scan.run}
            hits={scan.hits}
            count={scan.count}
            home={home}
            label="All documents"
            onOpen={onOpen}
          />
        </div>
      </div>
    </div>
  );
}
