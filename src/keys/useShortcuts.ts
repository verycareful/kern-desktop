// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { actions, appliesTo, currentContext, eventToKey, runAction, isEnabled } from "./actions";

/** True when keystrokes in `el` are text input: input, textarea, select or contenteditable. */
export function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  if (el.closest("input, textarea, select")) return true;
  const ce = el.closest("[contenteditable]");
  return ce !== null && ce.getAttribute("contenteditable") !== "false";
}

/**
 * One window-level keydown listener that looks the key up in the action
 * table. A matched key is claimed (default prevented) even when the action is
 * disabled, so the webview does not also act on it.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const key = eventToKey(e);
      const ctx = currentContext();
      const editable = isEditable(e.target);
      const hit = actions.find(
        (a) => a.keys.includes(key) && appliesTo(a, ctx.active) && (!editable || a.inEditable)
      );
      if (!hit) return;
      e.preventDefault();
      if (isEnabled(hit, ctx)) runAction(hit, ctx);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
