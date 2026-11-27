// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  EVENT_DIR_CHANGED,
  EVENT_DIR_GONE,
  on,
  parent,
  pathKey,
  textCheck,
  toWireError,
  unwatchDir,
  watchDir,
  type UnlistenFn,
  type WireError,
  type WirePath,
  type WireStamp,
} from "../ipc";
import { watchKeyOf } from "../editor/useTextDoc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";

// Whether the file of an open PDF is still the one that was opened or last saved. The folder of the
// file is watched; each change in it is checked against the stamp the document holds (the same
// check a text document makes), and the answer is `changed` (another program wrote it), `gone`
// (nothing is at the path any more) or `none`. A save is never made on the strength of this: the
// engine refuses to write over a file whose stamp is not the expected one, so this only tells the
// user sooner.

export type ExternalChange = "none" | "changed" | "gone";

export interface ExternalChangeArgs {
  tabId: string;
  /** The path of the document as it is now. */
  path: WirePath;
  /** The stamp of the file as opened or last saved; read when a check runs. */
  stamp: MutableRefObject<WireStamp | undefined>;
  /** Watching starts when the document has opened and ends with it. */
  ready: boolean;
}

export interface ExternalChangeState {
  change: ExternalChange;
  /** The folder watch could not be set or ended: changes on disk will not be noticed. */
  watchError: WireError | null;
  /** Checks the file now; answers what it found, or null when it could not be told. */
  check(): Promise<ExternalChange | null>;
  /** Sets what is known without looking: the file was just written, or a save found it changed. */
  set(change: ExternalChange): void;
  /** A save is running: changes it makes itself are not reported, and a check is made when it ends. */
  hold(held: boolean): void;
}

const say = (text: string) => useOps.getState().notify(text);

export function useExternalChange(args: ExternalChangeArgs): ExternalChangeState {
  const { tabId, path, ready } = args;
  const key = pathKey(path);
  const [change, setChange] = useState<ExternalChange>("none");
  const [watchError, setWatchError] = useState<WireError | null>(null);
  const latest = useRef(args);
  useLayoutEffect(() => {
    latest.current = args;
  });
  const held = useRef(false);
  // A check that overlaps an earlier one is not run twice: the later answer is the one kept.
  const checking = useRef(0);

  const check = useCallback(async (): Promise<ExternalChange | null> => {
    const { path: at, stamp } = latest.current;
    const expected = stamp.current;
    if (expected === undefined || held.current) return null;
    const mine = ++checking.current;
    try {
      const verdict = await textCheck(at, expected);
      // Another check began, or the document was saved meanwhile: this answer is of an older file.
      if (mine !== checking.current || held.current || stamp.current !== expected) return null;
      const next: ExternalChange =
        verdict === "changed" ? "changed" : verdict === "deleted" ? "gone" : "none";
      setChange(next);
      return next;
    } catch (e) {
      // Not knowing is said: nothing would otherwise tell the file is not being watched.
      if (mine === checking.current) {
        say(
          `Kern could not check whether ${baseName(at)} changed on disk: ${errorText(toWireError(e))}`
        );
      }
      return null;
    }
  }, []);

  const hold = useCallback(
    (on: boolean) => {
      held.current = on;
      if (!on) void check();
    },
    [check]
  );

  // The watch on the folder, for as long as the document is open at this path.
  const chain = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!ready) return;
    const watchKey = watchKeyOf(tabId);
    const target = path;
    let alive = true;
    let watching = false;
    const unlisten: UnlistenFn[] = [];

    const stop = () => {
      if (!watching) return;
      watching = false;
      chain.current = chain.current.then(() =>
        unwatchDir(watchKey).catch((e: unknown) =>
          say(
            `The watch on the folder of ${baseName(target)} did not end: ${errorText(toWireError(e))}`
          )
        )
      );
    };
    const start = async () => {
      await chain.current;
      if (!alive || watching) return;
      const folder = parent(target);
      if (!folder) {
        setWatchError({
          kind: "Ipc",
          message: "the file has no folder to watch",
          path: null,
          details: null,
        });
        return;
      }
      try {
        await watchDir(watchKey, folder);
        watching = true;
        if (!alive) stop();
        else setWatchError(null);
      } catch (e) {
        if (alive) setWatchError(toWireError(e));
      }
    };

    (async () => {
      // Subscribe first, so a change between the open and the watch is not missed.
      try {
        const [changed, gone] = await Promise.all([
          on(EVENT_DIR_CHANGED, (ev) => {
            if (ev.key === watchKey) void check();
          }),
          on(EVENT_DIR_GONE, (ev) => {
            if (ev.key !== watchKey) return;
            watching = false;
            if (ev.error) setWatchError(ev.error);
            // The folder is gone, so the file is too, unless it came back: the check says.
            void check().then((found) => {
              if (alive && !ev.error && found !== "gone") void start();
            });
            if (!ev.error) setChange("gone");
          }),
        ]);
        if (alive) unlisten.push(changed, gone);
        else {
          changed();
          gone();
        }
      } catch (e) {
        if (alive) setWatchError(toWireError(e));
      }
      await start();
      // A change between the open and the watch is found now.
      if (alive) void check();
    })();

    return () => {
      alive = false;
      unlisten.forEach((u) => u());
      stop();
    };
  }, [ready, tabId, key, check]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = useCallback((next: ExternalChange) => {
    checking.current += 1;
    setChange(next);
  }, []);

  return { change, watchError, check, set, hold };
}
