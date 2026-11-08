// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import {
  actions,
  appliesTo,
  currentContext,
  candidateKeys,
  runAction,
  isEnabled,
  type Action,
} from "./actions";
import { useOps } from "../ops/useOps";
import { inFileKeysArea } from "./file-keys";

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

/** The elements a message is shown in: an alert (an error banner) or a status (the status bar). */
const MESSAGES = '[role="alert"], [role="status"]';

/** The element holding `node`, or `node` itself when it is one. */
const elementOf = (node: Node | null): Element | null =>
  node instanceof Element ? node : (node?.parentElement ?? null);

/**
 * True when the user has selected words inside one message, start and end alike: Ctrl+C then
 * copies those words. A selection that runs out of a message into other content is not only the
 * message's, so the key stays with the file copy.
 */
export function wordsSelectedInMessage(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const start = elementOf(selection.anchorNode)?.closest(MESSAGES);
  const end = elementOf(selection.focusNode)?.closest(MESSAGES);
  return start != null && start === end;
}

/**
 * One window-level keydown listener that looks the key up in the action
 * table. A matched key is claimed (default prevented) even when the action is
 * disabled, so the webview does not also act on it. A key of an action with
 * `scope: "view"` aimed at another pane is not matched: it is that pane's.
 * `allow` limits the actions a window answers to (a document window has no tabs or folders);
 * it is read once, so it must not change.
 */
export function useShortcuts(allow?: (a: Action) => boolean): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || ownedByControl(e)) return;
      const keys = candidateKeys(e);
      // Words selected in a message are copied by the webview, not claimed for the file copy.
      if (keys.includes("Ctrl+C") && wordsSelectedInMessage()) return;
      const ctx = currentContext(undefined, e.shiftKey);
      const editable = isEditable(e.target);
      const hit = actions.find(
        (a) =>
          (!allow || allow(a)) &&
          a.keys.some((k) => keys.includes(k)) &&
          appliesTo(a, ctx.active) &&
          (!editable || a.inEditable) &&
          (a.scope !== "view" || inFileKeysArea(e.target))
      );
      if (!hit) return;
      e.preventDefault();
      if (isEnabled(hit, ctx)) runAction(hit, ctx);
      else {
        const why = hit.refusal?.(ctx);
        if (why) useOps.getState().notify(why);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `allow` is read once, as documented.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
