// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  EVENT_DOC_MOVED,
  on,
  pathKey,
  pdfClose,
  pdfOpen,
  toWireError,
  type Location,
  type PdfHandle,
  type UnlistenFn,
  type WireError,
  type WirePath,
  type WireReadOnly,
  type WireStamp,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { ensureSystemFonts } from "./system-fonts";
import { useDocRegistration } from "./useDocRegistration";

// One open PDF. The hook owns the engine's handle for the document: it opens on mount, asks for
// the password an encrypted file needs, and closes the handle when the tab goes, so the engine
// never holds a document no tab shows. The document is open at one place at a time, as a text
// document is (useDocRegistration).

export type PdfPhase = "opening" | "needs-password" | "ready" | "failed";

export interface PdfDoc {
  phase: PdfPhase;
  /** Why the file did not open; while a password is asked for, that the last one was wrong. */
  error?: WireError;
  handle?: PdfHandle;
  pages: number;
  revision: number;
  /** The file as it was opened, for the save that has to know it did not change. */
  stamp?: WireStamp;
  /** Another place holds the file: it is shown and not saved. */
  readOnly: WireReadOnly | null;
  /** Opens the file, with `password` when it is encrypted; the phase says how it went. */
  open(password?: string): Promise<void>;
  /** The password was not given: the tab fails with that as its reason. */
  cancelPassword(): void;
}

export interface PdfDocOptions {
  /** Where the document is open, for the backend's registry; a tab of this id by default. */
  location?: Location;
  /** The caller registered the document as open here already (an adopted tab): not again. */
  registered?: boolean;
  /** Called with whether the backend took the registration, each time it is tried. */
  onRegistered?: (ok: boolean) => void;
}

interface State {
  phase: PdfPhase;
  error?: WireError;
  handle?: PdfHandle;
  pages: number;
  revision: number;
  stamp?: WireStamp;
  readOnly: WireReadOnly | null;
}

const OPENING: State = { phase: "opening", pages: 0, revision: 0, readOnly: null };

const say = (text: string) => useOps.getState().notify(text);

export function usePdfDoc(tabId: string, path: WirePath, opts: PdfDocOptions = {}): PdfDoc {
  const [state, setState] = useState<State>(OPENING);
  const key = pathKey(path);
  const latestPath = useRef(path);
  useLayoutEffect(() => {
    latestPath.current = path;
  });
  // Which open the answer belongs to. An answer that is not the latest one (the tab went, or the
  // file was asked for again) closes the document it opened and changes nothing.
  const generation = useRef(0);
  const handle = useRef<PdfHandle | null>(null);
  // The path a rename gave the document: the same document, not one to open again.
  const ownedKey = useRef<string | null>(null);

  const closeHandle = useCallback((h: PdfHandle) => {
    pdfClose(h).catch((e: unknown) =>
      say(`${baseName(latestPath.current)} could not be closed: ${errorText(toWireError(e))}`)
    );
  }, []);

  const release = useCallback(() => {
    generation.current += 1;
    const h = handle.current;
    handle.current = null;
    if (h !== null) closeHandle(h);
  }, [closeHandle]);

  const open = useCallback(
    async (password?: string) => {
      const mine = ++generation.current;
      setState((s) => ({ ...OPENING, readOnly: s.readOnly }));
      try {
        await ensureSystemFonts();
        const opened = await pdfOpen(latestPath.current, password);
        if (mine !== generation.current) {
          closeHandle(opened.handle);
          return;
        }
        // A document opened again replaces the one it was opened as before.
        const previous = handle.current;
        handle.current = opened.handle;
        if (previous !== null) closeHandle(previous);
        setState((s) => ({
          phase: "ready",
          handle: opened.handle,
          pages: opened.pages,
          revision: opened.revision,
          stamp: opened.stamp,
          readOnly: s.readOnly,
        }));
      } catch (e) {
        if (mine !== generation.current) return;
        const err = toWireError(e);
        setState((s) =>
          err.kind === "WrongPassword"
            ? {
                ...OPENING,
                phase: "needs-password",
                // The first ask has no error; a password that was tried and refused does.
                error: password === undefined ? undefined : err,
                readOnly: s.readOnly,
              }
            : { ...OPENING, phase: "failed", error: err, readOnly: s.readOnly }
        );
      }
    },
    [closeHandle]
  );

  const cancelPassword = useCallback(() => {
    setState((s) =>
      s.phase !== "needs-password"
        ? s
        : {
            ...s,
            phase: "failed",
            error: {
              kind: "NoPassword",
              message: `${baseName(latestPath.current)} is encrypted and no password was given.`,
              path: null,
              details: null,
            },
          }
    );
  }, []);

  // ---- open, and close with the tab ----
  // The tab's component lives as long as the tab does, and its path changes only when the file is
  // renamed (the document stays) or saved elsewhere, so the handle is the component's: opened for
  // the path it mounts with, closed when it unmounts.
  useEffect(() => {
    if (ownedKey.current === key) return;
    void open();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => release, [release]);

  // ---- the file is renamed or moved inside Kern ----
  // The backend has registered the document under its new path already; the tab takes that path.
  // The handle stays: the bytes it holds are the file's, whatever the file is called now.
  const ready = state.phase === "ready";
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const unlisten: UnlistenFn[] = [];
    on(EVENT_DOC_MOVED, (ev) => {
      if (pathKey(latestPath.current) !== pathKey(ev.from)) return;
      ownedKey.current = pathKey(ev.to);
      useTabs.getState().retargetDoc(tabId, ev.to);
    }).then(
      (off) => {
        if (alive) unlisten.push(off);
        else off();
      },
      (e: unknown) =>
        say(
          `${baseName(latestPath.current)} will not follow a rename or a move: ${errorText(toWireError(e))}`
        )
    );
    return () => {
      alive = false;
      unlisten.forEach((u) => u());
    };
  }, [ready, tabId]);

  // ---- registration with the backend ----
  const onHeld = useCallback((held: WireReadOnly | null) => {
    setState((s) => ({ ...s, readOnly: held }));
  }, []);
  useDocRegistration({
    tabId,
    path,
    location: opts.location,
    registered: opts.registered,
    ready,
    onHeld,
    onRegistered: opts.onRegistered,
  });

  return useMemo(() => ({ ...state, open, cancelPassword }), [state, open, cancelPassword]);
}
