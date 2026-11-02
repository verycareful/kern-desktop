// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  allApps,
  appsFor,
  launchApp,
  setDefaultApp,
  settingsGet,
  toWireError,
  type WireApp,
  type WireAppList,
  type WireEntry,
  type WireError,
} from "../ipc";
import { Modal } from "../ops/Modal";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";

// Open with (design 5.6): the applications that say they take the file's type,
// and under "Other application..." every application, filtered by name. The
// chosen one opens the file; with "Always use it for this type" ticked it is
// made the default for the type first. Application entries that could not be
// read are listed, never left out quietly. A failure keeps the dialog open
// with the reason, for another try.

/**
 * Types that say only that a file's type is not known (Shared MIME-info Database 0.21, the
 * fallback for data). A default for one would open every such file with that application.
 */
const UNTYPED = ["application/octet-stream"];

type Listing =
  | { state: "loading" }
  | { state: "ready"; list: WireAppList }
  | { state: "failed"; error: WireError };

function useApps(load: (() => Promise<WireAppList>) | null): Listing {
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  useEffect(() => {
    if (!load) return;
    let live = true;
    setListing({ state: "loading" });
    load().then(
      (list) => live && setListing({ state: "ready", list }),
      (e: unknown) => live && setListing({ state: "failed", error: toWireError(e) })
    );
    return () => {
      live = false;
    };
  }, [load]);
  return listing;
}

export function OpenWithDialog(props: { entry: WireEntry; onClose(): void }) {
  const { entry, onClose } = props;
  const id = useId();
  const [others, setOthers] = useState(false);
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<WireApp | null>(null);
  const [always, setAlways] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const forType = useMemo(() => () => appsFor(entry.path), [entry.path]);
  const suggested = useApps(forType);
  const every = useApps(others ? allApps : null);
  const listing = others ? every : suggested;
  const shown =
    listing.state === "ready"
      ? listing.list.apps.filter(
          (a) => !others || a.name.toLowerCase().includes(filter.trim().toLowerCase())
        )
      : [];

  // Only an application on show can be the one that opens the file: one chosen and then
  // filtered away, or left behind in the other list, is not.
  const picked = chosen && shown.some((a) => a.id === chosen.id) ? chosen : null;
  const settable = !UNTYPED.includes(entry.mime);

  const open = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Everything that can fail before the open is done before the default is changed, so a
      // failure leaves the default as it was.
      let terminal: string | null;
      try {
        terminal = (await settingsGet()).terminal;
      } catch (e) {
        throw new Error(
          `The terminal setting could not be read, so the file was not opened: ${errorText(toWireError(e))}`
        );
      }
      const setDefault = always && settable;
      if (setDefault) {
        try {
          await setDefaultApp(picked.id, entry.mime);
        } catch (e) {
          throw new Error(
            `${picked.name} could not be made the default for ${entry.mime}, so the file was not opened: ${errorText(toWireError(e))}`
          );
        }
      }
      try {
        await launchApp(picked.id, [entry.path], terminal ?? undefined);
      } catch (e) {
        const changed = setDefault ? ` ${picked.name} is now the default for ${entry.mime}.` : "";
        throw new Error(
          `${picked.name} could not open ${entry.name}: ${errorText(toWireError(e)).replace(/\.$/, "")}.${changed}`
        );
      }
      useOps.getState().notify(`Opened ${entry.name} with ${picked.name}`);
      onClose();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <Modal
      role="dialog"
      label={`Open ${entry.name} with`}
      onEscape={onClose}
      className="kern-modal-wide"
      testId="open-with-dialog"
    >
      <h2 className="kern-modal-title">Open {entry.name} with</h2>
      {others && (
        <input
          type="search"
          className="kern-modal-input"
          aria-label="Filter applications"
          placeholder="Filter applications"
          spellCheck={false}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      {listing.state === "loading" && (
        <p role="status" className="kern-modal-text">
          Looking for applications…
        </p>
      )}
      {listing.state === "failed" && (
        <p role="alert" className="kern-modal-error">
          The applications could not be listed: {errorText(listing.error)}
        </p>
      )}
      {listing.state === "ready" && shown.length === 0 && (
        <p className="kern-modal-text">
          {others
            ? "No application matches."
            : `No application says it opens ${entry.mime}. Other application… lists them all.`}
        </p>
      )}
      {shown.length > 0 && (
        <fieldset className="kern-open-with-list">
          <legend className="kern-modal-text">
            {others ? "Every application" : `Applications for ${entry.mime}`}
          </legend>
          {shown.map((a) => (
            <label key={a.id} className="kern-modal-check">
              <input
                type="radio"
                name={`${id}-app`}
                checked={picked?.id === a.id}
                onChange={() => setChosen(a)}
              />
              {a.name}
            </label>
          ))}
        </fieldset>
      )}
      {listing.state === "ready" && listing.list.problems.length > 0 && (
        <details className="kern-modal-text">
          <summary>
            {listing.list.problems.length === 1
              ? "1 application entry could not be read"
              : `${listing.list.problems.length} application entries could not be read`}
          </summary>
          <ul>
            {listing.list.problems.map((p, i) => (
              <li key={i}>{errorText(p)}</li>
            ))}
          </ul>
        </details>
      )}
      {!others && (
        <button type="button" className="kern-button" onClick={() => setOthers(true)}>
          Other application…
        </button>
      )}
      {settable ? (
        <label className="kern-modal-check">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
          Always use it for {entry.mime}
        </label>
      ) : (
        <p className="kern-modal-text">
          The type of {entry.name} is not known, so no default can be set for it.
        </p>
      )}
      {error && (
        <p role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
      <div className="kern-modal-actions">
        <button
          type="button"
          className="kern-button"
          disabled={!picked || busy}
          onClick={() => void open()}
        >
          Open
        </button>
        <button type="button" className="kern-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
