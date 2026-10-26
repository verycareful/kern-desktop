// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { actions, appliesTo, currentContext, candidateKeys, runAction, isEnabled } from "./actions";

/** True when keystrokes in `el` are text input: input, textarea, select or contenteditable. */
export function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  if (el.closest("input, textarea, select")) return true;
  const ce = el.closest("[contenteditable]");
  return ce !== null && ce.getAttribute("contenteditable") !== "false";
}

// Keys that a focused control uses itself: Enter and Space press a button,
// arrows move inside a menu or a tab list. Without Ctrl, Alt or Meta they are
// left to such a control instead of being claimed as shortcuts.
const CONTROL_KEYS = new Set([
  "Enter",
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);
const CONTROLS = "button, a[href], summary, [role=menuitem], [role=tab], [role=button]";

function ownedByControl(e: KeyboardEvent): boolean {
  return (
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    CONTROL_KEYS.has(e.key) &&
    e.target instanceof Element &&
    e.target.closest(CONTROLS) !== null
  );
}

/**
 * One window-level keydown listener that looks the key up in the action
 * table. A matched key is claimed (default prevented) even when the action is
 * disabled, so the webview does not also act on it.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || ownedByControl(e)) return;
      const keys = candidateKeys(e);
      const ctx = currentContext(undefined, e.shiftKey);
      const editable = isEditable(e.target);
      const hit = actions.find(
        (a) =>
          a.keys.some((k) => keys.includes(k)) &&
          appliesTo(a, ctx.active) &&
          (!editable || a.inEditable)
      );
      if (!hit) return;
      e.preventDefault();
      if (isEnabled(hit, ctx)) runAction(hit, ctx);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
