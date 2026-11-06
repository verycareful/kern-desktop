// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { isEditable } from "../keys/useShortcuts";

/**
 * Keeps the web view's own context menu (Back, Forward, Stop, Reload) out of
 * the window. Its Reload restarts the page, which drops every open tab. A
 * right-click Kern has no menu for shows nothing; text fields keep the native
 * menu for Cut, Copy, Paste and spelling. Returns the function that removes
 * the listener.
 */
export function blockNativeMenu(target: EventTarget): () => void {
  const onMenu = (e: Event) => {
    if (!isEditable(e.target)) e.preventDefault();
  };
  target.addEventListener("contextmenu", onMenu);
  return () => target.removeEventListener("contextmenu", onMenu);
}
