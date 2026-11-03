// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Settings } from "../ipc";

/** Settings for tests, in the shape settings_get answers with. */
export const SETTINGS: Settings = {
  theme_mode: "system",
  accent: "slate",
  density: "cozy",
  follow: { colours: true, accent: true, fonts: true, radius: true },
  scan_roots: [],
  scan_documents: true,
  scan_downloads: true,
  terminal: null,
  word_wrap: false,
  editor_zoom: 1,
  view_mode: "list",
  show_hidden: false,
  interface_size: 100,
};
