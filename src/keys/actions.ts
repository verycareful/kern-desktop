// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  clipText,
  displayPath,
  isEditorWindow,
  isMainWindow,
  parent,
  pathKey,
  pinsGet,
  showInFolder,
  toWireError,
  type WirePath,
} from "../ipc";
import { copyProblem } from "../files/use-folder-tools";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
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
import { usePinnedRecent } from "../shell/pinned-recent-store";
import { useProperties } from "../files/properties-store";
import { useSettingsNav } from "../settings/settings-nav";
import { documentsController } from "../files/documents-controller";
import { useOps } from "../ops/useOps";
import { docController } from "../editor/doc-controller";
import { moveTabToWindow } from "../shell/move-doc";
import { closeTab } from "../shell/useCloseGuard";
import { openAsEditor, switchLayout } from "../shell/layout-switch";
import { isEditorLayout, useLayout } from "../store/layout";
import { useTreeMenu } from "../files/tree-menu-store";
import { isFolder } from "../files/file-type";

// The single table of user-visible actions. Shortcuts (useShortcuts), the
// main menu and the tab context menu (ActionMenu) all read it, so keyboard and
// right-click cannot drift apart: the main menu lists every action that
// applies to the active tab, and the tab buttons and stubs run actions from
// here. An action is added here together with the feature it runs.
//
// Key strings: [Ctrl+][Alt+][Shift+][Meta+]Key, modifiers in that order, Key
// being KeyboardEvent.key with a single character upper-cased ("Ctrl+W",
// "Ctrl+Shift+Tab", "Alt+ArrowLeft", "Ctrl+=", "Ctrl+-"). Two spellings
// differ so the string splits on "+": the plus key is "Plus" and the space
// bar is "Space". eventToKey builds the string from an event. On a layout
// whose letter is not ASCII (Cyrillic, Greek), candidateKeys adds the string
// for the physical key (KeyboardEvent.code KeyW / Digit1), so Ctrl+W still
// works there.

// "volume" actions are aimed at a volume of the places strip, "entry" actions at an entry of
// Pinned or Recent and "tree" actions at an entry of the folder tree, not at a tab: they run from
// that item's own menu and are not part of the main menu.
export type ActionContextKind =
  "folder" | "doc" | "trash" | "documents" | "volume" | "entry" | "tree";

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
  /** The label a menu shows when it differs from `label` (Undo names what it would undo). */
  menuLabel?(): string;
  /** The menu group heading. */
  area:
    | "Tabs"
    | "File"
    | "Navigation"
    | "Panels"
    | "Open"
    | "Edit"
    | "Create"
    | "Selection"
    | "View"
    | "Trash"
    | "Volumes"
    | "Pinned"
    | "Layout";
  keys: string[];
  /** The tab kind the action applies to. */
  when: ActionContextKind | "any";
  /** True when the shortcut also fires while focus is in an editable field. */
  inEditable?: boolean;
  /** "view": the shortcut acts only while the keyboard is in the folder view or the tab row (keys/file-keys.ts). Menus are not limited. */
  scope?: "view";
  /** Absent means always enabled where `when` holds. A disabled menu entry is shown greyed. */
  enabled?(ctx: ActionContext): boolean;
  /**
   * Why the action does nothing now, for a key pressed while it is disabled: said in the status
   * bar, so a key that is claimed is not a key that fails silently. Null says nothing (the
   * action has nothing to do, as Save has on a clean document).
   */
  refusal?(ctx: ActionContext): string | null;
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
    // In the editor layout the left button is the docked column's.
    togglePanel: (side) =>
      side === "left"
        ? isEditorLayout()
          ? useLayout.getState().toggleLeft()
          : panels.toggleLeft()
        : panels.toggleRight(),
  };
}

export const actions: Action[] = [
  // Ctrl+W and Ctrl+Tab are the tab keys of browsers and editors. Both also work inside an editor, where
  // focus sits in an editable field. Shift+Tab reversal is the usual partner of Ctrl+Tab.
  // Every way to close a tab (shortcut, x button, middle click, menus) runs this one action.
  // A document that would lose something (unsaved changes, a file deleted on disk) asks first
  // (shell/useCloseGuard.ts).
  {
    id: "tab.close",
    label: "Close tab",
    area: "Tabs",
    keys: ["Ctrl+W"],
    when: "any",
    inEditable: true,
    enabled: (c) => c.target !== null,
    run: (c) => {
      if (c.target) closeTab(c.target.id);
    },
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
  // A document tab can have a window of its own; its unsaved text goes with it.
  {
    id: "tab.detach",
    label: "Move to new window",
    area: "Tabs",
    keys: [],
    // Only a document tab can move, so the entry is not in the menu of any other tab.
    when: "doc",
    enabled: (c) =>
      c.target?.kind === "doc" &&
      (isMainWindow() || isEditorWindow()) &&
      !docController(c.target.id)?.busy(),
    run: (c) => {
      if (c.target?.kind === "doc") void moveTabToWindow(c.target.id);
    },
  },
  // Alt+Left, Alt+Right, Alt+Up are the back, forward and up keys of the
  // desktop file managers (Dolphin, Nautilus).
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
  // A document tab folds both panels to stubs. No shortcut is bound,
  // so these are reachable from the menus and the stubs.
  {
    id: "panel.left.toggle",
    label: "Show or hide the file manager panel",
    area: "Panels",
    keys: [],
    when: "doc",
    run: (c) => c.togglePanel("left"),
  },
  // Pinned and Recent are folded to the right stub for a document tab, and in the editor layout
  // for every tab.
  {
    id: "panel.right.toggle",
    label: "Show or hide Pinned and Recent",
    area: "Panels",
    keys: [],
    when: "any",
    enabled: (c) => c.target?.kind === "doc" || isEditorLayout(),
    run: (c) => c.togglePanel("right"),
  },
];

// ---- the folder view ----

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
  // Enter and Ctrl+double-click open. Ctrl+Enter is the keyboard form of
  // the new-window gesture.
  {
    id: "folder.open",
    label: "Open",
    area: "Open",
    keys: ["Enter"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canOpen() ?? false,
    run: (c) => controllerOf(c)?.open(false),
  },
  // F4 is Dolphin's key for the terminal.
  {
    id: "folder.terminal",
    scope: "view",
    label: "Open terminal here",
    area: "Open",
    keys: ["F4"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canOpenTerminal() ?? false,
    run: (c) => controllerOf(c)?.openTerminalHere(),
  },
  {
    id: "folder.openWith",
    scope: "view",
    label: "Open with…",
    area: "Open",
    keys: [],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canOpenWith() ?? false,
    run: (c) => controllerOf(c)?.openWith(),
  },
  // Alt+Enter: Properties in Dolphin and Nautilus. With nothing selected, the folder's own.
  {
    id: "folder.properties",
    scope: "view",
    label: "Properties",
    area: "Open",
    keys: ["Alt+Enter"],
    when: "folder",
    enabled: (c) => controllerOf(c) !== undefined,
    run: (c) => {
      const picked = controllerOf(c)?.selectedPaths() ?? [];
      if (c.target?.kind !== "folder") return;
      useProperties.getState().show(picked.length > 0 ? picked : [c.target.path]);
    },
  },
  {
    id: "folder.copyPath",
    scope: "view",
    label: "Copy path",
    area: "Edit",
    keys: ["Ctrl+Shift+C"],
    when: "folder",
    enabled: (c) => controllerOf(c) !== undefined,
    run: (c) => controllerOf(c)?.copyPath(),
  },
  // A folder as the root of a new editor window (the editor layout's tree and tabs).
  {
    id: "folder.openAsEditor",
    label: "Open as editor",
    area: "Open",
    keys: [],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canOpenAsEditor() ?? false,
    run: (c) => controllerOf(c)?.openAsEditor(),
  },
  {
    id: "folder.openNewWindow",
    label: "Open in new window",
    area: "Open",
    keys: ["Ctrl+Enter"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canOpen() ?? false,
    run: (c) => controllerOf(c)?.open(true),
  },
  // ---- file operations ----
  // They act on the selection, never on an item that is only outlined. Ctrl+C, X and V
  // are left to a text field that has the focus (no `inEditable`), as are Ctrl+Z and Y.
  // Undo and redo are the file operations' own in a folder tab; the editor's come with the editor.
  {
    id: "folder.undo",
    label: "Undo",
    menuLabel: () => useOps.getState().undoLabel ?? "Undo",
    area: "Edit",
    keys: ["Ctrl+Z"],
    when: "folder",
    enabled: () => useOps.getState().undoLabel !== null,
    run: () => void useOps.getState().runUndo("undo"),
  },
  {
    id: "folder.redo",
    label: "Redo",
    menuLabel: () => useOps.getState().redoLabel ?? "Redo",
    area: "Edit",
    keys: ["Ctrl+Y", "Ctrl+Shift+Z"],
    when: "folder",
    enabled: () => useOps.getState().redoLabel !== null,
    run: () => void useOps.getState().runUndo("redo"),
  },
  {
    id: "folder.cut",
    scope: "view",
    label: "Cut",
    area: "Edit",
    keys: ["Ctrl+X"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.hasSelection() ?? false,
    run: (c) => controllerOf(c)?.cut(),
  },
  {
    id: "folder.copy",
    scope: "view",
    label: "Copy",
    area: "Edit",
    keys: ["Ctrl+C"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.hasSelection() ?? false,
    run: (c) => controllerOf(c)?.copy(),
  },
  {
    id: "folder.paste",
    scope: "view",
    label: "Paste",
    area: "Edit",
    keys: ["Ctrl+V"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canCreate() ?? false,
    run: (c) => controllerOf(c)?.paste(),
  },
  {
    id: "folder.rename",
    scope: "view",
    label: "Rename",
    area: "Edit",
    keys: ["F2"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canRename() ?? false,
    run: (c) => controllerOf(c)?.rename(),
  },
  // Delete moves to the Trash (undoable); Shift+Delete deletes for good, after a question.
  {
    id: "folder.trash",
    scope: "view",
    label: "Move to Trash",
    area: "Edit",
    keys: ["Delete"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.hasSelection() ?? false,
    run: (c) => controllerOf(c)?.trash(),
  },
  {
    id: "folder.delete",
    scope: "view",
    label: "Delete permanently",
    area: "Edit",
    keys: ["Shift+Delete"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.hasSelection() ?? false,
    run: (c) => controllerOf(c)?.askDelete(),
  },
  {
    id: "folder.new.folder",
    scope: "view",
    label: "New folder",
    area: "Create",
    keys: ["Ctrl+Shift+N"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canCreate() ?? false,
    run: (c) => controllerOf(c)?.newFolder(),
  },
  {
    id: "folder.new.file",
    scope: "view",
    label: "New file",
    area: "Create",
    keys: [],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canCreate() ?? false,
    run: (c) => controllerOf(c)?.newFile(),
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
  // Ctrl+F searches, as in a file manager or an editor.
  {
    id: "folder.search",
    label: "Search",
    area: "Navigation",
    keys: ["Ctrl+F"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.canSearch() ?? false,
    run: (c) => controllerOf(c)?.search(),
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

// ---- the interface size ----
// No keys: Ctrl+= and Ctrl+- are the editor's text zoom. Every
// window is zoomed alike, so these apply whatever tab is shown. They wait for the
// stored settings: until they are read the size held is the default, not the user's.

const size = () => useViewSettings.getState().interfaceSize;
const settingsLoaded = () => useViewSettings.getState().loaded;
const sizeActions: Action[] = [
  {
    id: "view.size.larger",
    label: "Larger interface",
    area: "View",
    keys: [],
    when: "any",
    enabled: () => settingsLoaded() && stepInterfaceSize(size(), 1) !== size(),
    run: () => void stepSize(1),
  },
  {
    id: "view.size.smaller",
    label: "Smaller interface",
    area: "View",
    keys: [],
    when: "any",
    enabled: () => settingsLoaded() && stepInterfaceSize(size(), -1) !== size(),
    run: () => void stepSize(-1),
  },
  {
    id: "view.size.reset",
    label: "Reset interface size",
    area: "View",
    keys: [],
    when: "any",
    enabled: () => settingsLoaded() && size() !== DEFAULT_INTERFACE_SIZE,
    run: () => void setInterfaceSize(DEFAULT_INTERFACE_SIZE),
  },
];
actions.push(...sizeActions);

// ---- the layout of the window ----
// "Switch to ..." changes the current window, the main window only: an editor window is the
// editor layout by kind. Ctrl+B is not bound by CodeMirror's keymaps on Linux (editor/editor-keys.ts
// KEYS; its test checks), so it works inside the editor too.

const layoutActions: Action[] = [
  {
    id: "layout.editor",
    label: "Switch to editor layout",
    area: "Layout",
    keys: [],
    when: "any",
    enabled: () => isMainWindow() && useLayout.getState().loaded && !isEditorLayout(),
    run: () => void switchLayout("editor"),
  },
  {
    id: "layout.fileManager",
    label: "Switch to file manager layout",
    area: "Layout",
    keys: [],
    when: "any",
    enabled: () => isMainWindow() && useLayout.getState().loaded && isEditorLayout(),
    run: () => void switchLayout("file_manager"),
  },
  {
    id: "layout.left.toggle",
    label: "Show or hide the folder column",
    area: "Layout",
    keys: ["Ctrl+B"],
    when: "any",
    inEditable: true,
    enabled: () => isEditorLayout(),
    run: () => useLayout.getState().toggleLeft(),
  },
  // The right-click menu of the folder tree.
  {
    id: "tree.openAsEditor",
    label: "Open as editor",
    area: "Open",
    keys: [],
    when: "tree",
    enabled: () => {
      const e = useTreeMenu.getState().current;
      return e !== null && isFolder(e);
    },
    run: () => {
      const e = useTreeMenu.getState().current;
      if (e) void openAsEditor(e.path);
    },
  },
];
actions.push(...layoutActions);

// ---- the Trash ----

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

// ---- the places strip: Trash and volumes ----

// The volume actions are aimed at the volume whose menu is open (useVolumes.current), and are
// in that volume's own menu only; with none they are greyed, and so are all of them for a
// volume whose identity is unknown.
function volumeIs(kind: "mounted" | "unmounted", remove?: boolean): boolean {
  const s = useVolumes.getState();
  const v = s.currentVolume();
  if (!v || v.kind !== kind || s.busy[v.key]) return false;
  if ((v.kind === "mounted" ? v.mount.identity : v.device.identity).state === "unknown")
    return false;
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
  // Ctrl+, opens the settings in most desktop editors (GNOME Text Editor, VS Code); no other
  // key is bound to it.
  {
    id: "place.settings",
    label: "Open Settings",
    area: "Navigation",
    keys: ["Ctrl+,"],
    when: "any",
    inEditable: true,
    run: (c) => c.tabs.openSettings(),
  },
  // The logo in the places strip: Settings, at About.
  {
    id: "place.about",
    label: "About Kern",
    area: "Navigation",
    keys: [],
    when: "any",
    run: (c) => {
      useSettingsNav.getState().show("about");
      c.tabs.openSettings();
    },
  },
  {
    id: "place.documents",
    label: "Open Library",
    area: "Navigation",
    keys: [],
    when: "any",
    run: (c) => c.tabs.openDocuments(),
  },
  // F5 refreshes a folder and the Trash; here it walks the folders again.
  {
    id: "documents.refresh",
    label: "Look again",
    area: "View",
    keys: ["F5"],
    when: "documents",
    enabled: () => documentsController() !== null,
    run: () => documentsController()?.refresh(),
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
    // The list is read through a strip that follows the event (listener first); with none
    // mounted there is nothing to refresh.
    enabled: () => useVolumes.getState().followers > 0,
    run: () => void useVolumes.getState().refresh(),
  },
];

// ---- Pinned and Recent ----

function currentEntry() {
  return usePinnedRecent.getState().current;
}

/** Opens the folder an entry is in, with the entry selected; each problem is said in the panel. */
async function showEntryInFolder(path: WirePath): Promise<void> {
  const say = usePinnedRecent.getState().notify;
  try {
    for (const err of await showInFolder([path])) say(`Not shown in its folder: ${errorText(err)}`);
  } catch (e) {
    say(`Not shown in its folder: ${errorText(toWireError(e))}`);
  }
}

/** Puts an entry's path on the clipboard as text. */
function copyEntryPath(path: WirePath): void {
  const say = usePinnedRecent.getState().notify;
  const problem = copyProblem(path);
  if (problem) {
    say(`The path was not copied: ${problem}.`);
    return;
  }
  clipText(displayPath(path)).then(
    () => useOps.getState().notify(`Copied the path of ${baseName(path)}`),
    (e: unknown) => say(`The path could not be copied: ${errorText(toWireError(e))}`)
  );
}

/** The place of the entry a menu was opened on among the pins, or -1. */
function pinIndex(): number {
  const e = currentEntry();
  const pins = usePinnedRecent.getState().pins ?? [];
  return e ? pins.findIndex((p) => pathKey(p) === pathKey(e.path)) : -1;
}

const pinnedActions: Action[] = [
  // Ctrl+D bookmarks, as in a browser.
  {
    id: "folder.pin",
    scope: "view",
    label: "Pin",
    area: "Pinned",
    keys: ["Ctrl+D"],
    when: "folder",
    enabled: (c) => controllerOf(c)?.hasSelection() ?? false,
    run: (c) => {
      const paths = controllerOf(c)?.selectedPaths() ?? [];
      void usePinnedRecent.getState().pinPaths(paths);
    },
  },
  {
    id: "entry.open",
    label: "Open",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => currentEntry() !== null,
    run: () => {
      const e = currentEntry();
      if (e) void usePinnedRecent.getState().open(e.path);
    },
  },
  {
    id: "entry.pin",
    label: "Pin",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => currentEntry() !== null && pinIndex() < 0,
    run: () => {
      const e = currentEntry();
      if (e) void usePinnedRecent.getState().pinPaths([e.path]);
    },
  },
  {
    id: "entry.unpin",
    label: "Unpin",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => pinIndex() >= 0,
    run: () => {
      const e = currentEntry();
      if (e) void usePinnedRecent.getState().unpin(e.path);
    },
  },
  // The folder the entry is in, shown in the main window with the entry selected.
  {
    id: "entry.location",
    label: "Open file location",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => currentEntry() !== null,
    run: () => {
      const e = currentEntry();
      if (e) void showEntryInFolder(e.path);
    },
  },
  {
    id: "entry.openAsEditor",
    label: "Open as editor",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => {
      const e = currentEntry();
      return e !== null && usePinnedRecent.getState().kinds[pathKey(e.path)] === "folder";
    },
    run: () => {
      const e = currentEntry();
      if (e) void openAsEditor(e.path);
    },
  },
  {
    id: "entry.copyPath",
    label: "Copy path",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => currentEntry() !== null,
    run: () => {
      const e = currentEntry();
      if (e) copyEntryPath(e.path);
    },
  },
  {
    id: "entry.properties",
    label: "Properties",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => currentEntry() !== null,
    run: () => {
      const e = currentEntry();
      if (e) useProperties.getState().show([e.path]);
    },
  },
  {
    id: "entry.forget",
    label: "Remove from Recent",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => currentEntry()?.list === "recent",
    run: () => {
      const e = currentEntry();
      if (e) void usePinnedRecent.getState().forget(e.path);
    },
  },
  // Reordering by drag has these as its keyboard and menu form.
  {
    id: "entry.up",
    label: "Move up",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => currentEntry()?.list === "pinned" && pinIndex() > 0,
    run: () => {
      const e = currentEntry();
      if (e) void usePinnedRecent.getState().shift(e.path, -1);
    },
  },
  {
    id: "entry.down",
    label: "Move down",
    area: "Pinned",
    keys: [],
    when: "entry",
    enabled: () => {
      const i = pinIndex();
      const n = usePinnedRecent.getState().pins?.length ?? 0;
      return currentEntry()?.list === "pinned" && i >= 0 && i < n - 1;
    },
    run: () => {
      const e = currentEntry();
      if (e) void usePinnedRecent.getState().shift(e.path, 1);
    },
  },
];

// ---- the document ----

function docOf(c: ActionContext) {
  return c.target?.kind === "doc" ? docController(c.target.id) : undefined;
}

/** True when the document of the target tab is among the pins. */
function docPinned(c: ActionContext): boolean {
  if (c.target?.kind !== "doc") return false;
  const key = pathKey(c.target.path);
  return (usePinnedRecent.getState().pins ?? []).some((p) => pathKey(p) === key);
}

/**
 * Pins the document, or unpins it when it is pinned. The pins are read first when the store
 * has none yet, never guessed. A document tab folds Pinned and Recent away, so the outcome is
 * said in the status bar. The store takes the backend's answer, so the label is right even
 * when its events cannot be followed.
 */
async function toggleDocPin(path: WirePath): Promise<void> {
  const say = (text: string) => useOps.getState().notify(text);
  const name = baseName(path);
  let pins = usePinnedRecent.getState().pins;
  if (pins === null) {
    try {
      pins = (await pinsGet()).entries;
    } catch (e) {
      say(
        `Kern could not read the pins, so ${name} was left as it was: ${errorText(toWireError(e))}`
      );
      return;
    }
  }
  const key = pathKey(path);
  const store = usePinnedRecent.getState();
  if (pins.some((p) => pathKey(p) === key)) {
    if (await store.unpin(path, say)) say(`Unpinned ${name}`);
  } else if (await store.pinPaths([path], say)) say(`Pinned ${name}`);
}

// Ctrl+S and Ctrl+Shift+S also fire while the focus is in the editor, which is an editable
// field. Ctrl+Z, Y, A, F, C, V, X and Delete are the folder actions' and apply to a folder tab
// only, so in a document they are CodeMirror's own.
const docActions: Action[] = [
  {
    id: "doc.save",
    label: "Save",
    area: "File",
    keys: ["Ctrl+S"],
    when: "doc",
    inEditable: true,
    enabled: (c) => docOf(c)?.canSave() ?? false,
    refusal: (c) => docOf(c)?.whySaveRefused() ?? null,
    run: (c) => docOf(c)?.save(),
  },
  {
    id: "doc.saveAs",
    label: "Save As…",
    area: "File",
    keys: ["Ctrl+Shift+S"],
    when: "doc",
    inEditable: true,
    enabled: (c) => docOf(c)?.canSaveAs() ?? false,
    run: (c) => docOf(c)?.askSaveAs(),
  },
  // Ctrl+D pins the document and, on a pinned one, unpins it. CodeMirror's own
  // Ctrl+D (select the next occurrence) is not installed, so the key has one meaning.
  {
    id: "doc.pin",
    label: "Pin",
    menuLabel: () => {
      const c = currentContext();
      return docPinned(c) ? "Unpin" : "Pin";
    },
    area: "Pinned",
    keys: ["Ctrl+D"],
    when: "doc",
    inEditable: true,
    enabled: (c) => c.target?.kind === "doc",
    run: (c) => {
      if (c.target?.kind !== "doc") return;
      void toggleDocPin(c.target.path);
    },
  },
];

actions.push(...docActions, ...trashActions, ...placeActions, ...pinnedActions);

export function getAction(id: string): Action {
  const a = actions.find((x) => x.id === id);
  if (!a) throw new Error(`unknown action ${id}`);
  return a;
}

export function appliesTo(a: Action, tab: Tab | null): boolean {
  return (
    a.when === "any" ||
    a.when === "volume" ||
    a.when === "entry" ||
    a.when === "tree" ||
    a.when === tab?.kind
  );
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
  for (const a of actions.filter(
    (x) => x.when !== "volume" && x.when !== "entry" && x.when !== "tree" && appliesTo(x, tab)
  )) {
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
