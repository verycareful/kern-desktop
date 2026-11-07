// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

pub mod cli;
pub mod clipboard;
pub mod default_fm;
pub mod dnd;
pub mod drop_rule;
pub mod error_log;
pub mod filemanager1;
pub mod guard;
pub mod identity;
pub mod instance;
pub mod open;
pub mod prelaunch;
pub mod remove;
pub mod restart;
pub mod session;
pub mod store;
pub mod store_cmds;
pub mod windows;
pub mod zoom;

use tauri::Manager;
use tauri_plugin_window_state::StateFlags;

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri runtime cannot start, which leaves nothing to recover.
pub fn run() {
    // First, so a panic anywhere after this is logged.
    if let Err(why) = error_log::init_from_env() {
        eprintln!("kern: {why}");
    }
    error_log::install_panic_hook();
    // Before anything creates a window: a second launch forwards and exits.
    let own = instance::own_invocation();
    // A launch that needs no window is finished here, before the bus name
    // is claimed.
    if let Some(code) = prelaunch::run(&own) {
        std::process::exit(code);
    }
    let launches = instance::Launches::default();
    // This process's own launch is pending from the start, like one
    // answered on the bus; nothing can have closed the application yet.
    launches.begin();
    let fm1_launches = launches.clone();
    let restarted = instance::take_restart_mark();
    let role = instance::start(&own, launches.clone(), restarted);
    // GTK takes the Wayland app id and the X11 window class from GLib's
    // program name, and a compositor or dock finds a window's desktop entry
    // (its name and icon) by that id. The entry is installed under the
    // application id, which is also the bus name. Tauri's GTK application id
    // option is not used: it would claim the bus name the instance owns.
    gtk::glib::set_prgname(Some(instance::BUS_NAME));
    tauri::Builder::default()
        // Every window keeps its place and size by label, so a window opened
        // again at launch (session.rs) comes back where it was, and a new
        // editor-1 or doc-1 opens where the last one did. Whether a window
        // was maximized is not kept: under a tiling compositor (Hyprland) GTK
        // reports a tiled window as maximized, and asking for that state at
        // the next launch makes the compositor maximize it over its
        // neighbours instead of tiling it.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(kernkraft_tauri::init())
        .plugin(zoom::plugin())
        .plugin(guard::plugin())
        .plugin(dnd::plugin())
        .on_window_event(windows::on_window_event)
        .on_page_load(windows::on_page_load)
        .setup(move |app| {
            app.manage(store_cmds::StoreState::from_env());
            app.manage(windows::WindowState::default());
            session::manage(app.handle());
            if let Err(e) = windows::announce_releases(app.handle()) {
                eprintln!("kern: {e:?}");
            }
            app.manage(launches);
            store_cmds::apply_at_startup(app.handle());
            match role {
                instance::Role::Owner {
                    connection,
                    launches,
                } => {
                    match filemanager1::serve(&connection, filemanager1::BUS_NAME, fm1_launches) {
                        Ok(svc) => {
                            app.manage(svc.status);
                            filemanager1::serve_requests(app.handle().clone(), svc.requests);
                        }
                        Err(e) => {
                            let why = format!("could not serve {}: {e}", filemanager1::BUS_NAME);
                            eprintln!("kern: {why}");
                            app.manage(filemanager1::Fm1State::unavailable(&why));
                        }
                    };
                    app.manage(instance::BusState(Some(connection)));
                    windows::serve_launches(app.handle().clone(), launches);
                }
                instance::Role::Standalone => {
                    app.manage(filemanager1::Fm1State::unavailable(
                        "no session bus connection",
                    ));
                    app.manage(instance::BusState(None));
                }
            }
            // This process's own launch is handled like a forwarded one.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                windows::run_first_launch(&handle, own, restarted).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_cmds::settings_get,
            store_cmds::settings_set,
            store_cmds::layout_get,
            store_cmds::layout_set,
            store_cmds::pins_get,
            store_cmds::pin,
            store_cmds::unpin,
            store_cmds::pin_editor_set,
            store_cmds::pins_reorder,
            store_cmds::recents_get,
            store_cmds::recent_touch,
            store_cmds::recent_remove,
            store_cmds::prune,
            store_cmds::store_errors_take,
            error_log::log_error,
            identity::file_identity,
            identity::link_target,
            windows::open_paths,
            windows::doc_opened,
            windows::doc_closed,
            windows::open_pending_take,
            windows::doc_open_elsewhere,
            windows::detach_doc,
            windows::detached,
            windows::refuse_detach,
            windows::open_editor,
            windows::open_settings,
            restart::restart_request,
            restart::restart_abandon,
            session::session_put,
            session::session_closed_get,
            session::session_restore_closed,
            session::session_closed_dismiss,
            windows::move_doc_to_main,
            windows::hand_doc,
            windows::hand_refused,
            windows::adopted,
            windows::refuse_adoption,
            windows::confirm_close,
            filemanager1::fm1_status,
            filemanager1::show_in_folder,
            default_fm::default_fm_status,
            default_fm::make_default_fm,
            clipboard::clip_set,
            clipboard::clip_get,
            clipboard::clip_clear_if,
            clipboard::clip_text,
            dnd::drag_out,
            dnd::dnd_target,
            dnd::drop_start_op,
            remove::remove_start_op,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Kern")
        .run(windows::on_run_event);
}
