// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

pub mod store;
pub mod store_cmds;

use tauri::Manager;

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri runtime cannot start, which leaves nothing to recover.
pub fn run() {
    tauri::Builder::default()
        .plugin(kernkraft_tauri::init())
        .setup(|app| {
            app.manage(store_cmds::StoreState::from_env());
            store_cmds::apply_at_startup(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_cmds::settings_get,
            store_cmds::settings_set,
            store_cmds::pins_get,
            store_cmds::pin,
            store_cmds::unpin,
            store_cmds::pins_reorder,
            store_cmds::recents_get,
            store_cmds::recent_touch,
            store_cmds::prune,
            store_cmds::store_errors_take,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kern");
}
