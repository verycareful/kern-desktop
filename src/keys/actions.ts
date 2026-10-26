// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { activeTab, parentOf, useTabs, type Tab, type TabsState } from "../store/tabs";
import { usePanelsStore } from "../store/panels";

// The single table of user-visible actions. Shortcuts (useShortcuts) and menus
// (ActionMenu) both read it, so keyboard and right-click cannot drift apart.
// Design 4.5 lists the shortcuts; an action is added here by the task that
// implements it.
//
// Key strings: [Ctrl+][Alt+][Shift+][Meta+]Key, modifiers in that order, Key
// being KeyboardEvent.key with a single character upper-cased ("Ctrl+W",
// "Ctrl+Shift+Tab", "Alt+ArrowLeft"). eventToKey builds the same string from
// an event.

export type ActionContextKind = "folder" | "doc";

export type ActionContext = {
  tabs: TabsState;
  active: Tab | null;
  togglePanel(side: "left" | "right"): void;
};

export type Action = {
  id: string;
  /** The menu label. */
  label: string;
  keys: string[];
  /** The tab kind the action applies to. */
  when: ActionContextKind | "any";
  /** True when the shortcut also fires while focus is in an editable field. */
  inEditable?: boolean;
  /** Absent means always enabled where `when` holds. A disabled menu entry is shown greyed. */
  enabled?(ctx: ActionContext): boolean;
  run(ctx: ActionContext): void;
};

export function currentContext(): ActionContext {
  const tabs = useTabs.getState();
  const panels = usePanelsStore.getState();
  return {
    tabs,
    active: activeTab(tabs),
    togglePanel: (side) => (side === "left" ? panels.toggleLeft() : panels.toggleRight()),
  };
}

export const actions: Action[] = [
  // Ctrl+W and Ctrl+Tab: design 4.5. Both also work inside an editor, where
  // focus sits in an editable field. Shift+Tab reversal is the usual partner of Ctrl+Tab.
  {
    id: "tab.close",
    label: "Close tab",
    keys: ["Ctrl+W"],
    when: "any",
    inEditable: true,
    enabled: (c) => c.active !== null,
    run: (c) => c.active && c.tabs.close(c.active.id),
  },
  {
    id: "tab.next",
    label: "Next tab",
    keys: ["Ctrl+Tab"],
    when: "any",
    inEditable: true,
    enabled: (c) => c.tabs.tabs.length > 1,
    run: (c) => c.tabs.next(),
  },
  {
    id: "tab.prev",
    label: "Previous tab",
    keys: ["Ctrl+Shift+Tab"],
    when: "any",
    inEditable: true,
    enabled: (c) => c.tabs.tabs.length > 1,
    run: (c) => c.tabs.prev(),
  },
  // Alt+Left, Alt+Right, Alt+Up are the back, forward and up keys of the
  // desktop file managers (Dolphin, Nautilus). Design 4.5 does not list them.
  {
    id: "nav.back",
    label: "Back",
    keys: ["Alt+ArrowLeft"],
    when: "folder",
    enabled: (c) => c.active?.kind === "folder" && c.active.cursor > 0,
    run: (c) => c.tabs.back(),
  },
  {
    id: "nav.forward",
    label: "Forward",
    keys: ["Alt+ArrowRight"],
    when: "folder",
    enabled: (c) => c.active?.kind === "folder" && c.active.cursor < c.active.history.length - 1,
    run: (c) => c.tabs.forward(),
  },
  {
    id: "nav.up",
    label: "Up one folder",
    keys: ["Alt+ArrowUp"],
    when: "folder",
    enabled: (c) => c.active?.kind === "folder" && parentOf(c.active.path) !== null,
    run: (c) => c.tabs.up(),
  },
  // Design 4.3: a document tab folds both panels to stubs. No shortcut in 4.5,
  // so these are reachable from the menu and the stubs.
  {
    id: "panel.left.toggle",
    label: "Show or hide the file manager panel",
    keys: [],
    when: "doc",
    run: (c) => c.togglePanel("left"),
  },
  {
    id: "panel.right.toggle",
    label: "Show or hide Pinned and Recent",
    keys: [],
    when: "doc",
    run: (c) => c.togglePanel("right"),
  },
];

export function getAction(id: string): Action {
  const a = actions.find((x) => x.id === id);
  if (!a) throw new Error(`unknown action ${id}`);
  return a;
}

export function appliesTo(a: Action, tab: Tab | null): boolean {
  return a.when === "any" || a.when === tab?.kind;
}

export function isEnabled(a: Action, ctx: ActionContext): boolean {
  return appliesTo(a, ctx.active) && (a.enabled ? a.enabled(ctx) : true);
}

/** Runs the action if it applies and is enabled. Returns whether it ran. */
export function runAction(a: Action, ctx: ActionContext): boolean {
  if (!isEnabled(a, ctx)) return false;
  a.run(ctx);
  return true;
}

/** Two contexts collide when they are equal or either is "any". */
function overlaps(a: Action["when"], b: Action["when"]): boolean {
  return a === b || a === "any" || b === "any";
}

/** Every pair of actions that share a key in overlapping contexts, as "key: idA, idB". */
export function findDuplicateBindings(list: Action[] = actions): string[] {
  const out: string[] = [];
  list.forEach((a, i) => {
    for (const b of list.slice(i + 1)) {
      if (!overlaps(a.when, b.when)) continue;
      for (const k of a.keys) {
        if (b.keys.includes(k)) out.push(`${k}: ${a.id}, ${b.id}`);
      }
    }
  });
  return out;
}

/** The key string for a keyboard event, in the table's format. */
export function eventToKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">
): string {
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta", key]
    .filter(Boolean)
    .join("+");
}
