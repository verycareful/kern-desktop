// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { invoke, type WireError, type WireItemError } from "./invoke";
import type { WirePath } from "./wire-path";
import type { Density, Follow, KernAccent, OpId, ThemeMode } from "./kernkraft";

// One typed function per command of Kern's own backend (src-tauri/src:
// store_cmds.rs, windows.rs, filemanager1.rs, default_fm.rs, clipboard.rs,
// dnd.rs), and one type per wire type it uses. These commands are not in a
// plugin, so they are invoked by their bare names.

// ---- settings, pins and recents (store.rs, store_cmds.rs) ----

export type ViewMode = "list" | "grid";

/** The two layouts of a window (store.rs LayoutKind). */
export type LayoutKind = "file_manager" | "editor";

export interface Settings {
  theme_mode: ThemeMode;
  accent: KernAccent;
  density: Density;
  follow: Follow;
  scan_roots: WirePath[];
  scan_documents: boolean;
  scan_downloads: boolean;
  /** The user's terminal command; null lets kernkraft pick one. */
  terminal: string | null;
  word_wrap: boolean;
  /** Editor zoom factor, 0.25 to 5.0 (store.rs ZOOM_MIN, ZOOM_MAX). */
  editor_zoom: number;
  view_mode: ViewMode;
  show_hidden: boolean;
  /** Interface size in percent: 80, 90, 100, 110 or 125 (store.rs INTERFACE_SIZES). */
  interface_size: number;
  /** The layout of a window that has none remembered yet. */
  default_layout: LayoutKind;
}

/** The keys settings_set takes. A `follow` patch may be partial. */
export type SettingsPatch = Partial<Omit<Settings, "follow">> & { follow?: Partial<Follow> };

export interface Pins {
  entries: WirePath[];
}

export interface RecentEntry {
  path: WirePath;
  /** Milliseconds since the Unix epoch. */
  opened_ms: number;
}

export interface Recents {
  entries: RecentEntry[];
}

export interface CorruptReport {
  /** The file's name, for example pins.json. */
  file: string;
  /** Where the unreadable file now is. */
  moved_to: WirePath | null;
  /** The settings field that did not parse. */
  field: string | null;
  reason: string;
}

export interface PruneReport {
  pins_removed: WirePath[];
  recents_removed: WirePath[];
  errors: WireItemError[];
  corrupt: CorruptReport[];
  pins: Pins;
  recents: Recents;
}

export const settingsGet = () => invoke<Settings>("settings_get");
export const settingsSet = (patch: SettingsPatch) => invoke<Settings>("settings_set", { patch });
/** How the main window is laid out, as stored (store.rs WindowLayout, layout.json). */
export interface WindowLayout {
  /** The layout the user chose; null until they do, when `default_layout` decides. */
  layout: LayoutKind | null;
  /** Width of the editor layout's left column in pixels, 180 to 640 (store.rs LEFT_WIDTH_MIN, LEFT_WIDTH_MAX). */
  left_width: number;
  left_open: boolean;
  /** Width of the Pinned and Recent panel in pixels, 180 to 640 (store.rs RIGHT_WIDTH_MIN, RIGHT_WIDTH_MAX). */
  right_width: number;
  /** The folder the tree is rooted at; null until it is set. */
  tree_root: WirePath | null;
}

/** The keys layout_set takes. */
export type WindowLayoutPatch = Partial<WindowLayout>;

export const layoutGet = () => invoke<WindowLayout>("layout_get");
/** Stores a change to the main window's layout; only the main window may. */
export const layoutSet = (patch: WindowLayoutPatch) =>
  invoke<WindowLayout>("layout_set", { patch });
export const pinsGet = () => invoke<Pins>("pins_get");
export const pin = (path: WirePath) => invoke<Pins>("pin", { path });
export const unpin = (path: WirePath) => invoke<Pins>("unpin", { path });
export const pinsReorder = (paths: WirePath[]) => invoke<Pins>("pins_reorder", { paths });
export const recentsGet = () => invoke<Recents>("recents_get");
export const recentTouch = (path: WirePath) => invoke<Recents>("recent_touch", { path });
export const recentRemove = (path: WirePath) => invoke<Recents>("recent_remove", { path });
export const prune = () => invoke<PruneReport>("prune");
export const storeErrorsTake = () => invoke<CorruptReport[]>("store_errors_take");

// ---- which file a path leads to (identity.rs) ----

/**
 * What a path leads to after links are followed: the device and inode as decimal strings (an inode
 * can exceed what a JSON number holds exactly), or why it could not be looked at.
 */
export type FileIdentity =
  { state: "known"; dev: string; ino: string } | { state: "failed"; error: WireError };

/** The identity of each path, in order; two paths with the same identity are one file or folder. */
export const fileIdentity = (paths: WirePath[]) =>
  invoke<FileIdentity[]>("file_identity", { paths });

// ---- starting a copy or a move for a dropped file (dnd.rs) ----

/**
 * Starts a copy or a move of `sources` into the folder `dest` and returns the operation's id, as
 * `startOp` does for those two kinds. It is the one an editor window is granted: it takes no
 * other kind, so the window cannot delete for good or empty the Trash.
 */
export const dropStartOp = (kind: "copy" | "move", sources: WirePath[], dest: WirePath) =>
  invoke<OpId>("drop_start_op", { kind, sources, dest });

// ---- where a symbolic link points (identity.rs) ----

/**
 * The path a symbolic link leads to: its contents read, through a chain of links when the target
 * is itself one, a relative one taken from the folder of the link that holds it. The path is not
 * looked at further, so it may be one that is not there (a link to nothing). Reads, never writes.
 */
export const linkTarget = (path: WirePath) => invoke<WirePath>("link_target", { path });

// ---- windows and opening (windows.rs, open.rs) ----

export type Origin = "inside" | "outside";
export type Gesture = "default" | "new_window";

/** Where a document is open: a tab of a window (the main window or an editor window), or a window of its own. */
export type Location =
  | { kind: "tab"; window: string; tab_id: string }
  | { kind: "window"; label: string }
  /** A text file routed to a tab of `window` that has not registered yet: held for that window. */
  | { kind: "opening"; window: string };

/** How a path stands against the open documents, for one place that holds a document (windows.rs doc_open_elsewhere). */
export type Held =
  { state: "free" } | { state: "own" } | { state: "elsewhere"; location: Location };

export type OpenAction =
  "folder_tab" | "doc_tab" | "doc_window" | "focus" | "default_app" | "failed";

export interface OpenOutcome {
  path: WirePath;
  action: OpenAction;
  location: Location | null;
  error: WireError | null;
}

/** What a window is told to do, on kern://open. */
export type Directive =
  | { kind: "folder_tab"; path: WirePath }
  | { kind: "doc_tab"; path: WirePath }
  | { kind: "load_doc"; path: WirePath; text_state?: unknown; ack?: boolean }
  | { kind: "editor_root"; path: WirePath }
  | { kind: "home_tab" }
  | { kind: "focus_tab"; tab_id: string };

/** An event queued for a window that was not listening yet. */
export interface Queued {
  event: string;
  payload: unknown;
}

export const openPaths = (paths: WirePath[], origin: Origin, gesture: Gesture = "default") =>
  invoke<OpenOutcome[]>("open_paths", { paths, origin, gesture });

/**
 * Registers `path` as open at `location`, a place of the calling window. `adoptingFrom` names the
 * document window whose move Home this tab is the result of: the backend refuses the registration
 * (AdoptionOver) once it has taken that move back.
 */
export const docOpened = (path: WirePath, location: Location, adoptingFrom?: string) =>
  invoke<void>("doc_opened", { path, location, adoptingFrom: adoptingFrom ?? null });

/**
 * Releases `path` at `location`. With `tabClosed` the tab itself is gone, and everything the
 * backend holds at it goes too, whatever its path (a Save As target whose save was still on its way).
 */
export const docClosed = (path: WirePath, location: Location, tabClosed?: boolean) =>
  invoke<void>("doc_closed", { path, location, tabClosed: tabClosed ?? null });

/**
 * Whether `path`, by any name, is open in a place other than `own`; Save As asks before it writes.
 * With `reserve`, a path found free is held for `own` in the same step; let it go with `docClosed`
 * when nothing is written.
 */
export const docOpenElsewhere = (path: WirePath, own: Location, reserve = false) =>
  invoke<Held>("doc_open_elsewhere", { path, own, reserve });

/** Hands over, once, what was queued for the calling window. */
export const openPendingTake = () => invoke<Queued[]>("open_pending_take");

/**
 * Detaches a document tab into its own window; resolves to the window label once that window
 * holds the document and has registered it. Rejects (DetachRefused, DetachTimeout) when it does
 * not, and the tab keeps the document.
 */
export const detachDoc = (tabId: string, path: WirePath, textState?: unknown) =>
  invoke<string>("detach_doc", { tabId, path, textState: textState ?? null });

export const moveDocToMain = (label: string, textState?: unknown) =>
  invoke<void>("move_doc_to_main", { label, textState: textState ?? null });

/** A document window holds the document a tab was moved to it with, and has registered it. */
export const detached = (label: string) => invoke<void>("detached", { label });

/** A document window will not take the document a tab was moved to it with. */
export const refuseDetach = (label: string, reason: string) =>
  invoke<void>("refuse_detach", { label, reason });

/** Opens an editor window rooted at the folder `root`; resolves to its label. */
export const openEditor = (root: WirePath) => invoke<string>("open_editor", { root });

/** Main acknowledges that it took the document of window `label`. */
export const adopted = (label: string) => invoke<void>("adopted", { label });

/** Main will not take the document of window `label`; the move there ends with `reason`. */
export const refuseAdoption = (label: string, reason: string) =>
  invoke<void>("refuse_adoption", { label, reason });

/** Closes the calling window, after the user's save, discard or cancel choice. */
export const confirmClose = () => invoke<void>("confirm_close");

// ---- file manager integration ----

export interface Fm1Status {
  owned: boolean;
  owner: string | null;
  reason: string | null;
}

export interface DefaultFm {
  is_default: boolean;
  /** The desktop file ID of the current default, if there is one. */
  current: string | null;
}

export const fm1Status = () => invoke<Fm1Status>("fm1_status");
/** Shows each path selected in a folder tab of the main window; resolves to the problems met. */
export const showInFolder = (paths: WirePath[]) => invoke<WireError[]>("show_in_folder", { paths });
export const defaultFmStatus = () => invoke<DefaultFm>("default_fm_status");
export const makeDefaultFm = () => invoke<DefaultFm>("make_default_fm");

// ---- clipboard and drag-and-drop (clipboard.rs, dnd.rs) ----

export type ClipOp = "copy" | "cut";

export interface ClipContents {
  op: ClipOp;
  paths: WirePath[];
}

/** One of GDK's drag actions, by name. */
export type DragAction = "copy" | "move" | "link" | "ask";

/**
 * A drop from another application, on kern://drop (src-tauri/src/dnd.rs). `position` is where the
 * pointer was and `view` the size of the webview, both in the webview's own units, so a point in
 * CSS pixels is `position` times the page's size over `view`, whatever the interface size.
 * `offered` is what the other application allows. `modifier` is `copy` or `move` when the user
 * chose it with a modifier key during the drag (the action the window system selected was not the
 * one Kern showed), else null. `drag` names the drag, as in the events before the drop.
 */
export interface DropPayload {
  paths: WirePath[];
  position: { x: number; y: number };
  view: { width: number; height: number };
  offered: DragAction[];
  modifier: "copy" | "move" | null;
  drag: number;
}

/** kern://drop-refused: Kern declined a drop and says why. */
export interface DropRefused {
  drag: number;
  reason: string;
}

/** kern://drag-over: the pointer of a drag from another application, at most every 50 ms. Same units as a drop. */
export interface DragOver {
  drag: number;
  position: { x: number; y: number };
  view: { width: number; height: number };
}

/** kern://drag-files: the files of the drag have been read. */
export interface DragFiles {
  drag: number;
  paths: WirePath[];
}

/** kern://drag-refusal: why Kern declines the drag now, or null when it does not. */
export interface DragRefusal {
  drag: number;
  refusal: string | null;
}

/** kern://drag-leave: the pointer left the window (a drop may follow). */
export interface DragLeave {
  drag: number;
}

/** What the page tells the backend about where a drag's pointer is: over a folder that takes the files, or why there is none. */
export type DragTarget =
  | { state: "folder"; path: WirePath }
  /** The document area of an editor window: the files are opened, not put in a folder. */
  | { state: "open" }
  | { state: "refused"; reason: string };

export const clipSet = (op: ClipOp, paths: WirePath[]) => invoke<void>("clip_set", { op, paths });
export const clipText = (text: string) => invoke<void>("clip_text", { text });
export const clipGet = () => invoke<ClipContents | null>("clip_get");
/** Clears the clipboard only if it still holds exactly this operation on exactly these paths; resolves to whether it did. */
export const clipClearIf = (op: ClipOp, paths: WirePath[]) =>
  invoke<boolean>("clip_clear_if", { op, paths });
export const dragOut = (paths: WirePath[]) => invoke<void>("drag_out", { paths });
/** Answers kern://drag-over: the backend then shows the pointer what Kern will do at that place. */
export const dndTarget = (drag: number, target: DragTarget) =>
  invoke<void>("dnd_target", { drag, target });
