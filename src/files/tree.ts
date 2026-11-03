// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pathKey, type WireEntry, type WireError, type WirePath } from "../ipc";
import { isFolder } from "./file-type";

// The folder tree's model, as pure functions (useTree.ts drives it, FolderTree.tsx draws it).
// The tree shows the folders the user expanded, each listed lazily; `flatten` turns the model
// into the visible rows in order, one array, so a virtualised list can draw any window of 100 000
// of them. Folders are named by pathKey, so a name that is not UTF-8 is a folder like any other.
// The keyboard follows the WAI-ARIA Authoring Practices 1.2 tree view pattern (section 3.26,
// "Tree View"): Down and Up move between visible rows, Right opens a closed folder and then
// enters it, Left closes an open folder and then goes to its parent, Home and End go to the
// first and last row, Enter opens a file or toggles a folder, and a printable character moves to
// the next row whose name starts with what was typed.

/** The height of a row in pixels: a 13.5px line with 6px above and below, plus the 1px gap. */
export const ROW_HEIGHT = 28;

/** The indent of one level in pixels. */
export const INDENT = 14;

export type Listing =
  | { state: "loading" }
  | { state: "ready"; entries: WireEntry[] }
  | { state: "error"; error: WireError };

/** A folder the tree shows open. */
export interface FolderNode {
  path: WirePath;
  /** The key of the folder holding it; null for the root. */
  parent: string | null;
  listing: Listing;
  /** Why changes in it will not show, when its watch could not be set or ended. */
  watchError: WireError | null;
}

/** What was found about a link to a folder. */
export type LinkState =
  /** Its identity is being compared with the folders above it. */
  | { kind: "checking" }
  /** It leads to a folder the branch is already inside: shown, not listed. */
  | { kind: "loop" }
  /** It could not be told whether it loops: shown with the reason, not listed. */
  | { kind: "unknown"; error: WireError };

export interface TreeModel {
  rootKey: string;
  /** The open folders, the root included. */
  folders: ReadonlyMap<string, FolderNode>;
  /** The links to folders that were judged, by the link's key. */
  links: ReadonlyMap<string, LinkState>;
}

export function newModel(root: WirePath): TreeModel {
  const rootKey = pathKey(root);
  return {
    rootKey,
    folders: new Map([
      [rootKey, { path: root, parent: null, listing: { state: "loading" }, watchError: null }],
    ]),
    links: new Map(),
  };
}

/** A copy of the model with folder `key` replaced by `f(node)`; the model itself when it is not open. */
export function updateFolder(
  model: TreeModel,
  key: string,
  f: (n: FolderNode) => FolderNode
): TreeModel {
  const node = model.folders.get(key);
  if (!node) return model;
  const folders = new Map(model.folders);
  folders.set(key, f(node));
  return { ...model, folders };
}

export function openFolder(model: TreeModel, key: string, node: FolderNode): TreeModel {
  const folders = new Map(model.folders);
  folders.set(key, node);
  const links = new Map(model.links);
  links.delete(key);
  return { ...model, folders, links };
}

export function setLink(model: TreeModel, key: string, state: LinkState | null): TreeModel {
  const links = new Map(model.links);
  if (state) links.set(key, state);
  else links.delete(key);
  return { ...model, links };
}

/** True when folder `key` is `ancestor` or lies below it in the tree. */
export function isInside(model: TreeModel, key: string, ancestor: string): boolean {
  for (let k: string | null = key; k !== null; k = model.folders.get(k)?.parent ?? null) {
    if (k === ancestor) return true;
  }
  return false;
}

/** The model without folder `key` and the folders below it, and the keys that went. */
export function closeFolder(
  model: TreeModel,
  key: string
): { model: TreeModel; removed: string[] } {
  if (key === model.rootKey) return { model, removed: [] };
  const removed = [...model.folders.keys()].filter((k) => isInside(model, k, key));
  if (removed.length === 0) return { model, removed };
  const folders = new Map(model.folders);
  for (const k of removed) folders.delete(k);
  return { model: { ...model, folders }, removed };
}

/**
 * The paths of the folders from the root down to folder `key`, then `key` itself: the folders a
 * link inside `key` would lead back to.
 */
export function branchPaths(model: TreeModel, key: string): WirePath[] {
  const out: WirePath[] = [];
  for (let k: string | null = key; k !== null; k = model.folders.get(k)?.parent ?? null) {
    const node = model.folders.get(k);
    if (!node) break;
    out.unshift(node.path);
  }
  return out;
}

/** A line of the tree: an entry, or a note about the folder above it. */
export type Row = EntryRow | NoteRow;

export interface EntryRow {
  kind: "entry";
  key: string;
  entry: WireEntry;
  depth: number;
  /** A folder, or a link to one. */
  folder: boolean;
  expanded: boolean;
  /** The link leads back to a folder above it. */
  loop: boolean;
  /** The key of the folder this entry is listed in. */
  parentKey: string;
  /** 1-based place among its siblings, and their number (aria-posinset, aria-setsize). */
  posInSet: number;
  setSize: number;
}

export interface NoteRow {
  kind: "note";
  key: string;
  depth: number;
  tone: "info" | "error";
  text: string;
}

interface Frame {
  folderKey: string;
  entries: WireEntry[];
  at: number;
  depth: number;
}

/** What a note says about a folder that is not (yet) listing entries. */
function pendingNote(key: string, depth: number, node: FolderNode): NoteRow | null {
  if (node.listing.state === "loading") {
    return { kind: "note", key: `note:loading:${key}`, depth, tone: "info", text: "Listing…" };
  }
  if (node.listing.state === "error") {
    return {
      kind: "note",
      key: `note:error:${key}`,
      depth,
      tone: "error",
      text: `${node.listing.error.kind}: ${node.listing.error.message}`,
    };
  }
  return null;
}

/** The visible rows in order: each open folder's entries, with the rows of an open folder after its own. */
export function flatten(model: TreeModel): Row[] {
  const out: Row[] = [];
  const stack: Frame[] = [];
  /** Starts folder `key` at `depth`: its notes now, its entries as the stack unwinds. */
  const enter = (key: string, depth: number) => {
    const node = model.folders.get(key);
    if (!node) return;
    const pending = pendingNote(key, depth, node);
    if (pending) {
      out.push(pending);
      return;
    }
    if (node.watchError) {
      out.push({
        kind: "note",
        key: `note:watch:${key}`,
        depth,
        tone: "error",
        text: `Changes in this folder will not show: ${node.watchError.kind}: ${node.watchError.message}`,
      });
    }
    if (node.listing.state !== "ready") return;
    if (node.listing.entries.length === 0) {
      out.push({
        kind: "note",
        key: `note:empty:${key}`,
        depth,
        tone: "info",
        text: "Empty folder",
      });
      return;
    }
    stack.push({ folderKey: key, entries: node.listing.entries, at: 0, depth });
  };
  enter(model.rootKey, 0);
  while (stack.length > 0) {
    const f = stack[stack.length - 1]!;
    const entry = f.entries[f.at];
    if (!entry) {
      stack.pop();
      continue;
    }
    f.at++;
    const key = pathKey(entry.path);
    const folder = isFolder(entry);
    const link = model.links.get(key);
    const loop = link?.kind === "loop";
    const expanded = folder && !loop && model.folders.has(key);
    out.push({
      kind: "entry",
      key,
      entry,
      depth: f.depth,
      folder,
      expanded,
      loop,
      parentKey: f.folderKey,
      posInSet: f.at,
      setSize: f.entries.length,
    });
    if (link?.kind === "unknown") {
      out.push({
        kind: "note",
        key: `note:link:${key}`,
        depth: f.depth + 1,
        tone: "error",
        text: `Kern could not tell whether this link leads back to a folder above it, so it is not opened: ${link.error.kind}: ${link.error.message}`,
      });
    }
    if (expanded) enter(key, f.depth + 1);
  }
  return out;
}

/** The index of each entry row by key. */
export function indexByKey(rows: readonly Row[]): Map<string, number> {
  const at = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.kind === "entry") at.set(r.key, i);
  });
  return at;
}

/** The first entry row at or after `from` (stepping by `step`), or -1. */
function entryFrom(rows: readonly Row[], from: number, step: 1 | -1): number {
  for (let i = from; i >= 0 && i < rows.length; i += step) {
    if (rows[i]!.kind === "entry") return i;
  }
  return -1;
}

export type TreeAction =
  { move: number } | { expand: string } | { collapse: string } | { activate: string };

/**
 * What a key does when the row at `active` (an index into `rows`, or -1 for none) has the focus,
 * or null when the key is not a tree key. Pure: the caller applies the action.
 */
export function treeKey(
  rows: readonly Row[],
  active: number,
  key: string,
  typed = ""
): TreeAction | null {
  const row = active >= 0 ? rows[active] : undefined;
  const here = row?.kind === "entry" ? row : undefined;
  const last = entryFrom(rows, rows.length - 1, -1);
  const first = entryFrom(rows, 0, 1);
  switch (key) {
    case "ArrowDown": {
      const i = here ? entryFrom(rows, active + 1, 1) : first;
      return i >= 0 ? { move: i } : { move: active };
    }
    case "ArrowUp": {
      const i = here ? entryFrom(rows, active - 1, -1) : first;
      return i >= 0 ? { move: i } : { move: active };
    }
    case "Home":
      return first >= 0 ? { move: first } : null;
    case "End":
      return last >= 0 ? { move: last } : null;
    case "ArrowRight":
      if (!here || !here.folder || here.loop) return null;
      if (!here.expanded) return { expand: here.key };
      // An open folder: into its first entry (the next row, unless it is a note).
      return rows[active + 1]?.kind === "entry" && (rows[active + 1] as EntryRow).depth > here.depth
        ? { move: active + 1 }
        : null;
    case "ArrowLeft": {
      if (!here) return null;
      if (here.folder && here.expanded) return { collapse: here.key };
      const parent = rows.findIndex((r) => r.kind === "entry" && r.key === here.parentKey);
      return parent >= 0 ? { move: parent } : null;
    }
    case "Enter":
    case " ":
      return here ? { activate: here.key } : null;
    default: {
      if (typed === "") return null;
      const want = typed.toLowerCase();
      const n = rows.length;
      // From the row after the current one, wrapping; a longer prefix may stay on the current row.
      const start = want.length > 1 ? Math.max(active, 0) : active + 1;
      for (let k = 0; k < n; k++) {
        const i = (start + k + n) % n;
        const r = rows[i]!;
        if (r.kind === "entry" && r.entry.name.toLowerCase().startsWith(want)) return { move: i };
      }
      return null;
    }
  }
}

/**
 * How long typed characters count as one word for the type-ahead. The Authoring Practices name no
 * value; one second is the pause after which the common file lists start a new word.
 */
export const TYPE_AHEAD_MS = 1000;
