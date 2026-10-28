// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { invoke, type WireError, type WireItemError } from "./invoke";
import type { WirePath } from "./wire-path";
import type { Density, Follow, KernAccent, ThemeMode } from "./kernkraft";

// One typed function per command of Kern's own backend (src-tauri/src:
// store_cmds.rs, windows.rs, filemanager1.rs, default_fm.rs, clipboard.rs,
// dnd.rs), and one type per wire type it uses. These commands are not in a
// plugin, so they are invoked by their bare names.

// ---- settings, pins and recents (store.rs, store_cmds.rs) ----

export type ViewMode = "list" | "grid";

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
export const pinsGet = () => invoke<Pins>("pins_get");
export const pin = (path: WirePath) => invoke<Pins>("pin", { path });
export const unpin = (path: WirePath) => invoke<Pins>("unpin", { path });
export const pinsReorder = (paths: WirePath[]) => invoke<Pins>("pins_reorder", { paths });
export const recentsGet = () => invoke<Recents>("recents_get");
export const recentTouch = (path: WirePath) => invoke<Recents>("recent_touch", { path });
export const prune = () => invoke<PruneReport>("prune");
export const storeErrorsTake = () => invoke<CorruptReport[]>("store_errors_take");

// ---- windows and opening (windows.rs, open.rs) ----

export type Origin = "inside" | "outside";
export type Gesture = "default" | "new_window";

export type Location = { kind: "tab"; tab_id: string } | { kind: "window"; label: string };

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
  | { kind: "load_doc"; path: WirePath }
  | { kind: "home_tab" }
  | { kind: "focus_tab"; tab_id: string };

/** An event queued for a window that was not listening yet. */
export interface Queued {
  event: string;
  payload: unknown;
}

export const openPaths = (paths: WirePath[], origin: Origin, gesture: Gesture = "default") =>
  invoke<OpenOutcome[]>("open_paths", { paths, origin, gesture });

export const docOpened = (path: WirePath, location: Location) =>
  invoke<void>("doc_opened", { path, location });

export const docClosed = (path: WirePath, location: Location) =>
  invoke<void>("doc_closed", { path, location });

/** Hands over, once, what was queued for the calling window. */
export const openPendingTake = () => invoke<Queued[]>("open_pending_take");

/** Detaches a document tab into its own window; resolves to the window label. */
export const detachDoc = (tabId: string, path: WirePath) =>
  invoke<string>("detach_doc", { tabId, path });

export const moveDocToMain = (label: string, textState?: unknown) =>
  invoke<void>("move_doc_to_main", { label, textState: textState ?? null });

/** Main acknowledges that it took the document of window `label`. */
export const adopted = (label: string) => invoke<void>("adopted", { label });

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
export const defaultFmStatus = () => invoke<DefaultFm>("default_fm_status");
export const makeDefaultFm = () => invoke<DefaultFm>("make_default_fm");

// ---- clipboard and drag-and-drop (clipboard.rs, dnd.rs) ----

export type ClipOp = "copy" | "cut";

export interface ClipContents {
  op: ClipOp;
  paths: WirePath[];
}

/** A drop from another application, on kern://drop; position is in physical pixels. */
export interface DropPayload {
  paths: WirePath[];
  position: { x: number; y: number };
}

export const clipSet = (op: ClipOp, paths: WirePath[]) => invoke<void>("clip_set", { op, paths });
export const clipText = (text: string) => invoke<void>("clip_text", { text });
export const clipGet = () => invoke<ClipContents | null>("clip_get");
export const dragOut = (paths: WirePath[]) => invoke<void>("drag_out", { paths });
