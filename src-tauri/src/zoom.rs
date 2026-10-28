// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The interface size as webview zoom (design 7.2).
//!
//! `interface_size` (percent, see `store.rs`) zooms every Kern window alike:
//! the stored value is applied when the settings are read at startup and
//! whenever they change, and to each webview as it is created and as its
//! page loads, so a window opened later starts at the same size. The zoom is
//! set from here with Tauri's `Webview::set_zoom`; the frontend needs no
//! permission for it. Density and the editor's text zoom are separate.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::plugin::{Builder, TauriPlugin};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Runtime, Webview};

use crate::store::DEFAULT_INTERFACE_SIZE;

/// What the windows are zoomed to, and what each was last set to.
struct InterfaceZoom {
    percent: AtomicU32,
    /// The factor last set on each webview, by label; [`forget`] drops a closed window.
    applied: Mutex<BTreeMap<String, f64>>,
}

impl InterfaceZoom {
    fn lock(&self) -> MutexGuard<'_, BTreeMap<String, f64>> {
        self.applied.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The zoom factor for a size in percent.
pub fn factor(percent: u32) -> f64 {
    f64::from(percent) / 100.0
}

/// The size the windows are zoomed to, in percent.
pub fn current<R: Runtime>(app: &AppHandle<R>) -> u32 {
    app.state::<InterfaceZoom>().percent.load(Ordering::Relaxed)
}

/// The factor last set on each webview, by label.
pub fn applied<R: Runtime>(app: &AppHandle<R>) -> BTreeMap<String, f64> {
    app.state::<InterfaceZoom>().lock().clone()
}

fn set<R: Runtime>(state: &InterfaceZoom, webview: &Webview<R>) {
    let f = factor(state.percent.load(Ordering::Relaxed));
    match webview.set_zoom(f) {
        Ok(()) => {
            state.lock().insert(webview.label().to_owned(), f);
        }
        // No window can show it and there is no log; stderr is what a
        // terminal launch or the journal shows.
        Err(e) => eprintln!("kern: zooming {} failed: {e}", webview.label()),
    }
}

/// Makes `percent` the interface size and zooms every open window to it.
pub fn apply<R: Runtime>(app: &AppHandle<R>, percent: u32) {
    let state = app.state::<InterfaceZoom>();
    state.percent.store(percent, Ordering::Relaxed);
    for window in app.webview_windows().values() {
        set(&state, window.as_ref());
    }
}

/// A window has closed: its zoom is no longer tracked.
pub fn forget<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(state) = app.try_state::<InterfaceZoom>() {
        state.lock().remove(label);
    }
}

/// The plugin that keeps new windows at the interface size. Register it
/// before the first window is created.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("kern-zoom")
        .setup(|app, _| {
            app.manage(InterfaceZoom {
                percent: AtomicU32::new(DEFAULT_INTERFACE_SIZE),
                applied: Mutex::new(BTreeMap::new()),
            });
            Ok(())
        })
        .on_webview_ready(|webview| set(&webview.state::<InterfaceZoom>(), &webview))
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                set(&webview.state::<InterfaceZoom>(), webview);
            }
        })
        .build()
}
