// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toWireError } from "./invoke";

/** The width of this window's webview in physical pixels (Tauri's webview_size, `core:webview:default`). A failure rejects with a WireError. */
export async function webviewWidth(): Promise<number> {
  try {
    return (await getCurrentWebview().size()).width;
  } catch (e) {
    throw toWireError(e);
  }
}
