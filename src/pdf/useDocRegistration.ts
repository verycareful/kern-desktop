// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  EVENT_DOC_RELEASED,
  docClosed,
  docOpened,
  on,
  pathKey,
  toWireError,
  type Location,
  type UnlistenFn,
  type WirePath,
  type WireReadOnly,
} from "../ipc";
import { placeKey, tabPlace } from "../editor/useTextDoc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";

// Tells the backend that a document is open at a place (a tab, or a window of its own), so a
// file is open in one place at a time, and lets go when the document closes. It is the
// registration of useTextDoc for a document that has no watch and no text: a refusal because
// another place holds the file leaves the document shown and read-only, and it is tried again
// when any place lets go of a document.

export interface DocRegistration {
  tabId: string;
  path: WirePath;
  /** Where the document is open; a tab of this id by default. */
  location?: Location;
  /** The caller registered the document as open here already (an adopted tab): not again. */
  registered?: boolean;
  /** Registration starts when the document has opened, and ends with it. */
  ready: boolean;
  /** Another place holds the file (the reason), or lets go of it (null). */
  onHeld(held: WireReadOnly | null): void;
  /** Whether the backend took the registration, each time it is tried. */
  onRegistered?(ok: boolean): void;
}

/** What a save as needs of the registration: to wait for it, and to know the tab is gone. */
export interface DocRegistrationHandle {
  /** Settles when the registrations and releases sent so far have been answered. */
  settled(): Promise<unknown>;
  /** The tab's component has unmounted (as against a new path or place). */
  unmounted(): boolean;
}

const say = (text: string) => useOps.getState().notify(text);

export function useDocRegistration(args: DocRegistration): DocRegistrationHandle {
  const { tabId, path, ready } = args;
  const key = pathKey(path);
  const here = args.location ?? tabPlace(tabId);
  const locationKey = placeKey(here);
  const latest = useRef(args);
  useLayoutEffect(() => {
    latest.current = args;
  });
  // The path the caller registered already, until this hook's first registration would repeat it.
  const preRegistered = useRef(args.registered ? key : null);
  // Registrations and releases go to the backend in order, so a release never lands after the
  // next registration of the same document and removes it.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // Set when the registration effect first runs: from then on it releases the document.
  const ran = useRef(false);
  // True once the tab's component has unmounted, as against an effect that runs again for a new
  // path or place. Declared before the effect whose cleanup reads it, so on an unmount it is set
  // first.
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const target = path;
    const where: Location = args.location ?? tabPlace(tabId);
    let alive = true;
    // True once the backend holds this document for this place.
    let taken = false;
    // Whether the last refusal was "another place has it open", which a later try may undo.
    let refusedAsHeld = false;
    let retrying = false;
    const unlisten: UnlistenFn[] = [];

    const skip = preRegistered.current === key;
    preRegistered.current = null;
    useTabs.getState().spent(tabId, "registered");
    ran.current = true;

    const tryRegister = (first: boolean) =>
      chain.current
        .then(() => (skip && first ? undefined : docOpened(target, where)))
        .then(
          () => true,
          (e: unknown) => {
            const err = toWireError(e);
            if (err.kind === "AlreadyOpen") {
              // Another place has the file open: this copy is shown, never saved over it.
              refusedAsHeld = true;
              latest.current.onHeld({ kind: "OpenElsewhere", detail: err.message });
            } else {
              refusedAsHeld = false;
              say(`${baseName(target)} could not be registered as open: ${errorText(err)}`);
            }
            return false;
          }
        );
    const registered = tryRegister(true);
    chain.current = registered;

    const retry = () => {
      if (taken || retrying || !alive || !refusedAsHeld) return;
      retrying = true;
      const attempt = tryRegister(false);
      chain.current = attempt;
      void attempt.then((ok) => {
        retrying = false;
        if (!ok) return;
        taken = true;
        if (!alive) return;
        latest.current.onHeld(null);
        latest.current.onRegistered?.(true);
      });
    };
    void registered.then((ok) => {
      taken = ok;
      latest.current.onRegistered?.(ok);
      if (ok || !refusedAsHeld || !alive) return;
      on(EVENT_DOC_RELEASED, retry).then(
        (off) => {
          if (alive) {
            unlisten.push(off);
            // The other place may have let go before this listened.
            retry();
          } else off();
        },
        (e: unknown) =>
          say(
            `${baseName(target)} will not become editable when the other window lets go of it: ${errorText(toWireError(e))}`
          )
      );
    });

    return () => {
      alive = false;
      unlisten.forEach((u) => u());
      // A tab that closes tells the backend its tab is gone, so whatever is held at it goes,
      // whether or not this path's registration was taken. A path released because the document
      // moved to another file releases only that path.
      const gone = unmounted.current;
      chain.current = chain.current.then(() => {
        if (!taken && !gone) return;
        return (gone ? docClosed(target, where, true) : docClosed(target, where)).catch(
          (e: unknown) =>
            say(`${baseName(target)} could not be released: ${errorText(toWireError(e))}`)
        );
      });
    };
  }, [ready, tabId, key, locationKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tab that closes without its registration effect ever running (its file did not open) lets
  // go of the path the backend held for it when the file was routed here.
  const place = useRef({ path, here });
  useLayoutEffect(() => {
    place.current = { path, here };
  });
  useEffect(
    () => () => {
      // An adopted document was registered by the caller; a document that got as far as
      // registering is released by the effect above.
      if (ran.current || latest.current.registered) return;
      const { path: p, here: h } = place.current;
      docClosed(p, h, true).catch(() => undefined);
    },
    []
  );
  return useMemo(() => ({ settled: () => chain.current, unmounted: () => unmounted.current }), []);
}
