// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { invoke, type WireError, type WireItemError } from "./invoke";
import type { WirePath } from "./wire-path";

// One typed function per command of the `kernkraft` plugin
// (kernkraft-tauri, src/commands.rs), and one type per wire type it uses
// (src/{fs_cmds,ops,trash_cmds,text_cmds,thumb_cmds,theme_cmds,apps_cmds,
// volumes_cmds,search_cmds,watch}.rs and kernkraft-theme, kernkraft-volumes).
// Field names are the Rust field names (snake_case); argument names are the
// camelCase of the Rust parameters.

const cmd = (name: string) => `plugin:kernkraft-tauri|${name}`;

// ---- files ----

export type EntryKind = "file" | "dir" | "symlink" | "other";

export interface WireEntry {
  path: WirePath;
  name: string;
  kind: EntryKind;
  target_is_dir: boolean;
  len: number;
  /** Milliseconds since the Unix epoch. */
  modified_ms: number | null;
  hidden: boolean;
  mime: string;
}

export interface WireUndoOutcome {
  done: WirePath[];
  warnings: WireItemError[];
}

export interface WireUndoState {
  undo: string | null;
  redo: string | null;
}

export interface WireUserDir {
  /** "desktop", "documents", "download", "music", "pictures" or "videos". */
  name: string;
  path: WirePath;
}

export interface WireUserDirs {
  home: WirePath;
  dirs: WireUserDir[];
}

export const listDir = (path: WirePath, hidden: boolean) =>
  invoke<WireEntry[]>(cmd("list_dir"), { path, hidden });

export const createDir = (parent: WirePath, name: string) =>
  invoke<WirePath>(cmd("create_dir"), { parent, name });

export const createFile = (parent: WirePath, name: string) =>
  invoke<WirePath>(cmd("create_file"), { parent, name });

export const rename = (path: WirePath, newName: string) =>
  invoke<WirePath>(cmd("rename"), { path, newName });

export const undo = () => invoke<WireUndoOutcome>(cmd("undo"));
export const redo = () => invoke<WireUndoOutcome>(cmd("redo"));
export const undoState = () => invoke<WireUndoState>(cmd("undo_state"));
export const userDirs = () => invoke<WireUserDirs>(cmd("user_dirs"));

// ---- background operations ----

/** Identifies a running operation; counted from 1 per app. */
export type OpId = number;

export type OpKind = "copy" | "move" | "trash" | "delete" | "empty_trash";
export type ConflictChoice = "skip" | "replace" | "keep_both";

export interface WireDone {
  source: WirePath;
  dest: WirePath | null;
}

export interface WireReport {
  done: WireDone[];
  skipped: WirePath[];
  failed: WireItemError[];
  warnings: WireItemError[];
  cancelled: boolean;
  not_reached: WirePath[];
}

export interface WireProperties {
  files: number;
  dirs: number;
  bytes: number;
  unreadable: WirePath[];
  cancelled: boolean;
}

export interface WireScanDone {
  found: number;
  unreadable: WirePath[];
  cancelled: boolean;
}

/** `unit` is "bytes" (copy, move), "items" (trash, delete, empty trash) or "entries" (properties). */
export interface OpProgressEvent {
  op: OpId;
  done: number;
  total: number;
  unit: string;
  /** Display-only; never turn it back into a path. */
  stage: string;
}

export interface OpConflictEvent {
  op: OpId;
  conflict: number;
  source: WirePath;
  existing: WirePath;
  source_entry: WireEntry | null;
  existing_entry: WireEntry | null;
}

export interface OpDoneEvent {
  op: OpId;
  report: WireReport | null;
  properties: WireProperties | null;
  scan: WireScanDone | null;
  error: WireError | null;
}

export const startOp = (kind: OpKind, sources: WirePath[], dest?: WirePath) =>
  invoke<OpId>(cmd("start_op"), { kind, sources, dest: dest ?? null });

export const answerConflict = (
  op: OpId,
  conflict: number,
  choice: ConflictChoice,
  applyToAll: boolean
) => invoke<void>(cmd("answer_conflict"), { op, conflict, choice, applyToAll });

export const cancelOp = (op: OpId) => invoke<void>(cmd("cancel_op"), { op });

export const properties = (paths: WirePath[]) => invoke<OpId>(cmd("properties"), { paths });

// ---- trash ----

export interface WireTrashedItem {
  /** Opaque; pass it back unchanged. */
  id: string;
  name: string;
  original: WirePath;
  /** The raw DeletionDate, YYYY-MM-DDThh:mm:ss in local time. */
  deleted: string;
  trash_dir: WirePath;
  is_dir: boolean;
}

export interface WireTrashListing {
  items: WireTrashedItem[];
  unreadable: WireItemError[];
}

export const trashList = () => invoke<WireTrashListing>(cmd("trash_list"));

export const trashRestore = (items: WireTrashedItem[]) =>
  invoke<WireReport>(cmd("trash_restore"), { items });

export const trashPurge = (items: WireTrashedItem[]) =>
  invoke<WireReport>(cmd("trash_purge"), { items });

// ---- folder watches ----

export interface DirEvent {
  key: string;
  /** Set only on dir-gone, when the watch itself failed. */
  error?: WireError | null;
}

export const watchDir = (key: string, path: WirePath) =>
  invoke<void>(cmd("watch_dir"), { key, path });

export const unwatchDir = (key: string) => invoke<void>(cmd("unwatch_dir"), { key });

// ---- text ----

/** Opaque change stamp (serde transparent String); hand it back unchanged. */
export type WireStamp = string;

export interface WireReadOnly {
  /** NotUtf8, Utf16, MixedLineEndings, TooLarge or NoWritePermission. */
  kind: string;
  detail: string;
}

export type LineEnding = "lf" | "crlf";

export interface WireText {
  path: WirePath;
  /** "\n" line endings only, no byte order mark. */
  text: string;
  ending: LineEnding;
  bom: boolean;
  read_only: WireReadOnly | null;
  stamp: WireStamp;
}

export const textOpen = (path: WirePath) => invoke<WireText>(cmd("text_open"), { path });

/**
 * Saves `text`. `stamp` is the stamp of the text as opened or last saved: the
 * save is refused with ExternalModification when the file on disk no longer
 * matches it. `null` skips that check and overwrites whatever is on disk, so
 * pass it only for a deliberate overwrite (Save As to a new file, or the
 * user's confirmed "overwrite"), never because no stamp is at hand.
 */
export const textSave = (
  path: WirePath,
  text: string,
  ending: LineEnding,
  bom: boolean,
  stamp: WireStamp | null
) => invoke<WireStamp>(cmd("text_save"), { path, text, ending, bom, stamp });

/** "deleted" when nothing is at `path` any more. */
export type TextCheck = "same" | "changed" | "deleted";

export const textCheck = (path: WirePath, stamp: WireStamp) =>
  invoke<TextCheck>(cmd("text_check"), { path, stamp });

// ---- thumbnails ----

export type ThumbSize = "normal" | "large";

export interface ThumbEvent {
  key: string;
  path: WirePath;
  /** The cached PNG, or null when the file has no thumbnail. */
  file: WirePath | null;
  error: WireError | null;
}

export const thumbRequest = (key: string, paths: WirePath[], size: ThumbSize) =>
  invoke<void>(cmd("thumb_request"), { key, paths, size });

export const thumbCancel = (key: string) => invoke<void>(cmd("thumb_cancel"), { key });

// ---- theme (kernkraft-theme) ----

export interface Follow {
  colours: boolean;
  accent: boolean;
  fonts: boolean;
  radius: boolean;
}

export type ThemeMode = "system" | "light" | "dark";

export type KernAccent =
  | "slate"
  | "indigo"
  | "violet"
  | "plum"
  | "ocean"
  | "teal"
  | "forest"
  | "amber"
  | "copper"
  | "crimson"
  | "rose"
  | "graphite";

export type Density = "compact" | "cozy";

export interface UserChoice {
  mode: ThemeMode;
  accent: KernAccent;
  density: Density;
}

export type ThemeOrigin = "Hyprland" | "Portal" | "Gtk" | "Fontconfig" | "Kern" | "User";

/** Colours are "#rrggbbaa". */
export interface ThemeTokens {
  scheme: "light" | "dark";
  bg: string;
  surface: string;
  sunken: string;
  text: string;
  text_dim: string;
  border: string;
  link: string;
  accent: string;
  accent_soft: string;
  on_accent: string;
  accent_secondary: string;
  font_ui: string;
  font_mono: string;
  radius_small: number;
  radius_large: number;
  density: Density;
  origins: Record<string, ThemeOrigin>;
  wcag_fallbacks: string[];
  scheme_mismatch: boolean;
}

export interface WireTheme {
  /** The token set as `:root{--kern-*:...}` custom properties. */
  css: string;
  tokens: ThemeTokens;
  /** Tokens that fell back to Kern's neutrals for failing WCAG AA. */
  fallbacks: string[];
  /** Theme sources that could not be read, and bus or watcher failures. */
  problems: WireError[];
}

export const themeGet = (follow: Follow, user: UserChoice) =>
  invoke<WireTheme>(cmd("theme_get"), { follow, user });

export const themeSetPrefs = (follow: Follow, user: UserChoice) =>
  invoke<WireTheme>(cmd("theme_set_prefs"), { follow, user });

// ---- applications ----

export interface WireApp {
  /** The desktop file ID. */
  id: string;
  name: string;
  icon: string | null;
  terminal: boolean;
  no_display: boolean;
  mime_types: string[];
}

export interface WireAppList {
  apps: WireApp[];
  problems: WireError[];
}

export interface WireAppDefault {
  app: WireApp | null;
  problems: WireError[];
}

export interface WireMime {
  mime: string;
  is_text: boolean;
}

export const appsFor = (path: WirePath) => invoke<WireAppList>(cmd("apps_for"), { path });
export const appDefault = (path: WirePath) => invoke<WireAppDefault>(cmd("app_default"), { path });
export const allApps = () => invoke<WireAppList>(cmd("all_apps"));

export const launchApp = (id: string, paths: WirePath[], terminal?: string) =>
  invoke<void>(cmd("launch_app"), { id, paths, terminal: terminal ?? null });

export const openDefault = (paths: WirePath[], terminal?: string) =>
  invoke<void>(cmd("open_default"), { paths, terminal: terminal ?? null });

export const setDefaultApp = (id: string, mime: string) =>
  invoke<void>(cmd("set_default_app"), { id, mime });

export const openTerminal = (dir: WirePath, setting?: string) =>
  invoke<void>(cmd("open_terminal"), { dir, setting: setting ?? null });

export const mimeOf = (path: WirePath) => invoke<WireMime>(cmd("mime_of"), { path });

// ---- volumes ----

/**
 * Which disk a volume is on (kernkraft-volumes' DiskId): the device number and
 * the kernel's disk sequence number, read when the volume was listed.
 * `major:minor` is reused at once when a device is unplugged; `diskseq` is
 * unique per disk object until reboot and shared by a disk's partitions. A
 * stick reformatted in place keeps both.
 */
export interface DiskId {
  major: number;
  minor: number;
  diskseq: number;
}

/** A volume's identity, or why it has none; a volume with none cannot be unmounted, ejected or mounted. */
export type Identity = ({ state: "known" } & DiskId) | { state: "unknown"; reason: string };

/** A mounted volume. `identity` is passed back as `disk` to unmount and eject. */
export interface WireMount {
  mount_point: WirePath;
  identity: Identity;
  device: string;
  fs_type: string;
  label: string;
  removable: boolean;
  read_only: boolean;
}

/** An unmounted filesystem UDisks knows (kernkraft-volumes' Device). */
export interface Device {
  /** The UDisks object path, the handle to mount it. */
  object_path: string;
  device: string;
  label: string;
  fs_type: string;
  /** Size in bytes. */
  size: number;
  system: boolean;
  /** The filesystem UUID, empty when it has none. For display only: clones share it. */
  uuid: string;
  /** Passed back whole, as listed, to `volume_mount`. */
  identity: Identity;
}

export interface WireVolumes {
  mounted: WireMount[];
  unmounted: Device[];
  problems: WireError[];
}

/** The payload of `kernkraft://volumes-changed`: list the volumes again. `problems` are what the watch met since the last event. */
export interface VolumesChanged {
  problems: WireError[];
}

export const volumesList = () => invoke<WireVolumes>(cmd("volumes_list"));
export const volumeMount = (device: Device) => invoke<WirePath>(cmd("volume_mount"), { device });

export const volumeUnmount = (mountPoint: WirePath, disk: DiskId) =>
  invoke<void>(cmd("volume_unmount"), { mountPoint, disk });

export const volumeEject = (mountPoint: WirePath, disk: DiskId) =>
  invoke<void>(cmd("volume_eject"), { mountPoint, disk });

// ---- search and Documents ----

export interface SearchHitEvent {
  key: string;
  op: OpId;
  entries: WireEntry[];
}

export const search = (key: string, roots: WirePath[], query: string, hidden: boolean) =>
  invoke<OpId>(cmd("search"), { key, roots, query, hidden });

export const documents = (key: string, roots: WirePath[]) =>
  invoke<OpId>(cmd("documents"), { key, roots });
