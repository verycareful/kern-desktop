// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/// Kern's own commands. Listing them makes Tauri generate an `allow-<name>`
/// permission for each (kebab-case) and deny any command not listed, so a
/// window can call only what a capability grants.
const COMMANDS: &[&str] = &[
    "settings_get",
    "settings_set",
    "layout_get",
    "layout_set",
    "pins_get",
    "pin",
    "unpin",
    "pin_editor_set",
    "pins_reorder",
    "pins_clear",
    "recents_get",
    "recent_touch",
    "recent_remove",
    "recents_clear",
    "binds_get",
    "binds_set",
    "binds_clear",
    "show_in_folder",
    "prune",
    "store_errors_take",
    "log_error",
    "file_identity",
    "link_target",
    "open_paths",
    "doc_opened",
    "doc_closed",
    "doc_moved",
    "open_pending_take",
    "doc_open_elsewhere",
    "detach_doc",
    "detached",
    "refuse_detach",
    "open_editor",
    "open_settings",
    "restart_request",
    "restart_abandon",
    "session_put",
    "session_closed_get",
    "session_restore_closed",
    "session_closed_dismiss",
    "move_doc_to_main",
    "hand_doc",
    "hand_refused",
    "adopted",
    "refuse_adoption",
    "confirm_close",
    "fm1_status",
    "default_fm_status",
    "make_default_fm",
    "clip_set",
    "clip_get",
    "clip_clear_if",
    "clip_text",
    "drag_out",
    "dnd_target",
    "drop_start_op",
    "remove_start_op",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
