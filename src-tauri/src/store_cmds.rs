// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Tauri commands over [`Store`](crate::store::Store), and the events that
//! tell every window a store changed.
//!
//! Events go to all windows: `kern://settings-changed` (the new
//! [`Settings`]), `kern://pins-changed` ([`Pins`]), `kern://recents-changed`
//! ([`Recents`]) and `kern://store-error` ([`CorruptReport`]). A corrupt
//! file is reported once; because a window may not be listening yet when it
//! is found (the settings are read at startup), the report is also queued
//! and `store_errors_take` hands the queue over. A report reaches a window
//! by both routes when it was listening, so the UI shows each `moved_to`
//! once.

use std::sync::{Arc, Mutex, PoisonError};

use kernkraft_fs::base_dirs;
use kernkraft_tauri::{KernkraftExt, WireError, WirePath};
use kernkraft_theme::UserChoice;
use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::store::{CorruptReport, Loaded, Pins, PruneReport, Recents, Settings, Store};

pub const EVENT_SETTINGS_CHANGED: &str = "kern://settings-changed";
pub const EVENT_PINS_CHANGED: &str = "kern://pins-changed";
pub const EVENT_RECENTS_CHANGED: &str = "kern://recents-changed";
pub const EVENT_STORE_ERROR: &str = "kern://store-error";

/// The managed state: the store, or why there is none (no usable `HOME`).
pub struct StoreState {
    store: Result<Arc<Store>, WireError>,
    pending: Mutex<Vec<CorruptReport>>,
}

impl StoreState {
    /// State over a given store.
    pub fn new(store: Store) -> StoreState {
        StoreState {
            store: Ok(Arc::new(store)),
            pending: Mutex::new(Vec::new()),
        }
    }

    /// The store under the user's XDG directories.
    pub fn from_env() -> StoreState {
        let store = match base_dirs() {
            Some(base) => Ok(Arc::new(Store::from_base_dirs(&base))),
            None => Err(WireError {
                kind: "NoHome".to_owned(),
                message: "HOME is not set to an absolute path; the settings, pins and recents \
                          directories are unknown"
                    .to_owned(),
                path: None,
                details: None,
            }),
        };
        StoreState {
            store,
            pending: Mutex::new(Vec::new()),
        }
    }

    fn store(&self) -> Result<Arc<Store>, WireError> {
        self.store.clone()
    }

    fn queue(&self, reports: &[CorruptReport]) {
        self.pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend(reports.iter().cloned());
    }
}

/// Runs `f` on the blocking pool, as file access must not hold a Tauri
/// worker.
async fn blocking<T, F>(f: F) -> Result<T, WireError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, WireError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| WireError {
            kind: "Internal".to_owned(),
            message: format!("internal error: {e}"),
            path: None,
            details: None,
        })?
}

/// Queues and emits the corrupt-file reports, if any.
fn announce_corrupt<R: Runtime>(app: &AppHandle<R>, reports: &[CorruptReport]) {
    if reports.is_empty() {
        return;
    }
    app.state::<StoreState>().queue(reports);
    for report in reports {
        // Emit fails only when serialising the payload fails; the queue
        // still holds the report.
        let _ = app.emit(EVENT_STORE_ERROR, report);
    }
}

/// Announces a corrupt file and, when the call rewrote the file or reset it
/// to defaults, the change.
fn finish<R: Runtime, T: serde::Serialize + Clone>(
    app: &AppHandle<R>,
    loaded: Loaded<T>,
    event: &str,
) -> T {
    // A file moved aside leaves defaults in its place; a field that could
    // not be read leaves the file as it is.
    let reset = loaded.corrupt.iter().any(|r| r.moved_to.is_some());
    announce_corrupt(app, &loaded.corrupt);
    if loaded.changed || reset {
        let _ = app.emit(event, &loaded.value);
    }
    loaded.value
}

/// Reads the stored settings, for startup, applies the theme preferences
/// through kernkraft-tauri, and reports a corrupt file. Runs off the main
/// thread: it reads files, and theming gathers system sources.
pub fn apply_at_startup<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<StoreState>();
        let outcome = state
            .store()
            .and_then(|store| store.settings_get())
            .map(|loaded| finish(&app, loaded, EVENT_SETTINGS_CHANGED))
            .and_then(|s| {
                let user = UserChoice {
                    mode: s.theme_mode,
                    accent: s.accent,
                    density: s.density,
                };
                app.kernkraft().theme_set_prefs(s.follow, user).map(|_| ())
            });
        if let Err(e) = outcome {
            // No window can be listening yet and there is no log; stderr is
            // what a terminal launch or the journal shows.
            eprintln!("kern: applying the stored theme settings failed: {e}");
        }
    });
}

#[tauri::command]
pub async fn settings_get<R: Runtime>(app: AppHandle<R>) -> Result<Settings, WireError> {
    let store = app.state::<StoreState>().store()?;
    let loaded = blocking(move || store.settings_get()).await?;
    Ok(finish(&app, loaded, EVENT_SETTINGS_CHANGED))
}

#[tauri::command]
pub async fn settings_set<R: Runtime>(
    app: AppHandle<R>,
    patch: Map<String, Value>,
) -> Result<Settings, WireError> {
    let store = app.state::<StoreState>().store()?;
    let loaded = blocking(move || store.settings_set(patch)).await?;
    Ok(finish(&app, loaded, EVENT_SETTINGS_CHANGED))
}

#[tauri::command]
pub async fn pins_get<R: Runtime>(app: AppHandle<R>) -> Result<Pins, WireError> {
    let store = app.state::<StoreState>().store()?;
    let loaded = blocking(move || store.pins_get()).await?;
    Ok(finish(&app, loaded, EVENT_PINS_CHANGED))
}

#[tauri::command]
pub async fn pin<R: Runtime>(app: AppHandle<R>, path: WirePath) -> Result<Pins, WireError> {
    let store = app.state::<StoreState>().store()?;
    let loaded = blocking(move || store.pin(&path)).await?;
    Ok(finish(&app, loaded, EVENT_PINS_CHANGED))
}

#[tauri::command]
pub async fn unpin<R: Runtime>(app: AppHandle<R>, path: WirePath) -> Result<Pins, WireError> {
    let store = app.state::<StoreState>().store()?;
    let loaded = blocking(move || store.unpin(&path)).await?;
    Ok(finish(&app, loaded, EVENT_PINS_CHANGED))
}

#[tauri::command]
pub async fn pins_reorder<R: Runtime>(
    app: AppHandle<R>,
    paths: Vec<WirePath>,
) -> Result<Pins, WireError> {
    let store = app.state::<StoreState>().store()?;
    let loaded = blocking(move || store.pins_reorder(&paths)).await?;
    Ok(finish(&app, loaded, EVENT_PINS_CHANGED))
}

#[tauri::command]
pub async fn recents_get<R: Runtime>(app: AppHandle<R>) -> Result<Recents, WireError> {
    let store = app.state::<StoreState>().store()?;
    let loaded = blocking(move || store.recents_get()).await?;
    Ok(finish(&app, loaded, EVENT_RECENTS_CHANGED))
}

#[tauri::command]
pub async fn recent_touch<R: Runtime>(
    app: AppHandle<R>,
    path: WirePath,
) -> Result<Recents, WireError> {
    let store = app.state::<StoreState>().store()?;
    let loaded = blocking(move || store.recent_touch(&path)).await?;
    Ok(finish(&app, loaded, EVENT_RECENTS_CHANGED))
}

#[tauri::command]
pub async fn prune<R: Runtime>(app: AppHandle<R>) -> Result<PruneReport, WireError> {
    let store = app.state::<StoreState>().store()?;
    let report = blocking(move || store.prune()).await?;
    announce_corrupt(&app, &report.corrupt);
    let reset = report.corrupt.iter().any(|r| r.moved_to.is_some());
    if reset || !report.pins_removed.is_empty() {
        let _ = app.emit(EVENT_PINS_CHANGED, &report.pins);
    }
    if reset || !report.recents_removed.is_empty() {
        let _ = app.emit(EVENT_RECENTS_CHANGED, &report.recents);
    }
    Ok(report)
}

/// Hands over, once, the corrupt-file reports found since the last call.
#[tauri::command]
pub fn store_errors_take<R: Runtime>(app: AppHandle<R>) -> Vec<CorruptReport> {
    std::mem::take(
        &mut *app
            .state::<StoreState>()
            .pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner),
    )
}
