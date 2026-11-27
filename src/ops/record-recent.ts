// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { recentTouch, toWireError, type WirePath } from "../ipc";
import { errorText } from "./error-text";
import { baseName } from "./labels";
import { useOps } from "./useOps";

/**
 * Puts a file that was just opened at the top of Recent. Nothing about a failed Recent entry
 * undoes the open, so a failure is said in a notice and never thrown.
 */
export async function recordRecent(path: WirePath): Promise<void> {
  try {
    await recentTouch(path);
  } catch (e) {
    useOps
      .getState()
      .notify(`${baseName(path)} could not be added to Recent: ${errorText(toWireError(e))}`);
  }
}
