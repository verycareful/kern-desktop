// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { parent } from "../ipc";
import { activeTab, useTabs, type Tab, type TabsState } from "../store/tabs";
import { usePanelsStore } from "../store/panels";

// The single table of user-visible actions. Shortcuts (useShortcuts), the
// main menu and the tab context menu (ActionMenu) all read it, so keyboard and
// right-click cannot drift apart: the main menu lists every action that
// applies to the active tab, and the tab buttons and stubs run actions from
// here. Design 4.5 lists the shortcuts; an action is added here by the task
// that implements it.
//
// Key strings: [Ctrl+][Alt+][Shift+][Meta+]Key, modifiers in that order, Key
// being KeyboardEvent.key with a single character upper-cased ("Ctrl+W",
// "Ctrl+Shift+Tab", "Alt+ArrowLeft", "Ctrl+=", "Ctrl+-"). Two spellings
// differ so the string splits on "+": the plus key is "Plus" and the space
// bar is "Space". eventToKey builds the string from an event. On a layout
// whose letter is not ASCII (Cyrillic, Greek), candidateKeys adds the string
// for the physical key (KeyboardEvent.code KeyW / Digit1), so Ctrl+W still
// works there.

export type ActionContextKind = "folder" | "doc";

export type ActionContext = {
  tabs: TabsState;
  active: Tab | null;
  /** The tab the action is aimed at: the one a menu or button was opened on, else the active tab. */
  target: Tab | null;
  togglePanel(side: "left" | "right"): void;
};

export type Action = {
  id: string;
  /** The menu label. */
  label: string;
  /** The menu group heading. */
  area: "Tabs" | "Navigation" | "Panels";
  keys: string[];
  /** The tab kind the action applies to. */
  when: ActionContextKind | "any";
  /** True when the shortcut also fires while focus is in an editable field. */
  inEditable?: boolean;
  /** Absent means always enabled where `when` holds. A disabled menu entry is shown greyed. */
  enabled?(ctx: ActionContext): boolean;
  run(ctx: ActionContext): void;
};

export function currentContext(targetId?: string): ActionContext {
  const tabs = useTabs.getState();
  const panels = usePanelsStore.getState();
  const active = activeTab(tabs);
  return {
    tabs,
    active,
    target: tabs.tabs.find((t) => t.id === targetId) ?? active,
    togglePanel: (side) => (side === "left" ? panels.toggleLeft() : panels.toggleRight()),
  };
}

export const actions: Action[] = [
  // Ctrl+W and Ctrl+Tab: design 4.5. Both also work inside an editor, where
  // focus sits in an editable field. Shift+Tab reversal is the usual partner of Ctrl+Tab.
  // Every way to close a tab (shortcut, x button, middle click, menus) runs this one action.
  {
    id: "tab.close",
    label: "Close tab",
    area: "Tabs",
    keys: ["Ctrl+W"],
    when: "any",
    inEditable: true,
    enabled: (c) => c.target !== null,
    run: (c) => c.target && c.tabs.close(c.target.id),
  },
  {
    id: "tab.next",
    label: "Next tab",
    area: "Tabs",
    keys: ["Ctrl+Tab"],
    when: "any",
    inEditable: true,
    enabled: (c) => c.tabs.tabs.length > 1,
    run: (c) => c.tabs.next(),
  },
  {
    id: "tab.prev",
    label: "Previous tab",
    area: "Tabs",
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
    area: "Navigation",
    keys: ["Alt+ArrowLeft"],
    when: "folder",
    enabled: (c) => c.active?.kind === "folder" && c.active.cursor > 0,
    run: (c) => c.tabs.back(),
  },
  {
    id: "nav.forward",
    label: "Forward",
    area: "Navigation",
    keys: ["Alt+ArrowRight"],
    when: "folder",
    enabled: (c) => c.active?.kind === "folder" && c.active.cursor < c.active.history.length - 1,
    run: (c) => c.tabs.forward(),
  },
  {
    id: "nav.up",
    label: "Up one folder",
    area: "Navigation",
    keys: ["Alt+ArrowUp"],
    when: "folder",
    enabled: (c) => c.active?.kind === "folder" && parent(c.active.path) !== null,
    run: (c) => c.tabs.up(),
  },
  // Design 4.3: a document tab folds both panels to stubs. No shortcut in 4.5,
  // so these are reachable from the menus and the stubs.
  {
    id: "panel.left.toggle",
    label: "Show or hide the file manager panel",
    area: "Panels",
    keys: [],
    when: "doc",
    run: (c) => c.togglePanel("left"),
  },
  {
    id: "panel.right.toggle",
    label: "Show or hide Pinned and Recent",
    area: "Panels",
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
  return appliesTo(a, ctx.target) && (a.enabled ? a.enabled(ctx) : true);
}

/** Runs the action if it applies and is enabled. Returns whether it ran. */
export function runAction(a: Action, ctx: ActionContext): boolean {
  if (!isEnabled(a, ctx)) return false;
  a.run(ctx);
  return true;
}

/** The actions that apply to a tab, grouped by area in table order. */
export function menuSections(tab: Tab | null): { title: string; actions: Action[] }[] {
  const sections: { title: string; actions: Action[] }[] = [];
  for (const a of actions.filter((x) => appliesTo(x, tab))) {
    const s = sections.find((x) => x.title === a.area);
    if (s) s.actions.push(a);
    else sections.push({ title: a.area, actions: [a] });
  }
  return sections;
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

type KeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

function format(e: KeyEvent, key: string): string {
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta", key]
    .filter(Boolean)
    .join("+");
}

/** The key string for a keyboard event, in the table's format. */
export function eventToKey(e: KeyEvent): string {
  const key =
    e.key === "+"
      ? "Plus"
      : e.key === " "
        ? "Space"
        : e.key.length === 1
          ? e.key.toUpperCase()
          : e.key;
  return format(e, key);
}

/**
 * The key strings an event can match: what was typed, then, when the typed
 * character is not ASCII, the physical letter or digit. A Latin layout that
 * moved a letter (Dvorak) keeps only what it typed.
 */
export function candidateKeys(e: KeyEvent & Pick<KeyboardEvent, "code">): string[] {
  const typed = eventToKey(e);
  const nonAscii = [...e.key].length === 1 && e.key.charCodeAt(0) > 0x7f;
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(e.code);
  if (!nonAscii || !m) return [typed];
  return [typed, format(e, (m[1] ?? m[2])!)];
}
