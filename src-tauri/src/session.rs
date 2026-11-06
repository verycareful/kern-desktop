// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The windows open and their tabs, kept in `session.json` (`store.rs`) as
//! they change, and opened again after a restart or when the user asks.
//!
//! Every window but Settings reports its tabs with [`session_put`] whenever
//! they change: the main window and editor windows their tabs in order and
//! the one in front (an editor window also its folder), a document window its
//! document. The file is current at every moment, so a crash or a session
//! that ends without closing the windows leaves it as the windows were.
//!
//! A window that closes is dropped from the file, unless it is the last
//! window that would be kept (the main window, an editor or a document
//! window): closing every window one by one leaves the last one in the file.
//! While a restart waits for the windows to close (`restart.rs`) none is
//! dropped; a restart that does not happen drops the ones that did close
//! ([`forget_closed`]).
//!
//! At this process's own launch, [`launch`] decides. A process started by
//! Restart Kern opens the windows of the file again with their labels, so each
//! also comes back where it was (the window-state plugin keys by label): the
//! main window first, then the editor windows, then the document windows, each
//! by its number. Any other launch opens nothing again: it sets the file aside
//! as `closed-session.json`, the windows of the last run, which the main
//! window offers to open ([`session_closed_get`], [`session_restore_closed`],
//! [`session_closed_dismiss`]). Opened from there, a window whose label this
//! run has taken gets the next free one, an editor window whose folder is open
//! in one now gives its tabs to that one, and the main window's tabs go to the
//! main window that is open. A path that is gone still gets its tab, which says
//! why it cannot show it. A launch forwarded from a second `kern` does neither.

use std::cmp::Ordering;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::{Mutex, MutexGuard, PoisonError};

use kernkraft_tauri::{KernkraftExt, WireError, WirePath};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::store::{LayoutKind, SessionTab, SessionWindow, Store};
use crate::store_cmds::{announce_corrupt, StoreState};
use crate::windows::MAIN;
use crate::windows::{self, blocking, show_errors, window_kind, wire_error, Directive, WindowKind};

/// The labels of windows that have closed and not opened again: a report
/// still on its way from such a window is not kept. Held across the write of
/// a report and across the decision made when a window closes, so the two
/// cannot interleave.
#[derive(Default)]
pub struct SessionGate {
    closed: Mutex<HashSet<String>>,
}

impl SessionGate {
    fn lock(&self) -> MutexGuard<'_, HashSet<String>> {
        // The set only filters late reports; a poisoned lock holds a whole set.
        self.closed.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Whether a window of this kind is kept in the session.
fn kept(kind: Option<WindowKind>) -> bool {
    matches!(
        kind,
        Some(WindowKind::Main | WindowKind::Editor | WindowKind::Document)
    )
}

fn store<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store>, WireError> {
    app.try_state::<StoreState>()
        .ok_or_else(|| wire_error("Internal", "the store is not set up", None))?
        .store()
}

fn gate<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::State<'_, SessionGate>, WireError> {
    app.try_state::<SessionGate>()
        .ok_or_else(|| wire_error("Internal", "the session is not set up", None))
}

/// Window `label` is about to be built: reports from it are kept again.
pub(crate) fn opening<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(g) = app.try_state::<SessionGate>() {
        g.lock().remove(label);
    }
}

/// The tabs of window `label` as the session keeps them, or why it cannot:
/// the main window has no folder, an editor window has one, a document window
/// shows one document at most and nothing else.
fn check_kind(
    label: &str,
    root: &Option<WirePath>,
    tabs: &[SessionTab],
) -> Result<WindowKind, String> {
    let kind = window_kind(label).filter(|k| kept(Some(*k)));
    match (kind, root) {
        (None, _) => Err(format!("window {label} is not one Kern keeps")),
        (Some(WindowKind::Main), Some(_)) => Err("the main window has no folder".to_owned()),
        (Some(WindowKind::Editor), None) => Err(format!("editor window {label} has no folder")),
        (Some(WindowKind::Document), _)
            if tabs.len() > 1 || tabs.iter().any(|t| !matches!(t, SessionTab::Doc { .. })) =>
        {
            Err(format!(
                "document window {label} shows one document and nothing else"
            ))
        }
        (Some(k), _) => Ok(k),
    }
}

/// Keeps the calling window's tabs: `tabs` in order, `active` the index of
/// the one in front, `root` an editor window's folder. Settings and windows
/// Kern does not make are refused; a report from a window that has closed is
/// dropped.
#[tauri::command]
pub async fn session_put<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    root: Option<WirePath>,
    tabs: Vec<SessionTab>,
    active: Option<usize>,
) -> Result<(), WireError> {
    let label = window.label().to_owned();
    check_kind(&label, &root, &tabs).map_err(|e| wire_error("Denied", e, None))?;
    let store = store(&app)?;
    let entry = SessionWindow {
        label,
        root,
        tabs,
        active,
    };
    blocking(move || {
        let g = gate(&app)?;
        let closed = g.lock();
        if closed.contains(&entry.label) {
            return Ok(());
        }
        let loaded = store.session_put(entry)?;
        drop(closed);
        announce_corrupt(&app, &loaded.corrupt);
        Ok(())
    })
    .await
}

/// The windows open or being built, less those that have closed.
fn open_labels<'a, R: Runtime>(
    app: &AppHandle<R>,
    closed: &'a HashSet<String>,
) -> impl Iterator<Item = String> + 'a {
    app.webview_windows()
        .into_keys()
        .chain(windows::creating_labels(app))
        .filter(move |l| !closed.contains(l))
}

/// Window `label` is gone. It is dropped from the session unless it is the
/// last window kept there, or a restart is waiting for the windows to close.
/// The write runs on the blocking pool; one that fails is said in a window
/// that is still open, else on standard error.
pub fn window_gone<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let Some(g) = app.try_state::<SessionGate>() else {
        return;
    };
    let others = {
        let mut closed = g.lock();
        closed.insert(label.to_owned());
        // A window still listed while it is being torn down is not another window.
        let any = open_labels(app, &closed).any(|l| kept(window_kind(&l)));
        any
    };
    if !kept(window_kind(label)) || crate::restart::pending(app) || !others {
        return;
    }
    let app = app.clone();
    let label = label.to_owned();
    tauri::async_runtime::spawn(async move {
        let result = match store(&app) {
            Ok(store) => {
                let app2 = app.clone();
                let label = label.clone();
                blocking(move || {
                    let g = gate(&app2)?;
                    let _closed = g.lock();
                    store.session_retain(|l| l != label).map(drop)
                })
                .await
            }
            Err(e) => Err(e),
        };
        if let Err(e) = result {
            say(&app, &e);
        }
    });
}

/// A restart that waited for the windows did not happen: the windows that
/// closed meanwhile are dropped from the session.
pub fn forget_closed<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = match store(&app) {
            Ok(store) => {
                let app2 = app.clone();
                blocking(move || {
                    let g = gate(&app2)?;
                    let closed = g.lock();
                    let open: HashSet<String> = open_labels(&app2, &closed).collect();
                    store.session_retain(|l| open.contains(l)).map(drop)
                })
                .await
            }
            Err(e) => Err(e),
        };
        if let Err(e) = result {
            say(&app, &e);
        }
    });
}

/// Says a session error in `main` when some Kern window is open (it is
/// created only then), else on standard error.
fn say<R: Runtime>(app: &AppHandle<R>, e: &WireError) {
    if app.webview_windows().keys().any(|l| kept(window_kind(l))) {
        show_errors(app, std::slice::from_ref(e), "");
    } else {
        eprintln!("kern: keeping the open windows failed: {e:?}");
    }
}

/// The order windows are opened in: main, editors, documents, each by number.
fn restore_order(a: &SessionWindow, b: &SessionWindow) -> Ordering {
    let rank = |w: &SessionWindow| -> (u8, u64) {
        let n = |prefix: &str| {
            w.label
                .strip_prefix(prefix)
                .and_then(|n| n.parse::<u64>().ok())
                .unwrap_or(u64::MAX)
        };
        match window_kind(&w.label) {
            Some(WindowKind::Main) => (0, 0),
            Some(WindowKind::Editor) => (1, n("editor-")),
            Some(WindowKind::Document) => (2, n("doc-")),
            _ => (3, 0),
        }
    };
    rank(a).cmp(&rank(b))
}

/// The main window's tabs in the editor layout, which holds no folder tabs.
/// The tab in front stays in front when it is kept; otherwise none is named.
pub fn without_folder_tabs(
    tabs: Vec<SessionTab>,
    active: Option<usize>,
) -> (Vec<SessionTab>, Option<usize>) {
    let mut kept_active = None;
    let mut out = Vec::new();
    for (i, t) in tabs.into_iter().enumerate() {
        if matches!(t, SessionTab::Folder { .. }) {
            continue;
        }
        if active == Some(i) {
            kept_active = Some(out.len());
        }
        out.push(t);
    }
    (out, kept_active)
}

/// Opens window `w` again and tells it what it showed. Returns the label of
/// the window that took it.
async fn restore_window<R: Runtime>(
    app: &AppHandle<R>,
    w: SessionWindow,
    layout: LayoutKind,
) -> Result<String, WireError> {
    let kind = check_kind(&w.label, &w.root, &w.tabs)
        .map_err(|e| wire_error("Restore", format!("not opened again: {e}"), None))?;
    match kind {
        WindowKind::Main => {
            windows::ensure_main(app)?;
            let (tabs, active) = if layout == LayoutKind::Editor {
                without_folder_tabs(w.tabs, w.active)
            } else {
                (w.tabs, w.active)
            };
            windows::send_directive(app, MAIN, &Directive::Restore { tabs, active })?;
            Ok(MAIN.to_owned())
        }
        WindowKind::Editor => {
            let Some(root) = w.root else {
                return Err(wire_error(
                    "Internal",
                    "an editor window with no folder",
                    None,
                ));
            };
            let (label, new) = windows::build_restored_editor(app, &w.label, &root).await?;
            if new {
                windows::send_directive(app, &label, &Directive::EditorRoot { path: root })?;
            }
            windows::send_directive(
                app,
                &label,
                &Directive::Restore {
                    tabs: w.tabs,
                    active: w.active,
                },
            )?;
            Ok(label)
        }
        WindowKind::Document => {
            let Some(SessionTab::Doc { path }) = w.tabs.into_iter().next() else {
                return Err(wire_error("Restore", "it showed no document", None));
            };
            let label = windows::build_restored_doc(app, &w.label)?;
            windows::send_directive(
                app,
                &label,
                &Directive::LoadDoc {
                    path,
                    text_state: None,
                    ack: false,
                },
            )?;
            Ok(label)
        }
        WindowKind::Settings => Err(wire_error("Internal", "Settings is not kept", None)),
    }
}

/// Opens `windows` again in order (main, editors, documents) and returns the
/// label of the first that opened. A window that cannot be opened is in
/// `errors`, its label in `failed`.
async fn restore_windows<R: Runtime>(
    app: &AppHandle<R>,
    store: &Arc<Store>,
    mut windows: Vec<SessionWindow>,
    errors: &mut Vec<WireError>,
    failed: &mut Vec<String>,
) -> Result<Option<String>, WireError> {
    let s = store.clone();
    let settings = blocking(move || s.settings_get()).await?;
    announce_corrupt(app, &settings.corrupt);
    windows.sort_by(restore_order);
    let mut first = None;
    for w in windows {
        let saved = w.label.clone();
        match restore_window(app, w, settings.value.default_layout).await {
            Ok(label) => {
                first.get_or_insert(label);
            }
            Err(mut e) => {
                e.message = format!("window {saved} was not opened again: {}", e.message);
                errors.push(e);
                failed.push(saved);
            }
        }
    }
    Ok(first)
}

/// This process's own launch. Started by Restart Kern (`restarted`), the
/// windows of the last run open again, the older closed set goes, and the
/// label of the first window opened is returned; a window that cannot be
/// opened is dropped and said in `main`. Any other launch sets the last run's
/// windows aside and opens nothing. A problem is said in `main`.
pub async fn launch<R: Runtime>(app: &AppHandle<R>, restarted: bool) -> Option<String> {
    let mut errors = Vec::new();
    let first = match launch_with(app, restarted, &mut errors).await {
        Ok(first) => first,
        Err(e) => {
            errors.push(e);
            None
        }
    };
    if !errors.is_empty() {
        show_errors(app, &errors, "");
    }
    first
}

async fn launch_with<R: Runtime>(
    app: &AppHandle<R>,
    restarted: bool,
    errors: &mut Vec<WireError>,
) -> Result<Option<String>, WireError> {
    let store = store(app)?;
    if !restarted {
        let s = store.clone();
        blocking(move || s.session_set_aside()).await?;
        return Ok(None);
    }
    let s = store.clone();
    blocking(move || s.closed_clear()).await?;
    let s = store.clone();
    let loaded = blocking(move || s.session_get()).await?;
    announce_corrupt(app, &loaded.corrupt);
    let mut failed = Vec::new();
    let first = restore_windows(app, &store, loaded.value.windows, errors, &mut failed).await?;
    if !failed.is_empty() {
        blocking(move || store.session_retain(|l| !failed.iter().any(|d| d == l))).await?;
    }
    Ok(first)
}

/// Refuses a call from any window but the main one, which offers the closed set.
fn main_only<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), WireError> {
    if window.label() == MAIN {
        Ok(())
    } else {
        Err(wire_error(
            "Denied",
            "only the main window offers the windows of the last run",
            None,
        ))
    }
}

/// The folder a fresh main window opens: the new tab folder of the settings,
/// or Home when none is set (kernkraft's user dirs, as the frontend has it).
async fn start_folder<R: Runtime>(
    app: &AppHandle<R>,
    store: &Arc<Store>,
) -> Result<PathBuf, WireError> {
    let s = store.clone();
    let settings = blocking(move || s.settings_get()).await?;
    announce_corrupt(app, &settings.corrupt);
    let folder = match settings.value.new_tab_folder {
        Some(folder) => folder,
        None => {
            let app = app.clone();
            blocking(move || app.kernkraft().user_dirs()).await?.home
        }
    };
    Ok(folder.to_path_buf()?)
}

/// Whether two stored paths name one folder: equal as given, or after links
/// are followed. A path that cannot be resolved is compared as given.
fn same_folder(a: &Path, b: &Path) -> bool {
    a == b
        || matches!(
            (std::fs::canonicalize(a), std::fs::canonicalize(b)),
            (Ok(x), Ok(y)) if x == y
        )
}

/// The windows of the last run worth opening again: those Kern can open,
/// less a main window that shows only `start`, which a launch opens anyway.
fn worth_opening(windows: Vec<SessionWindow>, start: &Path) -> Vec<SessionWindow> {
    windows
        .into_iter()
        .filter(|w| check_kind(&w.label, &w.root, &w.tabs).is_ok())
        .filter(|w| {
            let only_start = w.label == MAIN
                && matches!(
                    w.tabs.as_slice(),
                    [SessionTab::Folder { path }]
                        if path.to_path_buf().is_ok_and(|p| same_folder(&p, start))
                );
            !only_start
        })
        .collect()
}

/// The windows of the last run worth opening again (see [`worth_opening`]).
async fn closed_worth_opening<R: Runtime>(
    app: &AppHandle<R>,
    store: &Arc<Store>,
) -> Result<Vec<SessionWindow>, WireError> {
    let s = store.clone();
    let loaded = blocking(move || s.closed_get()).await?;
    announce_corrupt(app, &loaded.corrupt);
    if loaded.value.windows.is_empty() {
        return Ok(Vec::new());
    }
    let start = start_folder(app, store).await?;
    blocking(move || Ok(worth_opening(loaded.value.windows, &start))).await
}

/// How many windows of the last run are worth opening again; 0 when there
/// are none, also when the last run left only a main window showing the folder
/// a launch opens.
#[tauri::command]
pub async fn session_closed_get<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<usize, WireError> {
    main_only(&window)?;
    let store = store(&app)?;
    Ok(closed_worth_opening(&app, &store).await?.len())
}

/// Opens the windows of the last run again and drops the set. A window that
/// cannot be opened is said in `main`, with the others opened all the same.
#[tauri::command]
pub async fn session_restore_closed<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), WireError> {
    main_only(&window)?;
    let store = store(&app)?;
    let windows = closed_worth_opening(&app, &store).await?;
    if windows.is_empty() {
        return Err(wire_error(
            "NothingToRestore",
            "there are no windows from last time to open",
            None,
        ));
    }
    let mut errors = Vec::new();
    let mut failed = Vec::new();
    restore_windows(&app, &store, windows, &mut errors, &mut failed).await?;
    blocking(move || store.closed_clear()).await?;
    if !errors.is_empty() {
        show_errors(&app, &errors, "");
    }
    Ok(())
}

/// Drops the windows of the last run unopened.
#[tauri::command]
pub async fn session_closed_dismiss<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), WireError> {
    main_only(&window)?;
    let store = store(&app)?;
    blocking(move || store.closed_clear()).await
}

/// The state [`launch`] and the commands need, beside the window state.
pub fn manage<R: Runtime>(app: &AppHandle<R>) {
    app.manage(SessionGate::default());
}
