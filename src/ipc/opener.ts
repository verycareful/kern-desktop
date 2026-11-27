// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { openUrl } from "@tauri-apps/plugin-opener";
import { toWireError } from "./invoke";

/**
 * Hands `address` to the application the system picks for its scheme. The capability of a
 * window that shows a PDF allows web, mail and phone addresses only (capabilities/doc.json and
 * editor.json); Kern itself connects to nothing. A failure rejects with a WireError.
 */
export async function openAddress(address: string): Promise<void> {
  try {
    await openUrl(address);
  } catch (e) {
    throw toWireError(e);
  }
}
