// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Every row of the Settings window, with the words the search box finds it by. A row is found
// when each word typed is part of its label, its group, its category or its other words (case
// does not matter), so "dark" finds the theme and "hidden" the hidden items.

export type Category = "appearance" | "files" | "library" | "editor" | "about";

export const CATEGORIES: readonly { id: Category; label: string; blurb: string }[] = [
  { id: "appearance", label: "Appearance", blurb: "How Kern looks in every window." },
  {
    id: "files",
    label: "Files",
    blurb: "Folder views, the main window and the programs Kern uses.",
  },
  { id: "library", label: "Library", blurb: "The folders the Library walks for documents." },
  { id: "editor", label: "Editor", blurb: "The text editor." },
  {
    id: "about",
    label: "About",
    blurb: "The version, what Kern does with your network, the licence and where the source lives.",
  },
];

export const isCategory = (s: string): s is Category => CATEGORIES.some((c) => c.id === s);

export interface RowInfo {
  category: Category;
  group: string;
  label: string;
  words: string;
}

export const ROWS = {
  theme: {
    category: "appearance",
    group: "Theme",
    label: "Theme",
    words: "light dark system mode scheme",
  },
  interface_size: {
    category: "appearance",
    group: "Size and colour",
    label: "Interface size",
    words: "zoom scale bigger smaller larger percent",
  },
  accent: {
    category: "appearance",
    group: "Size and colour",
    label: "Accent colour",
    words: "color highlight",
  },
  follow_colours: {
    category: "appearance",
    group: "Follow the system",
    label: "Colours",
    words: "color hyprland portal gtk",
  },
  follow_accent: {
    category: "appearance",
    group: "Follow the system",
    label: "Accent colour",
    words: "color",
  },
  follow_fonts: {
    category: "appearance",
    group: "Follow the system",
    label: "Fonts",
    words: "fontconfig typeface",
  },
  follow_radius: {
    category: "appearance",
    group: "Follow the system",
    label: "Corner radius",
    words: "rounded corners hyprtoolkit",
  },
  default_layout: {
    category: "files",
    group: "Main window",
    label: "Main window opens as",
    words: "layout file manager editor",
  },
  view_mode: { category: "files", group: "New folder views", label: "View", words: "list grid" },
  show_hidden: {
    category: "files",
    group: "New folder views",
    label: "Show hidden items",
    words: "dotfiles hidden files",
  },
  terminal: {
    category: "files",
    group: "Programs",
    label: "Terminal",
    words: "console shell command",
  },
  default_fm: {
    category: "files",
    group: "Programs",
    label: "Default file manager",
    words: "inode directory filemanager1 folders open",
  },
  scan_documents: { category: "library", group: "Folders", label: "Documents", words: "walk scan" },
  scan_downloads: { category: "library", group: "Folders", label: "Downloads", words: "walk scan" },
  scan_roots: {
    category: "library",
    group: "Folders",
    label: "Your folders",
    words: "walk scan add remove folder",
  },
  word_wrap: {
    category: "editor",
    group: "Text",
    label: "Wrap long lines",
    words: "word wrap lines",
  },
  text_size: {
    category: "editor",
    group: "Text",
    label: "Text size",
    words: "zoom font bigger smaller",
  },
  version: { category: "about", group: "Kern", label: "Version", words: "alpha release" },
  network: {
    category: "about",
    group: "Kern",
    label: "Nothing leaves this computer",
    words: "privacy network offline internet telemetry analytics accounts sync",
  },
  licence: {
    category: "about",
    group: "Kern",
    label: "Licence",
    words: "license agpl free software copyright",
  },
  kernkraft: {
    category: "about",
    group: "Kern",
    label: "kernkraft",
    words: "core library github repository link formats pdf file operations",
  },
  source: {
    category: "about",
    group: "Kern",
    label: "Source code",
    words: "github repository link desktop",
  },
  android: {
    category: "about",
    group: "Kern",
    label: "Kern for Android",
    words: "github repository link phone app",
  },
} as const satisfies Record<string, RowInfo>;

export type RowId = keyof typeof ROWS;

const words = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean);

/** Whether row `id` is shown for `query`; every row is for an empty one. */
export function rowMatches(id: RowId, query: string): boolean {
  const row: RowInfo = ROWS[id];
  const category = CATEGORIES.find((c) => c.id === row.category)?.label ?? "";
  const text = `${row.label} ${row.group} ${category} ${row.words}`.toLowerCase();
  return words(query).every((w) => text.includes(w));
}

/** The rows of `category` shown for `query`. */
export function rowsShown(category: Category, query: string): RowId[] {
  return (Object.keys(ROWS) as RowId[]).filter(
    (id) => ROWS[id].category === category && rowMatches(id, query)
  );
}

/** Whether `query` is a search: anything but blanks. */
export const searching = (query: string): boolean => words(query).length > 0;
