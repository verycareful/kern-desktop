// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

pub mod cli;
pub mod instance;
pub mod open;
pub mod prelaunch;
pub mod store;
pub mod store_cmds;
pub mod windows;

use tauri::Manager;

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri runtime cannot start, which leaves nothing to recover.
pub fn run() {
    // Before anything creates a window: a second launch forwards and exits.
    let own = instance::own_invocation();
    // A launch that needs no window is finished here, before the bus name
    // is claimed.
    if let Some(code) = prelaunch::run(&own) {
        std::process::exit(code);
    }
    let role = instance::start(&own);
    tauri::Builder::default()
        // Document windows are not remembered: a new doc-1 is unrelated to
        // an earlier one. The main window keeps its place.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| !label.starts_with("doc-"))
                .build(),
        )
        .plugin(kernkraft_tauri::init())
        .on_window_event(windows::on_window_event)
        .on_page_load(windows::on_page_load)
        .setup(move |app| {
            app.manage(store_cmds::StoreState::from_env());
            app.manage(windows::WindowState::default());
            store_cmds::apply_at_startup(app.handle());
            match role {
                instance::Role::Owner {
                    connection,
                    launches,
                } => {
                    app.manage(instance::BusState(Some(connection)));
                    windows::serve_launches(app.handle().clone(), launches);
                }
                instance::Role::Standalone => {
                    app.manage(instance::BusState(None));
                }
            }
            // This process's own launch is handled like a forwarded one.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                windows::handle_launch(&handle, own).await;
            });
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
            windows::open_paths,
            windows::doc_opened,
            windows::doc_closed,
            windows::open_pending_take,
            windows::detach_doc,
            windows::move_doc_to_main,
            windows::adopted,
            windows::confirm_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kern");
}
