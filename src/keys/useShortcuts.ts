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
import { bindsOf, eventToMouseBind, mouseOf, refusedBind, useBindsSync } from "./binds";
import { inScope } from "./file-keys";
import { aimTreeAtPointer } from "../files/tree-hover";

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

/** The id of the tab whose strip entry holds `target`, or null (TabBar marks each tab button). */
function tabUnder(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const tab = target.closest(".kern-tab");
  return tab?.querySelector("[data-tab-id]")?.getAttribute("data-tab-id") ?? null;
}

/**
 * The action a mouse event triggers, with the context to run it in, or null. The rules are the
 * keys': the action must apply and `scope` holds. A field of text keeps its mouse (the middle
 * button pastes there, a drag selects), whatever `inEditable` says of keys. An action with `mouseOn: "tab"` answers only over a tab, and
 * is aimed at that tab. A plain left or right click is never matched.
 */
function mouseHit(
  e: MouseEvent,
  allow: ((a: Action) => boolean) | undefined
): { action: Action; ctx: ReturnType<typeof currentContext> } | null {
  const bind = eventToMouseBind(e);
  if (!bind || refusedBind(bind)) return null;
  if (isEditable(e.target)) return null;
  const tabId = tabUnder(e.target);
  for (const a of actions) {
    if (
      (allow && !allow(a)) ||
      !mouseOf(a).includes(bind) ||
      (a.mouseOn === "tab" && tabId === null) ||
      !inScope(a.scope, e.target)
    ) {
      continue;
    }
    // Actions of different contexts may share a button: the one that applies to this tab runs.
    const ctx = currentContext(a.mouseOn === "tab" ? (tabId ?? undefined) : undefined, e.shiftKey);
    if (appliesTo(a, ctx.target)) return { action: a, ctx };
  }
  return null;
}

/**
 * The window-level listeners that look a key or a mouse button up in the action table (through
 * the user's binds, binds.ts). A matched key is claimed (default prevented) even when the action is
 * disabled, so the webview does not also act on it; so is a matched mouse press, and the context
 * menu of a right click bound with a modifier. A key of an action with `scope: "view"` aimed at
 * another pane is not matched: it is that pane's. `allow` limits the actions a window answers to
 * (a document window has no tabs or folders); it is read once, so it must not change.
 */
export function useShortcuts(allow?: (a: Action) => boolean): void {
  useBindsSync();
  useEffect(() => {
    const run = (hit: Action, ctx: ReturnType<typeof currentContext>) => {
      if (isEnabled(hit, ctx)) runAction(hit, ctx);
      else {
        const why = hit.refusal?.(ctx);
        if (why) useOps.getState().notify(why);
      }
    };
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
          bindsOf(a).some((k) => keys.includes(k)) &&
          appliesTo(a, ctx.active) &&
          (!editable || a.inEditable) &&
          inScope(a.scope, e.target)
      );
      if (!hit) return;
      e.preventDefault();
      run(hit, ctx);
    };
    const onMouseDown = (e: MouseEvent) => {
      const hit = mouseHit(e, allow);
      if (!hit) return;
      // The tree's operations read what the tree is aimed at once it has drawn again, which
      // happens before the button comes up.
      if (hit.action.scope === "tree") aimTreeAtPointer();
      e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      const hit = mouseHit(e, allow);
      if (hit) run(hit.action, hit.ctx);
    };
    const onContextMenu = (e: MouseEvent) => {
      if (!mouseHit(e, allow)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
    // `allow` is read once, as documented.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
