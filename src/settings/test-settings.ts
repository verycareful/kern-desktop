// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Settings, WindowLayout } from "../ipc";

/** The stored layout of a user who never chose one, in the shape layout_get answers with. */
export const NO_LAYOUT: WindowLayout = {
  left_width: 280,
  left_open: true,
  right_width: 280,
  tree_root: null,
};

/** Settings for tests, in the shape settings_get answers with. */
export const SETTINGS: Settings = {
  theme_mode: "system",
  accent: "slate",
  follow: { colours: true, accent: true, fonts: true, radius: true },
  scan_roots: [],
  scan_documents: true,
  scan_downloads: true,
  terminal: null,
  word_wrap: false,
  editor_zoom: 1,
  view_mode: "list",
  show_hidden: false,
  single_click_left: true,
  single_click_right: false,
  single_click_centre: false,
  single_click_editor: false,
  interface_size: 100,
  default_layout: "file_manager",
  new_tab_folder: null,
  new_tab_default: "folder",
  time_format: "system",
  error_log: true,
};
