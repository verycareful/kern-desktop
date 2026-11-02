// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { displayPath, search, type WireEntry, type WirePath } from "../ipc";
import { NO_FILE_KEYS_ATTR } from "../keys/file-keys";
import { errorText } from "../ops/error-text";
import { baseName, plural } from "../ops/labels";
import { useUserDirs } from "../shell/user-dirs-store";
import { ScanResults } from "./ScanResults";
import { useScan } from "./use-scan";
import { useViewSettings } from "./view-settings";

// Name search (Ctrl+F, plan Task 25): every name under the folder on show that
// contains what is typed, case aside, found as the folder tree is walked and
// shown as it is found. Hidden items are searched when they are shown. A new
// query cancels the walk before it, and so does closing the search (Escape,
// the close button), which gives the folder back.

/**
 * How long typing must pause before a query is searched. A walk of a large
 * tree is costly to start and stop, and 250 ms is about the gap between the
 * keystrokes of a word typed at an ordinary pace, so a word typed in one go
 * starts one walk.
 */
const SEARCH_DELAY_MS = 250;

export function SearchView(props: {
  root: WirePath;
  onClose(): void;
  onOpen(entry: WireEntry, newWindow: boolean): void;
}) {
  const { root } = props;
  const id = useId();
  const [query, setQuery] = useState("");
  const hidden = useViewSettings((s) => s.showHidden);
  const home = useUserDirs((s) => s.dirs?.home ?? null);
  const scan = useScan();
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const { start, stop } = scan;

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q === "") {
      stop();
      return;
    }
    const t = window.setTimeout(
      () => start((key) => search(key, [root], q, hidden)),
      SEARCH_DELAY_MS
    );
    return () => window.clearTimeout(t);
  }, [query, hidden, root, start, stop]);

  const where = baseName(root);
  let status: React.ReactNode = null;
  if (scan.phase === "running") {
    status = `Searching ${where}… ${plural(scan.count, "found", "found")}`;
  } else if (scan.phase === "done" && scan.done) {
    const d = scan.done;
    status = (
      <>
        {d.found === 0
          ? `Nothing in ${where} is named like that.`
          : plural(d.found, "item found", "items found")}
        {d.cancelled && " The search was stopped before the end."}
        {d.unreadable.length > 0 && (
          <details>
            <summary>
              {plural(d.unreadable.length, "folder", "folders")} could not be searched
            </summary>
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
    <div
      ref={area}
      className="kern-search"
      data-testid="search-view"
      {...{ [NO_FILE_KEYS_ATTR]: "" }}
    >
      <div className="kern-search-bar">
        <label htmlFor={`${id}-q`} className="kern-label">
          Search in {where}
        </label>
        <input
          id={`${id}-q`}
          ref={input}
          type="search"
          className="kern-modal-input kern-search-input"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              props.onClose();
            } else if (e.key === "ArrowDown" && scan.count > 0) {
              e.preventDefault();
              area.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
            }
          }}
        />
        <button
          type="button"
          className="kern-icon-button"
          aria-label="Close the search"
          onClick={props.onClose}
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>
      {scan.phase === "failed" && scan.error && (
        <div role="alert" className="kern-banner">
          The search could not run: {errorText(scan.error)}
        </div>
      )}
      {status && (
        <div role="status" className="kern-note-body">
          {status}
        </div>
      )}
      <div
        className="kern-search-results"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          props.onClose();
        }}
      >
        <ScanResults
          hits={scan.hits}
          count={scan.count}
          home={home}
          label={`Found in ${where}`}
          onOpen={props.onOpen}
        />
      </div>
    </div>
  );
}
