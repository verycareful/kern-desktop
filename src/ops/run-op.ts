// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  EVENT_OP_CONFLICT,
  EVENT_OP_DONE,
  EVENT_OP_PROGRESS,
  cancelOp,
  on,
  type OpConflictEvent,
  type OpDoneEvent,
  type OpId,
  type OpProgressEvent,
  type UnlistenFn,
} from "../ipc";

// A background operation as its caller sees it (kernkraft-tauri ops.rs): the
// start command answers with an id, progress arrives as kernkraft://op-progress,
// a name taken at the destination as kernkraft://op-conflict (the worker waits
// until it is answered or the operation is cancelled), and the end, once and
// last, as kernkraft://op-done carrying the report or the error. The events
// are subscribed before the operation starts, and any that arrive before the
// id is known are kept and sorted out when it is.

export interface RunningOp {
  /** Settles with the op-done event; rejects (with a WireError) if the start or the subscription failed. */
  done: Promise<OpDoneEvent>;
  /** Asks the operation to stop; it still ends with an op-done. Rejects if the id is unknown or the call fails. */
  cancel(): Promise<void>;
}

export function runOp(
  start: () => Promise<OpId>,
  onProgress: (p: OpProgressEvent) => void,
  /** Given, it receives each conflict of this operation; absent, conflicts are not subscribed to. */
  onConflict?: (c: OpConflictEvent) => void
): RunningOp {
  let resolveId!: (id: OpId) => void;
  let rejectId!: (e: unknown) => void;
  const idPromise = new Promise<OpId>((res, rej) => {
    resolveId = res;
    rejectId = rej;
  });
  // `cancel` may never be called; a rejected id must not surface as unhandled.
  idPromise.catch(() => undefined);

  const done = (async (): Promise<OpDoneEvent> => {
    const unlisten: UnlistenFn[] = [];
    let id: OpId | null = null;
    const early: {
      progress: OpProgressEvent[];
      done: OpDoneEvent[];
      conflicts: OpConflictEvent[];
    } = { progress: [], done: [], conflicts: [] };
    let finish!: (e: OpDoneEvent) => void;
    const ended = new Promise<OpDoneEvent>((res) => (finish = res));
    try {
      unlisten.push(
        await on(EVENT_OP_PROGRESS, (p) => {
          if (id === null) early.progress.push(p);
          else if (p.op === id) onProgress(p);
        })
      );
      if (onConflict) {
        unlisten.push(
          await on(EVENT_OP_CONFLICT, (c) => {
            if (id === null) early.conflicts.push(c);
            else if (c.op === id) onConflict(c);
          })
        );
      }
      unlisten.push(
        await on(EVENT_OP_DONE, (d) => {
          if (id === null) early.done.push(d);
          else if (d.op === id) finish(d);
        })
      );
      id = await start();
      resolveId(id);
      for (const p of early.progress) if (p.op === id) onProgress(p);
      for (const c of early.conflicts) if (c.op === id) onConflict?.(c);
      const mine = early.done.find((d) => d.op === id);
      if (mine) finish(mine);
      return await ended;
    } catch (e) {
      rejectId(e);
      throw e;
    } finally {
      unlisten.forEach((u) => u());
    }
  })();

  return { done, cancel: async () => cancelOp(await idPromise) };
}
