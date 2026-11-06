// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { isEditorWindow, recentTouch, toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";

// An editor window's folder goes into Recent, marked as an editor, when the
// window gets its folder and again as it closes, so the folder closed last is
// at the top. A Recent entry so marked opens as an editor window again
// (pinned-recent-store.ts openEntry).

/** Records this editor window's folder in Recent; a failure is said in the window. */
export async function recordEditorFolder(): Promise<void> {
  if (!isEditorWindow()) return;
  const root = useLayout.getState().treeRoot;
  if (!root) return;
  try {
    await recentTouch(root, true);
  } catch (e) {
    useOps
      .getState()
      .notify(`${baseName(root)} could not be added to Recent: ${errorText(toWireError(e))}`);
  }
}
