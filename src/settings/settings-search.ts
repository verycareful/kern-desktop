// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Every row of the Settings window, with the words the search box finds it by. A row is found
// when each word typed is part of its label, its group, its category or its other words (case
// does not matter), so "dark" finds the theme and "hidden" the hidden items.

export type Category = "appearance" | "files" | "library" | "editor" | "keys" | "about";

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
    id: "keys",
    label: "Keys and mouse",
    blurb:
      "The keys and mouse buttons that run each action. A change applies at once, in every window.",
  },
  {
    id: "about",
    label: "About",
    blurb:
      "The version, the error log, what Kern does with your network, the licence and where the source lives.",
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
    label: "Main window layout",
    words: "layout file manager editor",
  },
  panel_order: {
    category: "files",
    group: "Panels",
    label: "File manager panel order",
    words:
      "panels columns order move left right swap places pinned recent folders sidebar layout arrange",
  },
  editor_panel_order: {
    category: "files",
    group: "Panels",
    label: "Editor window panel order",
    words:
      "panels columns order move left right swap places folders tree pinned recent sidebar layout arrange",
  },
  new_tab_folder: {
    category: "files",
    group: "New tabs",
    label: "New tab folder",
    words: "new tab home folder start ctrl+t",
  },
  new_tab_default: {
    category: "files",
    group: "New tabs",
    label: "Ctrl+T opens",
    words: "new tab here current folder ctrl+t ctrl+shift+t shortcut swap",
  },
  view_mode: { category: "files", group: "New folder views", label: "View", words: "list grid" },
  show_hidden: {
    category: "files",
    group: "New folder views",
    label: "Show hidden items",
    words: "dotfiles hidden files",
  },
  single_click_left: {
    category: "files",
    group: "Opening",
    label: "Left panel opens with",
    words:
      "double click single click mouse open files folders pointer left panel places volumes trash library sidebar",
  },
  single_click_right: {
    category: "files",
    group: "Opening",
    label: "Right panel opens with",
    words: "double click single click mouse open files folders pointer right panel pinned recent",
  },
  single_click_centre: {
    category: "files",
    group: "Opening",
    label: "File manager opens with",
    words:
      "double click single click mouse open files folders pointer file manager centre list grid search",
  },
  single_click_editor: {
    category: "files",
    group: "Opening",
    label: "Editor window opens with",
    words:
      "double click single click mouse open files folders pointer editor window tree files search",
  },
  time_format: {
    category: "files",
    group: "Time",
    label: "Time of day in dates",
    words: "clock 12 hour 24 hour am pm modified date time format locale",
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
  clear_pins: {
    category: "files",
    group: "Pinned and recent",
    label: "Clear pins",
    words: "unpin remove forget right panel pinned",
  },
  clear_recents: {
    category: "files",
    group: "Pinned and recent",
    label: "Clear recents",
    words: "remove forget history right panel recent opened",
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
  keys_list: {
    category: "keys",
    group: "Binds",
    label: "Keys and mouse buttons",
    words:
      "shortcut shortcuts keyboard hotkey binding bindings bind rebind remap middle click mouse button back forward",
  },
  reset_binds: {
    category: "keys",
    group: "Reset",
    label: "Reset all binds",
    words: "default defaults restore clear shortcuts keyboard mouse remove",
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
  error_log: {
    category: "about",
    group: "Error log",
    label: "Write an error log",
    words: "errors crash panic diagnostics file kern.log troubleshooting report",
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
