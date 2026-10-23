// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Windows, the open rules applied, and what the frontend is told.
//!
//! Windows are `main` (browsing, created on demand) and `doc-<n>`
//! (standalone documents, design D4.4). Directives for a window go out as
//! events on [`EVENT_OPEN`] (and [`EVENT_ADOPT_DOC`]). A window that has not
//! yet asked for its backlog with `open_pending_take` has them queued, so a
//! directive sent while its page loads is not lost; once it has asked, they
//! are emitted.
//!
//! Closing: `CloseRequested` is always prevented and
//! [`EVENT_CLOSE_REQUESTED`] emitted; the window closes only when its
//! frontend calls `confirm_close` after its save / discard / cancel prompt
//! (parent spec 6.2). A frontend that never answers leaves the window open:
//! Kern does not force it, since that could discard unsaved text; the user
//! can still end the process.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use kernkraft_tauri::{KernkraftExt, WireError, WirePath};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
    WindowEvent,
};

use crate::cli::{self, ArgError, Plan};
use crate::open::{route_kind, Gesture, Location, OpenRegistry, Origin, Target};
use crate::store_cmds::StoreState;

pub const EVENT_OPEN: &str = "kern://open";
pub const EVENT_ADOPT_DOC: &str = "kern://adopt-doc";
pub const EVENT_ADOPT_CANCELLED: &str = "kern://adopt-cancelled";
pub const EVENT_OPEN_ERROR: &str = "kern://open-error";
pub const EVENT_CLOSE_REQUESTED: &str = "kern://close-requested";

pub const MAIN: &str = "main";
const DOC_PREFIX: &str = "doc-";

/// How long `move_doc_to_main` waits for `main` to acknowledge. A freshly
/// created window has to load the frontend and answer `open_pending_take`
/// first; 15 s is far beyond a healthy start and short enough that a stuck
/// window is reported while the user still remembers the click.
pub const ADOPT_TIMEOUT: Duration = Duration::from_secs(15);

/// Size of a standalone document window (my call, D4.4 gives none).
const DOC_SIZE: (f64, f64) = (900.0, 700.0);
const DOC_MIN_SIZE: (f64, f64) = (480.0, 320.0);

/// What a window is told to do, on [`EVENT_OPEN`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Directive {
    FolderTab {
        path: WirePath,
    },
    DocTab {
        path: WirePath,
    },
    /// For a `doc-<n>` window: load this document.
    LoadDoc {
        path: WirePath,
    },
    HomeTab,
    FocusTab {
        tab_id: String,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct Queued {
    pub event: String,
    pub payload: Value,
}

struct Inner {
    next_doc: u64,
    ready: HashSet<String>,
    pending: HashMap<String, Vec<Queued>>,
    adopting: HashMap<String, Sender<()>>,
}

/// Managed state of the window layer.
pub struct WindowState {
    pub open: OpenRegistry,
    inner: Mutex<Inner>,
    adopt_timeout: Duration,
}

impl Default for WindowState {
    fn default() -> Self {
        WindowState::new(ADOPT_TIMEOUT)
    }
}

impl WindowState {
    pub fn new(adopt_timeout: Duration) -> WindowState {
        WindowState {
            open: OpenRegistry::new(),
            inner: Mutex::new(Inner {
                next_doc: 1,
                ready: HashSet::new(),
                pending: HashMap::new(),
                adopting: HashMap::new(),
            }),
            adopt_timeout,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The next `doc-<n>` label. The counter only grows, so a label is never
/// reused, and `is_open` skips a label a window still holds.
pub fn next_doc_label(counter: &mut u64, is_open: impl Fn(&str) -> bool) -> String {
    loop {
        let label = format!("{DOC_PREFIX}{counter}");
        *counter += 1;
        if !is_open(&label) {
            return label;
        }
    }
}

pub fn wire_error(kind: &str, message: impl Into<String>, path: Option<&Path>) -> WireError {
    WireError {
        kind: kind.to_owned(),
        message: message.into(),
        path: path.map(WirePath::from),
        details: None,
    }
}

fn window_error(e: tauri::Error) -> WireError {
    wire_error("Window", format!("window operation failed: {e}"), None)
}

fn state<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::State<'_, WindowState>, WireError> {
    app.try_state::<WindowState>()
        .ok_or_else(|| wire_error("Internal", "window state is not managed", None))
}

/// Sends an event to window `label`, or queues it until that window has
/// asked for its backlog.
fn send<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    event: &str,
    payload: Value,
) -> Result<(), WireError> {
    let st = state(app)?;
    let mut inner = st.lock();
    if inner.ready.contains(label) {
        app.emit_to(label, event, payload).map_err(window_error)
    } else {
        inner
            .pending
            .entry(label.to_owned())
            .or_default()
            .push(Queued {
                event: event.to_owned(),
                payload,
            });
        Ok(())
    }
}

fn send_directive<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    d: &Directive,
) -> Result<(), WireError> {
    send(app, label, EVENT_OPEN, json!(d))
}

/// Brings window `label` to the front.
pub fn focus<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), WireError> {
    let w = app
        .get_webview_window(label)
        .ok_or_else(|| wire_error("NoWindow", format!("window {label} does not exist"), None))?;
    w.show().map_err(window_error)?;
    w.unminimize().map_err(window_error)?;
    w.set_focus().map_err(window_error)
}

/// Makes sure `main` exists. True when it was created now.
pub fn ensure_main<R: Runtime>(app: &AppHandle<R>) -> Result<bool, WireError> {
    if app.get_webview_window(MAIN).is_some() {
        return Ok(false);
    }
    let cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN)
        .ok_or_else(|| wire_error("Internal", "no window configured as main", None))?;
    WebviewWindowBuilder::from_config(app, cfg)
        .and_then(|b| b.build())
        .map_err(window_error)?;
    Ok(true)
}

fn new_doc_window<R: Runtime>(app: &AppHandle<R>) -> Result<String, WireError> {
    let st = state(app)?;
    let label = {
        let mut inner = st.lock();
        next_doc_label(&mut inner.next_doc, |l| app.get_webview_window(l).is_some())
    };
    WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title("Kern")
        .inner_size(DOC_SIZE.0, DOC_SIZE.1)
        .min_inner_size(DOC_MIN_SIZE.0, DOC_MIN_SIZE.1)
        .build()
        .map_err(window_error)?;
    Ok(label)
}

/// What happened to one path.
#[derive(Clone, Debug, Serialize)]
pub struct OpenOutcome {
    pub path: WirePath,
    /// `folder_tab`, `doc_tab`, `doc_window`, `focus`, `default_app` or
    /// `failed`.
    pub action: &'static str,
    pub location: Option<Location>,
    pub error: Option<WireError>,
}

impl OpenOutcome {
    fn failed(path: &Path, error: WireError) -> OpenOutcome {
        OpenOutcome {
            path: WirePath::from(path),
            action: "failed",
            location: None,
            error: Some(error),
        }
    }
}

fn io_error(path: &Path, e: &std::io::Error) -> WireError {
    let kind = match e.kind() {
        std::io::ErrorKind::NotFound => "NotFound",
        std::io::ErrorKind::PermissionDenied => "PermissionDenied",
        _ => "Io",
    };
    wire_error(kind, e.to_string(), Some(path))
}

async fn blocking<T, F>(f: F) -> Result<T, WireError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, WireError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| wire_error("Internal", format!("internal error: {e}"), None))?
}

/// Whether the editor can open `path` as text, decided by kernkraft.
async fn is_text<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<bool, WireError> {
    let kk = app.kernkraft();
    let wp = WirePath::from(path);
    Ok(blocking(move || kk.mime_of(wp)).await?.is_text)
}

async fn open_default_app<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), WireError> {
    let terminal = match app.try_state::<StoreState>() {
        Some(s) => {
            let store = s.store()?;
            blocking(move || store.settings_get()).await?.value.terminal
        }
        None => None,
    };
    let kk = app.kernkraft();
    let wp = WirePath::from(path);
    blocking(move || kk.open_default(vec![wp], terminal)).await
}

/// Applies the rules to `paths` and does what they say.
pub async fn open_paths_impl<R: Runtime>(
    app: &AppHandle<R>,
    paths: Vec<PathBuf>,
    origin: Origin,
    gesture: Gesture,
) -> Vec<OpenOutcome> {
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        out.push(open_one(app, &path, origin, gesture).await);
    }
    out
}

async fn open_one<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
    origin: Origin,
    gesture: Gesture,
) -> OpenOutcome {
    match try_open(app, path, origin, gesture).await {
        Ok(o) => o,
        Err(e) => OpenOutcome::failed(path, e),
    }
}

async fn try_open<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
    origin: Origin,
    gesture: Gesture,
) -> Result<OpenOutcome, WireError> {
    let st = state(app)?;
    // Twice at most: a registry entry whose window is gone is dropped and
    // the path routed afresh.
    for _ in 0..2 {
        let known = st.open.get(path).is_some();
        let (is_dir, text) = if known {
            (false, false)
        } else {
            // Follows links: a link to a folder is a folder.
            let meta = std::fs::metadata(path).map_err(|e| io_error(path, &e))?;
            let text = !meta.is_dir() && is_text(app, path).await?;
            (meta.is_dir(), text)
        };
        let target = route_kind(path, is_dir, origin, gesture, text, &st.open);
        let wp = WirePath::from(path);
        let outcome = |action, location| OpenOutcome {
            path: wp.clone(),
            action,
            location,
            error: None,
        };
        match target {
            Target::FolderTab(p) => {
                ensure_main(app)?;
                send_directive(
                    app,
                    MAIN,
                    &Directive::FolderTab {
                        path: WirePath::from(&p),
                    },
                )?;
                focus(app, MAIN)?;
                return Ok(outcome("folder_tab", None));
            }
            Target::DocTab(p) => {
                ensure_main(app)?;
                send_directive(
                    app,
                    MAIN,
                    &Directive::DocTab {
                        path: WirePath::from(&p),
                    },
                )?;
                focus(app, MAIN)?;
                return Ok(outcome("doc_tab", None));
            }
            Target::DocWindow(p) => {
                let label = new_doc_window(app)?;
                let loc = Location::Window {
                    label: label.clone(),
                };
                // Registered at once so a second open of the file, before
                // the window has loaded, focuses this one.
                st.open.insert(&p, loc.clone());
                send_directive(
                    app,
                    &label,
                    &Directive::LoadDoc {
                        path: WirePath::from(&p),
                    },
                )?;
                return Ok(outcome("doc_window", Some(loc)));
            }
            Target::Focus(loc) => {
                let label = match &loc {
                    Location::Tab { tab_id } => {
                        if app.get_webview_window(MAIN).is_some() {
                            send_directive(
                                app,
                                MAIN,
                                &Directive::FocusTab {
                                    tab_id: tab_id.clone(),
                                },
                            )?;
                        }
                        MAIN
                    }
                    Location::Window { label } => label,
                };
                if app.get_webview_window(label).is_none() {
                    st.open.remove(path);
                    continue;
                }
                focus(app, label)?;
                return Ok(outcome("focus", Some(loc)));
            }
            Target::DefaultApp(p) => {
                open_default_app(app, &p).await?;
                return Ok(outcome("default_app", None));
            }
        }
    }
    Err(wire_error(
        "Internal",
        "the open registry kept naming a window that does not exist",
        Some(path),
    ))
}

/// `main` with a Home folder tab, or just raised when it exists.
pub fn open_home<R: Runtime>(app: &AppHandle<R>) -> Result<(), WireError> {
    if ensure_main(app)? {
        send_directive(app, MAIN, &Directive::HomeTab)?;
    }
    focus(app, MAIN)
}

fn arg_error(e: &ArgError) -> WireError {
    wire_error("BadArgument", e.to_string(), None)
}

/// Handles a launch from outside: this process's own first launch, or one
/// forwarded by a second launch. Errors cannot be returned to anyone, so
/// they are shown in `main` (created if need be) as [`EVENT_OPEN_ERROR`].
pub async fn handle_launch<R: Runtime>(app: &AppHandle<R>, argv: Vec<OsString>, cwd: PathBuf) {
    let errors = match cli::plan(&argv, &cwd) {
        Plan::Home => open_home(app).err().into_iter().collect::<Vec<_>>(),
        Plan::Open(parsed) => {
            let mut errors: Vec<WireError> = parsed.errors.iter().map(arg_error).collect();
            let outcomes =
                open_paths_impl(app, parsed.paths, Origin::Outside, Gesture::Default).await;
            errors.extend(outcomes.into_iter().filter_map(|o| o.error));
            errors
        }
    };
    if errors.is_empty() {
        return;
    }
    let shown = ensure_main(app).and_then(|_| {
        for e in &errors {
            send(app, MAIN, EVENT_OPEN_ERROR, json!(e))?;
        }
        focus(app, MAIN)
    });
    if let Err(e) = shown {
        eprintln!("kern: could not show open errors ({e:?}); they were:");
        for err in &errors {
            eprintln!("kern: {}: {}", err.kind, err.message);
        }
    }
}

// ---- commands ----

#[tauri::command]
pub async fn open_paths<R: Runtime>(
    app: AppHandle<R>,
    paths: Vec<WirePath>,
    origin: Origin,
    gesture: Gesture,
) -> Result<Vec<OpenOutcome>, WireError> {
    let mut out = Vec::with_capacity(paths.len());
    for wp in paths {
        match wp.to_path_buf() {
            Ok(p) => out.push(open_one(&app, &p, origin, gesture).await),
            Err(e) => out.push(OpenOutcome {
                path: wp,
                action: "failed",
                location: None,
                error: Some(WireError::from(e)),
            }),
        }
    }
    Ok(out)
}

/// The frontend opened `path` at `location`.
#[tauri::command]
pub fn doc_opened<R: Runtime>(
    app: AppHandle<R>,
    path: WirePath,
    location: Location,
) -> Result<(), WireError> {
    let p = path.to_path_buf()?;
    state(&app)?.open.insert(&p, location);
    Ok(())
}

#[tauri::command]
pub fn doc_closed<R: Runtime>(app: AppHandle<R>, path: WirePath) -> Result<(), WireError> {
    let p = path.to_path_buf()?;
    state(&app)?.open.remove(&p);
    Ok(())
}

/// Hands over, once, what was queued for the calling window, and from then
/// on sends to it directly.
#[tauri::command]
pub fn open_pending_take<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Vec<Queued>, WireError> {
    let st = state(&app)?;
    let mut inner = st.lock();
    inner.ready.insert(window.label().to_owned());
    Ok(inner.pending.remove(window.label()).unwrap_or_default())
}

/// Detaches a document tab of `main` into its own window (D4.5).
#[tauri::command]
pub fn detach_doc<R: Runtime>(
    app: AppHandle<R>,
    tab_id: String,
    path: WirePath,
) -> Result<String, WireError> {
    let p = path.to_path_buf()?;
    let st = state(&app)?;
    match st.open.get(&p) {
        Some(Location::Window { label }) => {
            return Err(wire_error(
                "AlreadyOpen",
                format!("the document is already open in window {label}"),
                Some(&p),
            ));
        }
        Some(Location::Tab { tab_id: registered }) if registered != tab_id => {
            return Err(wire_error(
                "TabMismatch",
                format!("the document is open in tab {registered}, not {tab_id}"),
                Some(&p),
            ));
        }
        _ => {}
    }
    let label = new_doc_window(&app)?;
    // The window takes the registration over from the tab now.
    st.open.insert(
        &p,
        Location::Window {
            label: label.clone(),
        },
    );
    send_directive(&app, &label, &Directive::LoadDoc { path })?;
    Ok(label)
}

/// Home button of a standalone window (D4.4): the document moves into a tab
/// of `main`, creating `main` with a Home folder tab if absent. `text_state`
/// is the window's editor state, passed through untouched. The window closes
/// only after `main` answers with `adopted(label)`; if that does not come
/// within the timeout the window stays open, `main` is told to drop the tab
/// ([`EVENT_ADOPT_CANCELLED`]) and the error is returned.
#[tauri::command]
pub async fn move_doc_to_main<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    text_state: Option<Value>,
) -> Result<(), WireError> {
    let st = state(&app)?;
    let Some(path) = st.open.path_of_window(&label) else {
        return Err(wire_error(
            "NoDocument",
            format!("window {label} holds no registered document"),
            None,
        ));
    };
    let doc = app
        .get_webview_window(&label)
        .ok_or_else(|| wire_error("NoWindow", format!("window {label} does not exist"), None))?;
    if ensure_main(&app)? {
        send_directive(&app, MAIN, &Directive::HomeTab)?;
    }
    let (tx, rx) = mpsc::channel();
    st.lock().adopting.insert(label.clone(), tx);
    let sent = send(
        &app,
        MAIN,
        EVENT_ADOPT_DOC,
        json!({ "path": WirePath::from(path.as_path()), "text_state": text_state, "from": label }),
    );
    if let Err(e) = sent {
        st.lock().adopting.remove(&label);
        return Err(e);
    }
    focus(&app, MAIN)?;
    let timeout = st.adopt_timeout;
    let acked = blocking(move || Ok(rx.recv_timeout(timeout).is_ok())).await?;
    st.lock().adopting.remove(&label);
    if !acked {
        let _ = send(&app, MAIN, EVENT_ADOPT_CANCELLED, json!({ "label": label }));
        return Err(wire_error(
            "AdoptTimeout",
            "the main window did not take the document; it stays open here",
            Some(&path),
        ));
    }
    doc.destroy().map_err(window_error)
}

/// `main` took the document of window `label` (see `move_doc_to_main`). It
/// registers the new tab with `doc_opened` first.
#[tauri::command]
pub fn adopted<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    label: String,
) -> Result<(), WireError> {
    if window.label() != MAIN {
        return Err(wire_error("Denied", "only the main window adopts", None));
    }
    let tx = state(&app)?.lock().adopting.remove(&label);
    match tx {
        Some(tx) => {
            let _ = tx.send(());
            Ok(())
        }
        None => Err(wire_error(
            "NoAdoption",
            format!("no move from window {label} is waiting; drop the tab"),
            None,
        )),
    }
}

/// The frontend finished its save / discard / cancel prompt and the window
/// should go.
#[tauri::command]
pub fn confirm_close<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), WireError> {
    let w = app
        .get_webview_window(&label)
        .ok_or_else(|| wire_error("NoWindow", format!("window {label} does not exist"), None))?;
    w.destroy().map_err(window_error)
}

/// Tells the window's frontend that the user asked to close it.
pub fn ask_to_close<R: Runtime>(window: &Window<R>) {
    if let Err(e) = window.emit_to(window.label(), EVENT_CLOSE_REQUESTED, ()) {
        eprintln!("kern: could not ask {} to close: {e}", window.label());
    }
}

/// Window events: close goes through the frontend's prompt, and a window
/// that is gone is forgotten.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            ask_to_close(window);
        }
        WindowEvent::Destroyed => {
            let app = window.app_handle();
            if let Some(st) = app.try_state::<WindowState>() {
                if window.label() == MAIN {
                    st.open.remove_tabs();
                }
                st.open.remove_window(window.label());
                let mut inner = st.lock();
                inner.ready.remove(window.label());
                inner.pending.remove(window.label());
            }
        }
        _ => {}
    }
}

/// Starts the thread that applies launches forwarded to this instance.
pub fn serve_launches<R: Runtime>(
    app: AppHandle<R>,
    launches: std::sync::mpsc::Receiver<crate::instance::Invocation>,
) {
    std::thread::spawn(move || {
        for inv in launches {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                handle_launch(&app, inv.argv, inv.cwd).await;
            });
        }
    });
}
