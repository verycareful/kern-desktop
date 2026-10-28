// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { parent } from "../ipc";
import { activeTab, useTabs, type Tab, type TabsState } from "../store/tabs";
import { usePanelsStore } from "../store/panels";
import { folderController, type MoveTo } from "../files/folder-controller";
import { useFolderUi } from "../files/folder-ui";
import type { SortBy } from "../files/sort";
import {
  setInterfaceSize,
  setViewMode,
  stepSize,
  toggleHidden,
  useViewSettings,
} from "../files/view-settings";
import { DEFAULT_INTERFACE_SIZE, stepInterfaceSize } from "../theme/interface-size";
import { trashController, type TrashMove } from "../files/trash-controller";
import { useVolumes } from "../shell/volumes-store";

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

// "volume" actions are aimed at a volume of the places strip, not at a tab: they run from the
// volume's own menu and are not part of the main menu.
export type ActionContextKind = "folder" | "doc" | "trash" | "volume";

export type ActionContext = {
  tabs: TabsState;
  active: Tab | null;
  /** The tab the action is aimed at: the one a menu or button was opened on, else the active tab. */
  target: Tab | null;
  togglePanel(side: "left" | "right"): void;
  /** True when the shortcut had Shift held: movement actions extend the selection. */
  extend: boolean;
};

export type Action = {
  id: string;
  /** The menu label. */
  label: string;
  /** The menu group heading. */
  area: "Tabs" | "Navigation" | "Panels" | "Open" | "Selection" | "View" | "Trash" | "Volumes";
  keys: string[];
  /** The tab kind the action applies to. */
  when: ActionContextKind | "any";
  /** True when the shortcut also fires while focus is in an editable field. */
  inEditable?: boolean;
  /** Absent means always enabled where `when` holds. A disabled menu entry is shown greyed. */
  enabled?(ctx: ActionContext): boolean;
  run(ctx: ActionContext): void;
};

export function currentContext(targetId?: string, extend = false): ActionContext {
  const tabs = useTabs.getState();
  const panels = usePanelsStore.getState();
  const active = activeTab(tabs);
  return {
    tabs,
    active,
    target: tabs.tabs.find((t) => t.id === targetId) ?? active,
    extend,
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

// ---- the folder view (design 4.1, 4.3, 5.1) ----

function controllerOf(c: ActionContext) {
  return c.target?.kind === "folder" ? folderController(c.target.id) : undefined;
}

function move(id: string, label: string, keys: string[], to: MoveTo): Action {
  return {
    id,
    label,
    area: "Selection",
    keys,
    when: "folder",
    enabled: (c) => controllerOf(c)?.canMove(to) ?? false,
    run: (c) => controllerOf(c)?.move(to, c.extend),
  };
}

function sortBy(by: SortBy, label: string): Action {
  return {
    id: `folder.sort.${by}`,
    label,
    area: "View",
    keys: [],
    when: "folder",
    run: (c) => c.target && useFolderUi.getState().chooseSort(c.target.id, by),
  };
}

const folderActions: Action[] = [
  // Enter and Ctrl+double-click: design 4.3. Ctrl+Enter is the keyboard form of
  // the new-window gesture.
  {
    id: "folder.open",
    label: "Open",
    area: "Open",
    keys: ["Enter"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.hasSelection() ?? false,
    run: (c) => controllerOf(c)?.open(false),
  },
  {
    id: "folder.openNewWindow",
    label: "Open in new window",
    area: "Open",
    keys: ["Ctrl+Enter"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.hasSelection() ?? false,
    run: (c) => controllerOf(c)?.open(true),
  },
  {
    id: "folder.select.all",
    label: "Select all",
    area: "Selection",
    keys: ["Ctrl+A"],
    when: "folder",
    enabled: (c) => controllerOf(c) !== undefined,
    run: (c) => controllerOf(c)?.selectAll(),
  },
  {
    id: "folder.select.none",
    label: "Select none",
    area: "Selection",
    keys: ["Ctrl+Shift+A"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.hasSelection() ?? false,
    run: (c) => controllerOf(c)?.selectNone(),
  },
  // Each movement key also has its Shift form, which extends the selection.
  move("folder.move.down", "Select next row", ["ArrowDown", "Shift+ArrowDown"], "down"),
  move("folder.move.up", "Select previous row", ["ArrowUp", "Shift+ArrowUp"], "up"),
  move("folder.move.right", "Select next item (grid)", ["ArrowRight", "Shift+ArrowRight"], "right"),
  move("folder.move.left", "Select previous item (grid)", ["ArrowLeft", "Shift+ArrowLeft"], "left"),
  move("folder.move.first", "Select first item", ["Home", "Shift+Home"], "first"),
  move("folder.move.last", "Select last item", ["End", "Shift+End"], "last"),
  {
    id: "folder.location",
    label: "Edit location",
    area: "Navigation",
    keys: ["Ctrl+L"],
    when: "folder",
    inEditable: true,
    enabled: (c) => controllerOf(c) !== undefined,
    run: (c) => controllerOf(c)?.editLocation(),
  },
  {
    id: "folder.refresh",
    label: "Refresh",
    area: "View",
    keys: ["F5"],
    when: "folder",
    enabled: (c) => controllerOf(c) !== undefined,
    run: (c) => controllerOf(c)?.refresh(),
  },
  {
    id: "folder.hidden.toggle",
    label: "Show or hide hidden files",
    area: "View",
    keys: ["Ctrl+H"],
    when: "folder",
    run: () => void toggleHidden(),
  },
  // Ctrl+1 and Ctrl+2 are Dolphin's keys for its view modes.
  {
    id: "folder.view.list",
    label: "List view",
    area: "View",
    keys: ["Ctrl+1"],
    when: "folder",
    enabled: () => useViewSettings.getState().viewMode !== "list",
    run: () => void setViewMode("list"),
  },
  {
    id: "folder.view.grid",
    label: "Grid view",
    area: "View",
    keys: ["Ctrl+2"],
    when: "folder",
    enabled: () => useViewSettings.getState().viewMode !== "grid",
    run: () => void setViewMode("grid"),
  },
  sortBy("name", "Sort by name"),
  sortBy("size", "Sort by size"),
  sortBy("modified", "Sort by date modified"),
  sortBy("type", "Sort by type"),
];

actions.push(...folderActions);

// ---- the interface size (design 7.2) ----
// No keys: Ctrl+= and Ctrl+- are the editor's text zoom (design 4.5). Every
// window is zoomed alike, so these apply whatever tab is shown.

const size = () => useViewSettings.getState().interfaceSize;
const sizeActions: Action[] = [
  {
    id: "view.size.larger",
    label: "Larger interface",
    area: "View",
    keys: [],
    when: "any",
    enabled: () => stepInterfaceSize(size(), 1) !== size(),
    run: () => void stepSize(1),
  },
  {
    id: "view.size.smaller",
    label: "Smaller interface",
    area: "View",
    keys: [],
    when: "any",
    enabled: () => stepInterfaceSize(size(), -1) !== size(),
    run: () => void stepSize(-1),
  },
  {
    id: "view.size.reset",
    label: "Reset interface size",
    area: "View",
    keys: [],
    when: "any",
    enabled: () => size() !== DEFAULT_INTERFACE_SIZE,
    run: () => void setInterfaceSize(DEFAULT_INTERFACE_SIZE),
  },
];
actions.push(...sizeActions);

// ---- the Trash (design 5.2) ----

function trashOf(c: ActionContext) {
  return c.target?.kind === "trash" ? trashController(c.target.id) : undefined;
}

function moveTrash(id: string, label: string, keys: string[], to: TrashMove): Action {
  return {
    id,
    label,
    area: "Selection",
    keys,
    when: "trash",
    enabled: (c) => trashOf(c)?.canMove() ?? false,
    run: (c) => trashOf(c)?.move(to, c.extend),
  };
}

const trashActions: Action[] = [
  // Restore is the Trash's "open"; Delete and Ctrl+Shift+Delete are the usual keys of the
  // desktop file managers for deleting for good and emptying the Trash.
  {
    id: "trash.restore",
    label: "Restore",
    area: "Trash",
    keys: ["Ctrl+R"],
    when: "trash",
    enabled: (c) => trashOf(c)?.canAct(true) ?? false,
    run: (c) => trashOf(c)?.restore(),
  },
  {
    id: "trash.purge",
    label: "Delete permanently",
    area: "Trash",
    keys: ["Delete", "Shift+Delete"],
    when: "trash",
    enabled: (c) => trashOf(c)?.canAct(true) ?? false,
    run: (c) => trashOf(c)?.askPurge(),
  },
  {
    id: "trash.empty",
    label: "Empty Trash",
    area: "Trash",
    keys: ["Ctrl+Shift+Delete"],
    when: "trash",
    enabled: (c) => trashOf(c)?.canAct(false) ?? false,
    run: (c) => trashOf(c)?.askEmpty(),
  },
  {
    id: "trash.select.all",
    label: "Select all",
    area: "Selection",
    keys: ["Ctrl+A"],
    when: "trash",
    enabled: (c) => trashOf(c) !== undefined,
    run: (c) => trashOf(c)?.selectAll(),
  },
  {
    id: "trash.select.none",
    label: "Select none",
    area: "Selection",
    keys: ["Ctrl+Shift+A"],
    when: "trash",
    enabled: (c) => trashOf(c)?.hasSelection() ?? false,
    run: (c) => trashOf(c)?.selectNone(),
  },
  moveTrash("trash.move.down", "Select next item", ["ArrowDown", "Shift+ArrowDown"], "down"),
  moveTrash("trash.move.up", "Select previous item", ["ArrowUp", "Shift+ArrowUp"], "up"),
  moveTrash("trash.move.first", "Select first item", ["Home", "Shift+Home"], "first"),
  moveTrash("trash.move.last", "Select last item", ["End", "Shift+End"], "last"),
  {
    id: "trash.refresh",
    label: "Refresh",
    area: "View",
    keys: ["F5"],
    when: "trash",
    enabled: (c) => trashOf(c) !== undefined,
    run: (c) => trashOf(c)?.refresh(),
  },
];

// ---- the places strip: Trash and volumes (design 4.1, 5.2, 5.3) ----

// The volume actions are aimed at the volume whose menu is open or that has the focus
// (useVolumes.current), and are in that volume's own menu only; with none they are greyed.
function volumeIs(kind: "mounted" | "unmounted", remove?: boolean): boolean {
  const s = useVolumes.getState();
  const v = s.currentVolume();
  if (!v || v.kind !== kind || s.busy[v.key]) return false;
  return !remove || (v.kind === "mounted" && v.mount.removable);
}

function runOnVolume(action: "mount" | "unmount" | "eject") {
  const v = useVolumes.getState().currentVolume();
  if (v) void useVolumes.getState().run(v, action);
}

const placeActions: Action[] = [
  {
    id: "place.trash",
    label: "Open Trash",
    area: "Navigation",
    keys: [],
    when: "any",
    run: (c) => c.tabs.openTrash(),
  },
  {
    id: "volume.mount",
    label: "Mount",
    area: "Volumes",
    keys: [],
    when: "volume",
    enabled: () => volumeIs("unmounted"),
    run: () => runOnVolume("mount"),
  },
  {
    id: "volume.unmount",
    label: "Unmount",
    area: "Volumes",
    keys: [],
    when: "volume",
    enabled: () => volumeIs("mounted"),
    run: () => runOnVolume("unmount"),
  },
  // Eject unmounts every volume of the drive, then ejects the drive when UDisks says it
  // is Ejectable and powers it off otherwise (kernkraft-volumes), so there is no
  // separate power-off action.
  {
    id: "volume.eject",
    label: "Eject",
    area: "Volumes",
    keys: [],
    when: "volume",
    enabled: () => volumeIs("mounted", true),
    run: () => runOnVolume("eject"),
  },
  {
    id: "volumes.refresh",
    label: "Refresh volumes",
    area: "Volumes",
    keys: [],
    when: "any",
    run: () => void useVolumes.getState().refresh(),
  },
];

actions.push(...trashActions, ...placeActions);

export function getAction(id: string): Action {
  const a = actions.find((x) => x.id === id);
  if (!a) throw new Error(`unknown action ${id}`);
  return a;
}

export function appliesTo(a: Action, tab: Tab | null): boolean {
  return a.when === "any" || a.when === "volume" || a.when === tab?.kind;
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
  for (const a of actions.filter((x) => x.when !== "volume" && appliesTo(x, tab))) {
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
