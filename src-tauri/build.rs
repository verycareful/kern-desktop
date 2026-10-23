// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/// Kern's own commands. Listing them makes Tauri generate an `allow-<name>`
/// permission for each (kebab-case) and deny any command not listed, so a
/// window can call only what a capability grants.
const COMMANDS: &[&str] = &[
    "settings_get",
    "settings_set",
    "pins_get",
    "pin",
    "unpin",
    "pins_reorder",
    "recents_get",
    "recent_touch",
    "prune",
    "store_errors_take",
    "open_paths",
    "doc_opened",
    "doc_closed",
    "open_pending_take",
    "detach_doc",
    "move_doc_to_main",
    "adopted",
    "confirm_close",
    "fm1_status",
    "default_fm_status",
    "make_default_fm",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
