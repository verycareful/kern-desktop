// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { EVENT_DROP, mimeOf, on, toWireError, type DropPayload, type WirePath } from "../ipc";
import { openFiles } from "../files/open-entries";
import { decideDrop, editorLandingAt, modsOf } from "../ops/dnd";
import { dropItems } from "../ops/drop-items";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";

// What an editor window does with files dropped on it from another program: onto a
// folder of its tree or Places, as the main window does onto a folder row (a move on the same
// filesystem, else a copy, with the same progress, questions and reports); onto its documents,
// every text file opens as a tab of this window. Anything else dropped on the documents (a
// folder, a file the editor cannot open) is named in a report and left alone. Where the pointer
// is over is judged by ops/DropHover.tsx while the drag passes.

/** Opens the text files among `paths` as tabs of this window and reports the rest. */
export async function openDropped(paths: readonly WirePath[]): Promise<void> {
  const text: WirePath[] = [];
  const refused: string[] = [];
  for (const path of paths) {
    try {
      if ((await mimeOf(path)).is_text) text.push(path);
      else refused.push(baseName(path));
    } catch (e) {
      useOps.getState().report({
        title: `Opening ${baseName(path)}`,
        report: null,
        error: toWireError(e),
      });
    }
  }
  if (refused.length > 0) {
    useOps.getState().report({
      title: "Opening dropped files",
      report: null,
      error: {
        kind: "NotText",
        message: `${refused.join(", ")} ${refused.length === 1 ? "is" : "are"} not a text file, which is all an editor window opens`,
        path: null,
        details: null,
      },
    });
  }
  if (text.length === 0) return;
  for (const error of await openFiles(text, false)) {
    useOps.getState().report({ title: "Opening dropped files", report: null, error });
  }
}

/** Carries out a drop from another program on this editor window. */
export function useEditorDrop(): void {
  useEffect(() => {
    let live = true;
    let off: (() => void) | undefined;
    const carryOut = (drop: DropPayload) => {
      if (drop.paths.length === 0) return;
      const landing = editorLandingAt(
        drop.position,
        drop.view,
        { width: window.innerWidth, height: window.innerHeight },
        drop.paths
      );
      // A place that takes nothing is explained by the hover (ops/DropHover.tsx).
      if (!landing.ok) return;
      if (landing.kind === "open") {
        void openDropped(drop.paths);
        return;
      }
      void dropItems(decideDrop(modsOf(drop.modifier), drop.offered), drop.paths, landing.path, {
        failed: (e, about) =>
          useOps.getState().report({
            title: about ? `Dropping ${baseName(about)}` : "Dropping files",
            report: null,
            error: toWireError(e),
          }),
      });
    };
    on(EVENT_DROP, carryOut).then(
      (u) => (live ? (off = u) : u()),
      (e: unknown) =>
        live &&
        useOps.getState().report({ title: "Dropping files", report: null, error: toWireError(e) })
    );
    return () => {
      live = false;
      off?.();
    };
  }, []);
}
