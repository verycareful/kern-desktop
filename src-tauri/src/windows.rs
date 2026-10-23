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
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use kernkraft_tauri::{KernkraftExt, WireError, WirePath};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{
    webview::{PageLoadEvent, PageLoadPayload},
    AppHandle, Emitter, Manager, Runtime, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent,
};

use crate::cli::{self, ArgError, Plan};
use crate::instance::{exit_when_drained, Launches};
use crate::open::{route, Gesture, Kind, Location, OpenRegistry, Origin, Target};
use crate::store_cmds::StoreState;

pub const EVENT_OPEN: &str = "kern://open";
pub const EVENT_ADOPT_DOC: &str = "kern://adopt-doc";
pub const EVENT_ADOPT_CANCELLED: &str = "kern://adopt-cancelled";
pub const EVENT_OPEN_ERROR: &str = "kern://open-error";
pub const EVENT_CLOSE_REQUESTED: &str = "kern://close-requested";
/// Select items in the folder tab of a folder: `{ tab, paths }`, with `tab`
/// the folder's path and `paths` the items in it. Sent to `main` after the
/// directive that opens the folder, so a window still loading receives them
/// in that order.
pub const EVENT_SELECT: &str = "kern://select";
/// Show the Properties of items: `{ paths }`, sent to `main`.
pub const EVENT_PROPERTIES: &str = "kern://properties";

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
    /// Labels reserved whose window is still being built, with the latest
    /// activation token of a launch that landed on them.
    creating: HashMap<String, String>,
}

/// Managed state of the window layer.
pub struct WindowState {
    pub open: OpenRegistry,
    inner: Mutex<Inner>,
    /// Held while a path is checked against the registry and reserved, so
    /// two launches of one file cannot both make a window (D4.5).
    ///
    /// Rule: nothing under the gate creates a window or waits for the main
    /// thread. Window creation blocks its caller until the main thread has
    /// built the window, and a command running on the main thread may be
    /// waiting for this gate. The gate covers the registry check and the
    /// reservation (label, registry entry) only; the window is built after
    /// it is released, and the reservation is confirmed or rolled back.
    gate: Mutex<()>,
    adopt_timeout: Duration,
    /// Whether focusing goes through GTK (startup id, present). Off only in
    /// tests, whose mock runtime has no GTK window.
    toolkit_focus: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        WindowState::new(ADOPT_TIMEOUT).with_toolkit_focus()
    }
}

impl WindowState {
    /// State that focuses windows with Tauri's own calls only.
    pub fn new(adopt_timeout: Duration) -> WindowState {
        WindowState {
            gate: Mutex::new(()),
            toolkit_focus: false,
            open: OpenRegistry::new(),
            inner: Mutex::new(Inner {
                next_doc: 1,
                ready: HashSet::new(),
                pending: HashMap::new(),
                adopting: HashMap::new(),
                creating: HashMap::new(),
            }),
            adopt_timeout,
        }
    }

    /// Focus through GTK, so an activation token is honoured.
    pub fn with_toolkit_focus(mut self) -> WindowState {
        self.toolkit_focus = true;
        self
    }

    fn lock_gate(&self) -> MutexGuard<'_, ()> {
        self.gate.lock().unwrap_or_else(PoisonError::into_inner)
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
pub(crate) fn send<R: Runtime>(
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

/// Brings window `label` to the front. `token` is the xdg-activation token
/// the launcher passed (empty if none): GTK is given it as the startup id
/// before the window is presented, so the compositor allows the focus.
pub fn focus<R: Runtime>(app: &AppHandle<R>, label: &str, token: &str) -> Result<(), WireError> {
    let w = app
        .get_webview_window(label)
        .ok_or_else(|| wire_error("NoWindow", format!("window {label} does not exist"), None))?;
    w.show().map_err(window_error)?;
    w.unminimize().map_err(window_error)?;
    w.set_focus().map_err(window_error)?;
    if !state(app)?.toolkit_focus {
        return Ok(());
    }
    let token = token.to_owned();
    let target = w.clone();
    app.run_on_main_thread(move || {
        use gtk::prelude::GtkWindowExt;
        match target.gtk_window() {
            Ok(g) => {
                if !token.is_empty() {
                    g.set_startup_id(&token);
                }
                g.present();
            }
            Err(e) => eprintln!("kern: could not present {}: {e}", target.label()),
        }
    })
    .map_err(window_error)
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

/// Reserves the next `doc-<n>` label. The label is marked as being built
/// until [`built`] is called for it; `token` is the activation token of the
/// launch that asked.
fn reserve_doc_label<R: Runtime>(app: &AppHandle<R>, st: &WindowState, token: &str) -> String {
    let mut inner = st.lock();
    let label = next_doc_label(&mut inner.next_doc, |l| app.get_webview_window(l).is_some());
    inner.creating.insert(label.clone(), token.to_owned());
    label
}

/// The reserved window `label` is built or has failed to be. Returns the
/// activation token to present it with: the latest one of any launch that
/// landed on it while it was being built.
fn built(st: &WindowState, label: &str) -> String {
    st.lock().creating.remove(label).unwrap_or_default()
}

/// Builds the window for a reserved label. Never call with the gate held.
fn build_doc_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), WireError> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Kern")
        .inner_size(DOC_SIZE.0, DOC_SIZE.1)
        .min_inner_size(DOC_MIN_SIZE.0, DOC_MIN_SIZE.1)
        .build()
        .map(|_| ())
        .map_err(window_error)
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

pub(crate) fn io_error(path: &Path, e: &std::io::Error) -> WireError {
    let kind = match e.kind() {
        std::io::ErrorKind::NotFound => "NotFound",
        std::io::ErrorKind::PermissionDenied => "PermissionDenied",
        _ => "Io",
    };
    wire_error(kind, e.to_string(), Some(path))
}

pub(crate) async fn blocking<T, F>(f: F) -> Result<T, WireError>
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

/// Opens `files` with their default applications in one kernkraft
/// `open_default` call: one launch per application with all of its files,
/// and nothing opened when any file has no default application. `prelaunch`
/// follows the same rules for a launch that needs no window, so the same
/// arguments start the same launches with or without a running Kern.
async fn open_default_apps<R: Runtime>(
    app: &AppHandle<R>,
    files: Vec<PathBuf>,
) -> Result<(), WireError> {
    let terminal = match app.try_state::<StoreState>() {
        Some(s) => {
            let store = s.store()?;
            blocking(move || store.settings_get()).await?.value.terminal
        }
        None => None,
    };
    let kk = app.kernkraft();
    let wps = files.iter().map(|f| WirePath::from(f.as_path())).collect();
    blocking(move || kk.open_default(wps, terminal)).await
}

/// What a path is and which file it resolves to, or why that is unknown.
struct Resolved {
    canonical: Option<PathBuf>,
    kind: Result<Kind, WireError>,
}

async fn resolve<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Resolved {
    let canonical = std::fs::canonicalize(path).ok();
    // Follows links: a link to a folder is a folder.
    let kind = match std::fs::metadata(path) {
        Err(e) => Err(io_error(path, &e)),
        Ok(m) if m.is_dir() => Ok(Kind::Folder),
        Ok(_) => match is_text(app, path).await {
            Ok(true) => Ok(Kind::Text),
            Ok(false) => Ok(Kind::Other),
            Err(e) => Err(e),
        },
    };
    Resolved { canonical, kind }
}

/// Applies the rules to `paths` and does what they say, one outcome per
/// path in order. `token` is the activation token of the launch, empty for
/// a click inside Kern. The files for default applications are opened
/// together at the end (see [`open_default_apps`]); if that fails, each of
/// them carries the error.
pub async fn open_paths_impl<R: Runtime>(
    app: &AppHandle<R>,
    paths: Vec<PathBuf>,
    origin: Origin,
    gesture: Gesture,
    token: &str,
) -> Vec<OpenOutcome> {
    let mut out = Vec::with_capacity(paths.len());
    // Index in `out`, and the file to open.
    let mut defaults: Vec<(usize, PathBuf)> = Vec::new();
    for path in paths {
        match try_open(app, &path, origin, gesture, token).await {
            Ok(Step::Done(o)) => out.push(o),
            Ok(Step::DefaultApp(p)) => {
                defaults.push((out.len(), p));
                out.push(OpenOutcome {
                    path: WirePath::from(path.as_path()),
                    action: "default_app",
                    location: None,
                    error: None,
                });
            }
            Err(e) => out.push(OpenOutcome::failed(&path, e)),
        }
    }
    if defaults.is_empty() {
        return out;
    }
    let files = defaults.iter().map(|(_, p)| p.clone()).collect();
    if let Err(e) = open_default_apps(app, files).await {
        for (i, _) in &defaults {
            out[*i].action = "failed";
            out[*i].error = Some(e.clone());
        }
    }
    out
}

/// What a path is to be given, decided under the gate.
enum Placement {
    FolderTab(PathBuf),
    DocTab(PathBuf),
    /// A reserved label, already in the registry.
    NewDoc {
        path: PathBuf,
        label: String,
    },
    Focus(Location),
    DefaultApp(PathBuf),
}

enum Step {
    Done(OpenOutcome),
    DefaultApp(PathBuf),
}

async fn try_open<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
    origin: Origin,
    gesture: Gesture,
    token: &str,
) -> Result<Step, WireError> {
    // All file access happens before the registry is consulted. The check
    // and the reservation are one step under the gate; the window is built
    // after it (see the gate's rule).
    let resolved = resolve(app, path).await;
    place(app, path, &resolved, origin, gesture, token)
}

/// Decides under the gate, then carries the decision out without it.
fn place<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
    resolved: &Resolved,
    origin: Origin,
    gesture: Gesture,
    token: &str,
) -> Result<Step, WireError> {
    let st = state(app)?;
    let plan = decide(app, &st, path, resolved, origin, gesture, token)?;
    let wp = WirePath::from(path);
    let done = |action, location| {
        Step::Done(OpenOutcome {
            path: wp.clone(),
            action,
            location,
            error: None,
        })
    };
    match plan {
        Placement::FolderTab(p) => {
            ensure_main(app)?;
            send_directive(
                app,
                MAIN,
                &Directive::FolderTab {
                    path: WirePath::from(&p),
                },
            )?;
            focus(app, MAIN, token)?;
            Ok(done("folder_tab", None))
        }
        Placement::DocTab(p) => {
            ensure_main(app)?;
            send_directive(
                app,
                MAIN,
                &Directive::DocTab {
                    path: WirePath::from(&p),
                },
            )?;
            focus(app, MAIN, token)?;
            Ok(done("doc_tab", None))
        }
        Placement::NewDoc { path: p, label } => {
            let loc = Location::Window {
                label: label.clone(),
            };
            let result = build_doc_window(app, &label);
            // This launch's token, or a later one that landed on the window
            // while it was being built.
            let token = built(&st, &label);
            if let Err(e) = result {
                // The reservation was never a window.
                st.open.remove_if(&p, &loc);
                return Err(e);
            }
            send_directive(
                app,
                &label,
                &Directive::LoadDoc {
                    path: WirePath::from(&p),
                },
            )?;
            focus(app, &label, &token)?;
            Ok(done("doc_window", Some(loc)))
        }
        Placement::Focus(loc) => {
            match &loc {
                Location::Tab { tab_id } => {
                    send_directive(
                        app,
                        MAIN,
                        &Directive::FocusTab {
                            tab_id: tab_id.clone(),
                        },
                    )?;
                    focus(app, MAIN, token)?;
                }
                Location::Window { label } => {
                    // A window still being built is presented by the launch
                    // building it, once built, with the latest token handed
                    // to it; this launch's token is handed over. Checked and
                    // set under the lock `built` takes, so the token is
                    // either handed over or the window is presented here.
                    let building = {
                        let mut inner = st.lock();
                        match inner.creating.get_mut(label) {
                            Some(t) => {
                                if !token.is_empty() {
                                    *t = token.to_owned();
                                }
                                true
                            }
                            None => false,
                        }
                    };
                    if !building {
                        focus(app, label, token)?;
                    }
                }
            }
            Ok(done("focus", Some(loc)))
        }
        Placement::DefaultApp(p) => Ok(Step::DefaultApp(p)),
    }
}

/// The registry check and the reservation, under the gate. Takes no step
/// that waits for the main thread.
fn decide<R: Runtime>(
    app: &AppHandle<R>,
    st: &WindowState,
    path: &Path,
    resolved: &Resolved,
    origin: Origin,
    gesture: Gesture,
    token: &str,
) -> Result<Placement, WireError> {
    let _gate = st.lock_gate();
    let canonical = resolved.canonical.as_deref();
    // Twice at most: a registry entry whose window is gone is dropped and
    // the path routed afresh.
    for _ in 0..2 {
        let known = st.open.get(path, canonical).is_some();
        let kind = match (&resolved.kind, known) {
            (Ok(k), _) => *k,
            // A document already open stays focusable after its file is gone.
            (Err(_), true) => Kind::Other,
            (Err(e), false) => return Err(e.clone()),
        };
        match route(path, canonical, origin, gesture, kind, &st.open) {
            Target::FolderTab(p) => return Ok(Placement::FolderTab(p)),
            Target::DocTab(p) => return Ok(Placement::DocTab(p)),
            Target::DefaultApp(p) => return Ok(Placement::DefaultApp(p)),
            Target::DocWindow(p) => {
                let label = reserve_doc_label(app, st, token);
                st.open.insert(
                    &p,
                    resolved.canonical.clone(),
                    Location::Window {
                        label: label.clone(),
                    },
                );
                return Ok(Placement::NewDoc { path: p, label });
            }
            Target::Focus(loc) => {
                let gone = match &loc {
                    Location::Tab { .. } => app.get_webview_window(MAIN).is_none(),
                    Location::Window { label } => {
                        app.get_webview_window(label).is_none()
                            && !st.lock().creating.contains_key(label)
                    }
                };
                if gone {
                    st.open.remove(path);
                    continue;
                }
                return Ok(Placement::Focus(loc));
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
pub fn open_home<R: Runtime>(app: &AppHandle<R>, token: &str) -> Result<(), WireError> {
    if ensure_main(app)? {
        send_directive(app, MAIN, &Directive::HomeTab)?;
    }
    focus(app, MAIN, token)
}

pub(crate) fn arg_error(e: &ArgError) -> WireError {
    wire_error("BadArgument", e.to_string(), None)
}

/// Handles a launch from outside: this process's own, or one forwarded by a
/// second launch. Errors cannot be returned to anyone, so they are shown in
/// `main` (created if need be) as [`EVENT_OPEN_ERROR`]. (A launch that needs
/// no window never gets here: see `prelaunch`.)
pub async fn handle_launch<R: Runtime>(app: &AppHandle<R>, inv: crate::instance::Invocation) {
    let token = inv.activation_token.as_str();
    let errors = match cli::plan(&inv.argv, &inv.cwd) {
        Plan::Home => open_home(app, token).err().into_iter().collect::<Vec<_>>(),
        Plan::Open(parsed) => {
            let mut errors: Vec<WireError> = parsed.errors.iter().map(arg_error).collect();
            let outcomes =
                open_paths_impl(app, parsed.paths, Origin::Outside, Gesture::Default, token).await;
            for e in outcomes.into_iter().filter_map(|o| o.error) {
                // Files opened together share one error; it is shown once.
                if !errors.contains(&e) {
                    errors.push(e);
                }
            }
            errors
        }
    };
    show_errors(app, &errors, token);
}

/// Shows `errors` in `main` (created if need be) as [`EVENT_OPEN_ERROR`],
/// and raises it. When even that fails they go to standard error.
pub(crate) fn show_errors<R: Runtime>(app: &AppHandle<R>, errors: &[WireError], token: &str) {
    if errors.is_empty() {
        return;
    }
    let shown = ensure_main(app).and_then(|_| {
        for e in errors {
            send(app, MAIN, EVENT_OPEN_ERROR, json!(e))?;
        }
        focus(app, MAIN, token)
    });
    if let Err(e) = shown {
        eprintln!("kern: could not show open errors ({e:?}); they were:");
        for err in errors {
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
    // A path that does not decode keeps its place among the outcomes.
    let mut out: Vec<Option<OpenOutcome>> = Vec::with_capacity(paths.len());
    let mut good = Vec::new();
    for wp in paths {
        match wp.to_path_buf() {
            Ok(p) => {
                good.push(p);
                out.push(None);
            }
            Err(e) => out.push(Some(OpenOutcome {
                path: wp,
                action: "failed",
                location: None,
                error: Some(WireError::from(e)),
            })),
        }
    }
    let mut opened = open_paths_impl(&app, good, origin, gesture, "")
        .await
        .into_iter();
    // `open_paths_impl` gives one outcome per path, so none is missing.
    out.into_iter()
        .map(|o| o.or_else(|| opened.next()))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| wire_error("Internal", "an open outcome is missing", None))
}

/// The frontend opened `path` at `location`.
#[tauri::command]
pub async fn doc_opened<R: Runtime>(
    app: AppHandle<R>,
    path: WirePath,
    location: Location,
) -> Result<(), WireError> {
    let p = path.to_path_buf()?;
    let q = p.clone();
    let canonical = blocking(move || Ok(std::fs::canonicalize(&q).ok())).await?;
    state(&app)?.open.insert(&p, canonical, location);
    Ok(())
}

/// The frontend closed `path` at `location`. Only that registration goes: a
/// tab closing after its document moved to a window leaves the window's.
#[tauri::command]
pub fn doc_closed<R: Runtime>(
    app: AppHandle<R>,
    path: WirePath,
    location: Location,
) -> Result<(), WireError> {
    let p = path.to_path_buf()?;
    state(&app)?.open.remove_if(&p, &location);
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
pub async fn detach_doc<R: Runtime>(
    app: AppHandle<R>,
    tab_id: String,
    path: WirePath,
) -> Result<String, WireError> {
    let p = path.to_path_buf()?;
    let st = state(&app)?;
    let q = p.clone();
    let canonical = blocking(move || Ok(std::fs::canonicalize(&q).ok())).await?;
    // Check and reserve under the gate; build the window after it.
    let (label, prior) = {
        let _gate = st.lock_gate();
        let prior = st.open.get(&p, canonical.as_deref());
        match &prior {
            Some(Location::Window { label }) => {
                return Err(wire_error(
                    "AlreadyOpen",
                    format!("the document is already open in window {label}"),
                    Some(&p),
                ));
            }
            Some(Location::Tab { tab_id: registered }) if registered != &tab_id => {
                return Err(wire_error(
                    "TabMismatch",
                    format!("the document is open in tab {registered}, not {tab_id}"),
                    Some(&p),
                ));
            }
            _ => {}
        }
        let label = reserve_doc_label(&app, &st, "");
        // The window takes the registration over from the tab now.
        st.open.insert(
            &p,
            canonical.clone(),
            Location::Window {
                label: label.clone(),
            },
        );
        (label, prior)
    };
    let result = build_doc_window(&app, &label);
    let token = built(&st, &label);
    if let Err(e) = result {
        let mine = Location::Window {
            label: label.clone(),
        };
        match prior {
            Some(old) => st.open.insert(&p, canonical, old),
            None => st.open.remove_if(&p, &mine),
        }
        return Err(e);
    }
    send_directive(&app, &label, &Directive::LoadDoc { path })?;
    focus(&app, &label, &token)?;
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
        // Nothing reached main, so there is nothing to cancel there.
        st.lock().adopting.remove(&label);
        return Err(e);
    }
    // Main has the document from here on: every way out below that does not
    // end in the window closing takes the adoption back.
    if let Err(e) = focus(&app, MAIN, "") {
        // Raising main is a courtesy; the adoption goes on.
        eprintln!("kern: could not raise the main window: {e:?}");
    }
    let timeout = st.adopt_timeout;
    let acked = match blocking(move || Ok(rx.recv_timeout(timeout).is_ok())).await {
        Ok(a) => a,
        Err(e) => {
            cancel_adoption(&app, &st, &label, &path);
            return Err(e);
        }
    };
    if !acked {
        cancel_adoption(&app, &st, &label, &path);
        return Err(wire_error(
            "AdoptTimeout",
            "the main window did not take the document; it stays open here",
            Some(&path),
        ));
    }
    st.lock().adopting.remove(&label);
    if let Err(e) = doc.destroy() {
        // Main has the document; leaving the window too would make two
        // copies, so main is told to drop its tab and the window keeps it.
        cancel_adoption(&app, &st, &label, &path);
        return Err(window_error(e));
    }
    Ok(())
}

/// Takes a move back: the document window keeps the path, and `main` is told
/// to drop the tab it may have made.
fn cancel_adoption<R: Runtime>(app: &AppHandle<R>, st: &WindowState, label: &str, path: &Path) {
    st.lock().adopting.remove(label);
    st.open.insert(
        path,
        std::fs::canonicalize(path).ok(),
        Location::Window {
            label: label.to_owned(),
        },
    );
    if let Err(e) = send(app, MAIN, EVENT_ADOPT_CANCELLED, json!({ "label": label })) {
        eprintln!("kern: could not tell main to drop the moved tab: {e:?}");
    }
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

/// The calling window's frontend finished its save / discard / cancel
/// prompt and the window should go.
#[tauri::command]
pub fn confirm_close<R: Runtime>(window: WebviewWindow<R>) -> Result<(), WireError> {
    window.destroy().map_err(window_error)
}

/// Tells the window's frontend that the user asked to close it.
pub fn ask_to_close<R: Runtime>(window: &Window<R>) {
    if let Err(e) = window.emit_to(window.label(), EVENT_CLOSE_REQUESTED, ()) {
        eprintln!("kern: could not ask {} to close: {e}", window.label());
    }
}

/// A page (re)load in a window: whatever it had registered as ready is gone
/// with the page, so directives queue again until it asks.
pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if payload.event() == PageLoadEvent::Started {
        page_reloading(webview.app_handle(), webview.label());
    }
}

/// The page of window `label` is loading.
pub fn page_reloading<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(st) = app.try_state::<WindowState>() {
        st.lock().ready.remove(label);
    }
}

/// Window events: close goes through the frontend's prompt, and a window
/// that is gone is forgotten.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    match event {
        WindowEvent::DragDrop(_) => crate::dnd::on_window_event(window, event),
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

/// Application events. Closing the last window asks the application to
/// exit; while a launch it accepted is still pending (answered on the bus,
/// or this process's own) the exit is deferred, and [`launch_finished`]
/// decides again once the launches are handled.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: tauri::RunEvent) {
    if let tauri::RunEvent::ExitRequested { api, .. } = event {
        if let Some(l) = app.try_state::<Launches>() {
            if !l.exit_requested() {
                api.prevent_exit();
            }
        }
    }
}

/// A launch counted in [`Launches`] is handled. When it was the last one
/// and no window is open, nothing is left for the application to show, so
/// it exits (an exit deferred by [`on_run_event`] ends here, as does a
/// launch that opened no window).
pub fn launch_finished<R: Runtime>(app: &AppHandle<R>) {
    let Some(l) = app.try_state::<Launches>() else {
        return;
    };
    let remaining = l.finish();
    if exit_when_drained(remaining, app.webview_windows().len()) {
        app.exit(0);
    }
}

/// Handles a launch counted in [`Launches`], then counts it out.
pub async fn run_launch<R: Runtime>(app: &AppHandle<R>, inv: crate::instance::Invocation) {
    handle_launch(app, inv).await;
    launch_finished(app);
}

/// Starts the thread that applies launches forwarded to this instance. Each
/// was counted in when the bus call was answered.
pub fn serve_launches<R: Runtime>(
    app: AppHandle<R>,
    launches: std::sync::mpsc::Receiver<crate::instance::Invocation>,
) {
    std::thread::spawn(move || {
        for inv in launches {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                run_launch(&app, inv).await;
            });
        }
    });
}
