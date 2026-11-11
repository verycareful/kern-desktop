// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { create } from "zustand";
import { bindsGet, EVENT_BINDS_CHANGED, on, toWireError, type Binds, type WireError } from "../ipc";
import { logError } from "../ops/error-log";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";

// A bind is what triggers an action: a key ("Ctrl+W", the format of keys/actions.ts) or a mouse
// button ("MiddleClick", "Ctrl+Click"). Modifiers come first, in the order Ctrl, Alt, Shift,
// Meta. An action's own `keys` are its defaults; the user's binds, kept apart from the settings
// (store.rs Binds, binds.json), replace them action by action. The Settings window writes them
// and every window follows them through the backend's event.

/** The part of a bind that names a mouse button, by the DOM's `MouseEvent.button`. */
const MOUSE_BUTTONS: Record<number, string> = {
  0: "Click",
  1: "MiddleClick",
  2: "RightClick",
  3: "MouseBack",
  4: "MouseForward",
};
const MOUSE_PARTS: ReadonlySet<string> = new Set(Object.values(MOUSE_BUTTONS));

/** The modifiers of an event, in the order a bind writes them. */
type Modifiers = Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/** `key` with the modifiers held in `e` written in front of it. */
export function withModifiers(e: Modifiers, key: string): string {
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta", key]
    .filter(Boolean)
    .join("+");
}

/** Whether `bind` is a mouse button rather than a key. */
export function isMouseBind(bind: string): boolean {
  return MOUSE_PARTS.has(bind.slice(bind.lastIndexOf("+") + 1));
}

/** The bind a mouse event makes, or null for a button that has no name here. */
export function eventToMouseBind(e: Modifiers & Pick<MouseEvent, "button">): string | null {
  const name = MOUSE_BUTTONS[e.button];
  return name ? withModifiers(e, name) : null;
}

/**
 * Why `bind` cannot be bound, or null. A plain left click selects and opens everything and a
 * plain right click opens the context menu, so neither can be taken without a modifier.
 */
export function refusedBind(bind: string): string | null {
  if (bind === "Click") {
    return "A plain left click selects and opens items; hold Ctrl, Alt, Shift or Meta with it";
  }
  if (bind === "RightClick") {
    return "A plain right click opens the context menu; hold Ctrl, Alt, Shift or Meta with it";
  }
  return null;
}

interface BindsState {
  loaded: boolean;
  /** An action id to its binds. An action with no entry is on its defaults. */
  overrides: Record<string, string[]>;
  /** Why the binds could not be read, until the next read succeeds. */
  error: WireError | null;
}

export const useBinds = create<BindsState>()(() => ({ loaded: false, overrides: {}, error: null }));

type Bindable = { id: string; keys: string[] };

/** The binds of an action: the user's, else its defaults. An empty list is an action left unbound. */
export function bindsOf(a: Bindable, overrides = useBinds.getState().overrides): string[] {
  return overrides[a.id] ?? a.keys;
}

/** The keys among the binds of an action. */
export const keysOf = (a: Bindable): string[] => bindsOf(a).filter((b) => !isMouseBind(b));

/** The mouse buttons among the binds of an action. */
export const mouseOf = (a: Bindable): string[] => bindsOf(a).filter(isMouseBind);

/** The bind a menu or tooltip shows: the first key, else the first mouse button. */
export function bindLabel(binds: readonly string[]): string | undefined {
  return binds.find((b) => !isMouseBind(b)) ?? binds[0];
}

/** The label of an action's bind, redrawn when the user changes the binds. */
export function useBindLabel(a: Bindable): string | undefined {
  return useBinds((s) => bindLabel(bindsOf(a, s.overrides)));
}

function apply(b: Binds): void {
  useBinds.setState({ loaded: true, overrides: b.binds, error: null });
}

/** Says that the binds could not be read and that the defaults are in force. */
function reportFailure(e: unknown, what: string): void {
  const error = toWireError(e);
  useBinds.setState({ error });
  const text = `Your key and mouse binds ${what}: ${errorText(error)}. The default binds are in use.`;
  useOps.getState().notify(text);
  logError("binds", text);
}

/** Reads the stored binds. */
export async function loadBinds(): Promise<void> {
  try {
    apply(await bindsGet());
  } catch (e) {
    reportFailure(e, "could not be read");
  }
}

/** Keeps the store in step with the stored binds while a window is open. */
export function useBindsSync(): void {
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void loadBinds();
    on(EVENT_BINDS_CHANGED, apply).then(
      (u) => (alive ? (unlisten = u) : u()),
      (e: unknown) => alive && reportFailure(e, "cannot be followed")
    );
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
}
