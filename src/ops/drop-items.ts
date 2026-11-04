// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { sameFilesystem, type WirePath } from "../ipc";
import { planDrop, type DropChoice, type DropPlan } from "./dnd";
import { useOps, type OpEnd } from "./useOps";

// What dropped items do: Ctrl copies, Shift moves, and with neither the filesystems
// decide per item, in one question to the backend. A move is for the items on the same
// filesystem as the destination folder, a copy for the others; an item the backend could not
// judge is shown with its error and left alone. The two halves run as two operations, each
// reported on its own. Used by a folder view and by an editor window's tree.

export interface DropHooks {
  /** Something went wrong with the drop, or with one item of it (`about`). */
  failed(error: unknown, about?: WirePath): void;
  /** Called once both halves have ended, with the destinations of what landed in the folder. */
  landed?(paths: WirePath[]): void;
  /** Start the copies and moves through the command that takes only those two (an editor window). */
  copyOrMoveOnly?: boolean;
}

export async function dropItems(
  choice: DropChoice,
  sources: WirePath[],
  dest: WirePath,
  hooks: DropHooks
): Promise<void> {
  let plan: DropPlan;
  if (choice === "by_filesystem") {
    try {
      plan = planDrop(sources, await sameFilesystem(sources, dest));
    } catch (e) {
      hooks.failed(e);
      return;
    }
  } else {
    plan = {
      move: choice === "move" ? sources : [],
      copy: choice === "copy" ? sources : [],
      failed: [],
    };
  }
  for (const f of plan.failed) hooks.failed(f.error, f.path);
  const halves = (
    [
      ["move", plan.move],
      ["copy", plan.copy],
    ] as const
  ).filter(([, list]) => list.length > 0);
  const landed: WirePath[] = [];
  let open = halves.length;
  const ended = (end: OpEnd) => {
    if (end.report) landed.push(...end.report.done.flatMap((d) => (d.dest ? [d.dest] : [])));
    if (--open === 0 && landed.length > 0) hooks.landed?.(landed);
  };
  for (const [kind, list] of halves) {
    void useOps.getState().start({
      kind,
      sources: list,
      dest,
      copyOrMoveOnly: hooks.copyOrMoveOnly,
      onEnd: ended,
    });
  }
}
