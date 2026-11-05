// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { openSettings, toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";

/** Opens the Settings window (at `section` when given); a failure is said in this window. */
export async function showSettings(section?: string): Promise<void> {
  try {
    await openSettings(section);
  } catch (e) {
    useOps.getState().notify(`Settings could not be opened: ${errorText(toWireError(e))}`);
  }
}
