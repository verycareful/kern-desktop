// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, LayoutGrid, List, Search, X } from "lucide-react";
import {
  displayPath,
  documents,
  pathKey,
  type WireEntry,
  type WireError,
  type WirePath,
} from "../ipc";
import { NO_FILE_KEYS_ATTR } from "../keys/file-keys";
import { logError } from "../ops/error-log";
import { errorText } from "../ops/error-text";
import { ErrorBanner } from "../ops/ErrorBanner";
import { plural } from "../ops/labels";
import { ActionButton } from "../shell/ActionButton";
import { homeRelative } from "../shell/home-relative";
import { useUserDirs } from "../shell/user-dirs-store";
import { registerDocuments } from "./documents-controller";
import { openFiles } from "./open-entries";
import { ScanGrid } from "./ScanGrid";
import { ScanResults } from "./ScanResults";
import { useScan } from "./use-scan";
import { setScanFolder, useViewSettings } from "./view-settings";
import { RepeatFlash } from "../ops/repeat-flash";

// The Library: every document under the Documents and
// Downloads folders, each when its switch is on, and under the folders the
// settings add (scan_roots), found by a walk and shown as found. A switch
// is the stored setting, so it holds in every window and after a restart;
// changing one walks again, and so does F5. A folder the switches name that
// does not exist is said, never skipped quietly.
//
// The toolbar row holds the switches, Look again, a filter by name, the view (list or cards) and
// hidden items. The view and hidden items are the file manager's own settings, so they are the
// same here and in a folder; hidden items change what the walk looks at, so it walks again.

export function DocumentsView(props: { tabId: string }) {
  const settings = useViewSettings();
  const dirs = useUserDirs((s) => s.dirs);
  const dirsError = useUserDirs((s) => s.error);
  const home = dirs?.home ?? null;
  const scan = useScan();
  const { start, stop } = scan;
  const [openErrors, setOpenErrors] = useState<WireError[]>([]);
  const [tick, setTick] = useState(0);
  const { showHidden, viewMode } = settings;
  const [filtering, setFiltering] = useState(false);
  const [query, setQuery] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    useUserDirs
      .getState()
      .load()
      .catch(() => undefined);
  }, []);
  const toggleFilter = useCallback(() => {
    setFiltering((on) => !on);
    setQuery("");
  }, []);
  useEffect(() => {
    if (filtering) filterInput.current?.focus();
  }, [filtering]);
  useEffect(
    () => registerDocuments({ refresh: () => setTick((t) => t + 1), toggleFilter }),
    [toggleFilter]
  );

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
    start((key) => documents(key, plan.roots, showHidden));
    // `rootsKey` stands for `plan.roots`; `tick` is a request to walk again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, rootsKey, showHidden, tick, start, stop]);

  // The filter narrows what the walk has found so far, and what it finds from now on.
  const needle = filtering ? query.trim().toLowerCase() : "";
  const shown = useMemo(
    () =>
      needle === ""
        ? scan.hits
        : scan.hits.slice(0, scan.count).filter((h) => h.name.toLowerCase().includes(needle)),
    // `scan.count` stands for the growth of `scan.hits`, which is the same array.
    [needle, scan.hits, scan.count]
  );
  const shownCount = needle === "" ? scan.count : shown.length;
  const ended = scan.phase === "done" || scan.phase === "failed";

  const onOpen = useCallback((entry: WireEntry, newWindow: boolean) => {
    void openFiles([entry.path], newWindow).then((errors) => {
      if (errors.length > 0) setOpenErrors(errors);
      errors.forEach((e) => logError("open", errorText(e)));
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
      <div className="kern-folder-toolbar" role="toolbar" aria-label="Library">
        <h2 className="kern-label kern-toolbar-title">Library</h2>
        <span className="kern-toolbar-sep" aria-hidden />
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
        <span className="kern-toolbar-sep" aria-hidden />
        <button
          type="button"
          className="kern-icon-button"
          aria-label="Filter the Library by name"
          aria-pressed={filtering}
          title="Filter the Library by name (Ctrl+F)"
          onClick={toggleFilter}
        >
          <Search size={20} strokeWidth={2} aria-hidden />
        </button>
        <span className="kern-toolbar-sep" aria-hidden />
        <div className="kern-view-toggle" role="group" aria-label="View">
          <ActionButton
            id="folder.view.list"
            icon={List}
            targetId={props.tabId}
            pressed={viewMode === "list"}
            enabled
          />
          <ActionButton
            id="folder.view.grid"
            icon={LayoutGrid}
            targetId={props.tabId}
            pressed={viewMode === "grid"}
            enabled
          />
        </div>
        <ActionButton
          id="folder.hidden.toggle"
          icon={showHidden ? Eye : EyeOff}
          targetId={props.tabId}
          pressed={showHidden}
        />
      </div>
      <div className="kern-search" {...{ [NO_FILE_KEYS_ATTR]: "" }}>
        {filtering && (
          <div className="kern-search-bar" role="search">
            <label className="kern-label" htmlFor="kern-library-filter">
              Filter by name
            </label>
            <input
              id="kern-library-filter"
              ref={filterInput}
              type="search"
              className="kern-modal-input kern-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  toggleFilter();
                }
              }}
            />
            <button
              type="button"
              className="kern-icon-button"
              aria-label="Close the filter"
              onClick={toggleFilter}
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>
        )}
        {settings.error && (
          <div role="alert" className="kern-banner">
            Settings: {errorText(settings.error)}
            <RepeatFlash watch={settings.error} />
          </div>
        )}
        {dirsError && (
          <div role="alert" className="kern-banner">
            The user&apos;s folders could not be looked up: {errorText(dirsError)}
            <RepeatFlash watch={dirsError} />
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
            <RepeatFlash watch={scan.error} />
          </div>
        )}
        {openErrors.length > 0 && (
          <ErrorBanner onDismiss={() => setOpenErrors([])} watch={openErrors}>
            <ul>
              {openErrors.map((e, i) => (
                <li key={i}>{errorText(e)}</li>
              ))}
            </ul>
          </ErrorBanner>
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
            {needle !== "" && ` ${plural(shownCount, "match", "matches")} for the filter.`}
          </div>
        )}
        <div className="kern-search-results">
          {viewMode === "grid" ? (
            <ScanGrid
              // A new run is a new list: the selection starts again.
              key={scan.run}
              hits={shown}
              count={shownCount}
              label="Library"
              area="centre"
              complete={ended}
              onOpen={onOpen}
            />
          ) : (
            <ScanResults
              // A new run is a new list: the active row starts at the top again.
              key={scan.run}
              hits={shown}
              count={shownCount}
              home={home}
              label="Library"
              area="centre"
              complete={ended}
              onOpen={onOpen}
            />
          )}
        </div>
      </div>
    </div>
  );
}
