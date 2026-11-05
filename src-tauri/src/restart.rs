// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Restarting Kern, asked for from the Settings window.
//!
//! [`restart_request`] marks a restart as pending and asks every window to
//! close with the question a close asks ([`EVENT_CLOSE_REQUESTED`], payload
//! `{"restart": true}`), so no document with unsaved changes goes unasked.
//! A window the user keeps open calls [`restart_abandon`] and the restart is
//! off; the windows already closed stay closed. A launch handled meanwhile
//! (Kern opened again from a launcher or a file manager) ends it too, and
//! `main` says so.
//!
//! When the last window has gone and the application is asked to exit with
//! the restart pending, [`relaunch_if_pending`] starts Kern's program again
//! (the AppImage when Kern runs from one: `tauri::process::current_binary`)
//! with no arguments and [`RESTART_ENV`] set, and the exit goes ahead. The
//! new process waits for this one to let go of the bus name
//! (`instance::start`). A program that cannot be started is an error the
//! caller shows; the application then stays.

use std::process::Command;
use std::sync::atomic::Ordering;

use kernkraft_tauri::WireError;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

use crate::instance::RESTART_ENV;
use crate::windows::{
    show_errors, state, window_kind, wire_error, WindowKind, EVENT_CLOSE_REQUESTED,
};

/// Asks every window to close for a restart. Only the Settings window asks.
/// A window that cannot be asked ends the restart, with its label in the
/// error; the windows asked before it still ask their question.
#[tauri::command]
pub fn restart_request<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), WireError> {
    if window_kind(window.label()) != Some(WindowKind::Settings) {
        return Err(wire_error(
            "Denied",
            "only the Settings window restarts Kern",
            None,
        ));
    }
    let st = state(&app)?;
    st.restart.store(true, Ordering::SeqCst);
    let failed: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter_map(|label| {
            app.emit_to(
                label.as_str(),
                EVENT_CLOSE_REQUESTED,
                json!({"restart": true}),
            )
            .err()
            .map(|e| format!("{label} ({e})"))
        })
        .collect();
    if failed.is_empty() {
        return Ok(());
    }
    st.restart.store(false, Ordering::SeqCst);
    Err(wire_error(
        "Window",
        format!(
            "Kern did not restart: it could not ask {} to close",
            failed.join(", ")
        ),
        None,
    ))
}

/// A window asked to close for a restart stays open: the restart is off.
#[tauri::command]
pub fn restart_abandon<R: Runtime>(app: AppHandle<R>) -> Result<(), WireError> {
    state(&app)?.restart.store(false, Ordering::SeqCst);
    Ok(())
}

/// Whether a restart is waiting for the windows to close.
pub fn pending<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<crate::windows::WindowState>()
        .is_some_and(|st| st.restart.load(Ordering::SeqCst))
}

/// A launch is being handled: a restart waiting for the windows ends, since
/// the user has asked for a window, and `main` says why it did not happen.
pub fn abandon_for_launch<R: Runtime>(app: &AppHandle<R>) {
    let Some(st) = app.try_state::<crate::windows::WindowState>() else {
        return;
    };
    if st.restart.swap(false, Ordering::SeqCst) {
        show_errors(
            app,
            &[wire_error(
                "Restart",
                "Kern did not restart: it was opened again while its windows were closing",
                None,
            )],
            "",
        );
    }
}

/// The application is exiting. With a restart pending, starts Kern's program
/// again; the restart is no longer pending either way. An error is that
/// program not starting.
pub fn relaunch_if_pending<R: Runtime>(app: &AppHandle<R>) -> Result<(), WireError> {
    let Some(st) = app.try_state::<crate::windows::WindowState>() else {
        return Ok(());
    };
    if !st.restart.swap(false, Ordering::SeqCst) {
        return Ok(());
    }
    let program = tauri::process::current_binary(&app.env()).map_err(|e| {
        wire_error(
            "Restart",
            format!("Kern did not restart: its program could not be found: {e}"),
            None,
        )
    })?;
    Command::new(&program)
        .env(RESTART_ENV, "1")
        .spawn()
        .map(drop)
        .map_err(|e| {
            wire_error(
                "Restart",
                format!(
                    "Kern did not restart: {} could not be started: {e}",
                    program.display()
                ),
                Some(&program),
            )
        })
}
