// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Windows, the open rules applied, and what the frontend is told.
//!
//! Windows are `main` (browsing, created on demand), `doc-<n>` (standalone
//! documents, design D4.4) and `editor-<n>` (an editor window rooted at one
//! folder, with tabs of its own). Directives for a window go out as
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
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
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
use crate::open::{
    route, FileId, Gesture, Held, Kind, Location, OpenRegistry, Origin, Stat, Survey, Target,
};
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
const EDITOR_PREFIX: &str = "editor-";

/// The three kinds of window, told apart by label.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowKind {
    Main,
    Document,
    Editor,
}

/// The kind of window labelled `label`, or `None` for a label Kern does not make.
pub fn window_kind(label: &str) -> Option<WindowKind> {
    if label == MAIN {
        Some(WindowKind::Main)
    } else if label.strip_prefix(DOC_PREFIX).is_some_and(is_number) {
        Some(WindowKind::Document)
    } else if label.strip_prefix(EDITOR_PREFIX).is_some_and(is_number) {
        Some(WindowKind::Editor)
    } else {
        None
    }
}

fn is_number(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// How long `move_doc_to_main` waits for `main` to acknowledge. A freshly
/// created window has to load the frontend and answer `open_pending_take`
/// first; 15 s is far beyond a healthy start and short enough that a stuck
/// window is reported while the user still remembers the click.
pub const ADOPT_TIMEOUT: Duration = Duration::from_secs(15);

/// The longest a look at the registered documents waits in all (see
/// [`under_gate`]). A stat on a local disk or a working network mount
/// returns in milliseconds and on a slow remote one within a second or so;
/// a stat that has not returned after two seconds is a mount that has
/// stopped answering (NFS, sshfs, a stale FUSE mount), and an open or a
/// Save As must not wait on it for ever.
pub const SWEEP_BOUND: Duration = Duration::from_secs(2);

/// How many times a look at the registry is taken again because the
/// registry changed while the look was made, before the answer is given
/// without a look (see [`under_gate`]). Each change is another window's open
/// or close landing in the milliseconds a look takes, so a few tries are
/// enough in practice and the bound only stops a storm of them.
const MAX_SWEEPS: usize = 5;

/// Size of a standalone document window (my call, D4.4 gives none).
const DOC_SIZE: (f64, f64) = (900.0, 700.0);
const DOC_MIN_SIZE: (f64, f64) = (480.0, 320.0);

/// Size of an editor window: the tree and the document side by side need the
/// main window's room, so it starts at its size and floor (tauri.conf.json).
const EDITOR_SIZE: (f64, f64) = (1200.0, 800.0);
const EDITOR_MIN_SIZE: (f64, f64) = (800.0, 560.0);

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
    /// For a `doc-<n>` window: load this document. `text_state` is the
    /// editor state of the tab it left (unsaved text included), passed
    /// through untouched; without it the window reads the file. `ack` is
    /// set when a tab is being moved here: the window answers with
    /// `detached` once it holds the document and has registered it, or with
    /// `refuse_detach`, and the tab closes only on the first.
    LoadDoc {
        path: WirePath,
        #[serde(skip_serializing_if = "Option::is_none")]
        text_state: Option<Value>,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        ack: bool,
    },
    /// For an `editor-<n>` window: the folder its tree is rooted at.
    EditorRoot {
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
    next_editor: u64,
    ready: HashSet<String>,
    pending: HashMap<String, Vec<Queued>>,
    /// Moves waiting for main's answer: `Ok` it took the document, `Err`
    /// it refused, with its reason.
    adopting: HashMap<String, Sender<Result<(), String>>>,
    /// Tabs moving to a new window, by that window's label, waiting for its
    /// answer: `Ok` it holds the document, `Err` it refused or went away.
    detaching: HashMap<String, Sender<Result<(), String>>>,
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
    /// Rule: nothing under the gate creates a window, waits for the main
    /// thread or touches the file system. Window creation blocks its caller
    /// until the main thread has built the window, and a command running on
    /// the main thread may be waiting for this gate; a stat on a mount that
    /// has stopped answering never returns. The gate covers the registry
    /// check and the reservation (label, registry entry) only, on a look at
    /// the registry taken before it ([`under_gate`]); the window is built
    /// after it is released, and the reservation is confirmed or rolled back.
    gate: Mutex<()>,
    adopt_timeout: Duration,
    /// How the file behind a registered path is looked up, and how long a
    /// look waits. [`FileId::of`] and [`SWEEP_BOUND`] in the application.
    stat: Stat,
    sweep_bound: Duration,
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
                next_editor: 1,
                ready: HashSet::new(),
                pending: HashMap::new(),
                adopting: HashMap::new(),
                detaching: HashMap::new(),
                creating: HashMap::new(),
            }),
            adopt_timeout,
            stat: Arc::new(FileId::of),
            sweep_bound: SWEEP_BOUND,
        }
    }

    /// State whose registry looks files up with `stat`, waiting at most
    /// `bound` in all for a look at the registered documents.
    pub fn with_stat(mut self, stat: Stat, bound: Duration) -> WindowState {
        self.stat = stat;
        self.sweep_bound = bound;
        self
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

/// Runs `act` under the gate on a look at the registry that was taken
/// without it. The look (`stat` of every registered path, on threads of their
/// own, bounded by the state's `sweep_bound`) is taken first; the gate is
/// then taken and the registry's generation compared with the look's: if
/// anything was registered or released in between, the look is stale and is
/// taken again, up to [`MAX_SWEEPS`] times. After that `act` runs once more
/// on a look in which no path answered, so it decides as for a timeout (by
/// path text and the asked path's own resolution). `act` returns `None` to ask
/// for a new look (it has changed the registry, or found a window gone);
/// it must not change the registry and then return `None` for any other
/// reason. `None` comes back only when even the last pass asked again.
async fn under_gate<T>(
    st: &WindowState,
    path: &Path,
    mut act: impl FnMut(&Survey) -> Option<T>,
) -> Result<Option<T>, WireError> {
    for _ in 0..MAX_SWEEPS {
        let snapshot = st.open.snapshot();
        let (stat, bound, p) = (Arc::clone(&st.stat), st.sweep_bound, path.to_path_buf());
        let survey = blocking(move || Ok(snapshot.survey(&p, &stat, bound))).await?;
        let gate = st.lock_gate();
        if st.open.generation() == survey.generation {
            if let Some(t) = act(&survey) {
                return Ok(Some(t));
            }
        }
        drop(gate);
    }
    let _gate = st.lock_gate();
    Ok(act(&st.open.snapshot().unlooked(path)))
}

/// What is said when the registered documents could not all be looked at.
fn unanswered_words(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

/// The next `<prefix><n>` label. The counter only grows, so a label is never
/// reused, and `is_open` skips a label a window still holds.
fn next_label(prefix: &str, counter: &mut u64, is_open: impl Fn(&str) -> bool) -> String {
    loop {
        let label = format!("{prefix}{counter}");
        *counter += 1;
        if !is_open(&label) {
            return label;
        }
    }
}

/// The next `doc-<n>` label (see `next_label`).
pub fn next_doc_label(counter: &mut u64, is_open: impl Fn(&str) -> bool) -> String {
    next_label(DOC_PREFIX, counter, is_open)
}

/// The next `editor-<n>` label; its counter is the document windows' twin.
pub fn next_editor_label(counter: &mut u64, is_open: impl Fn(&str) -> bool) -> String {
    next_label(EDITOR_PREFIX, counter, is_open)
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

/// Reserves the next `editor-<n>` label, marked as being built like a
/// document window's.
fn reserve_editor_label<R: Runtime>(app: &AppHandle<R>, st: &WindowState) -> String {
    let mut inner = st.lock();
    let label = next_editor_label(&mut inner.next_editor, |l| {
        app.get_webview_window(l).is_some()
    });
    inner.creating.insert(label.clone(), String::new());
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
        // Kern's own handler takes drops of files (dnd.rs); Tauri's would take them first.
        .disable_drag_drop_handler()
        .inner_size(DOC_SIZE.0, DOC_SIZE.1)
        .min_inner_size(DOC_MIN_SIZE.0, DOC_MIN_SIZE.1)
        .build()
        .map(|_| ())
        .map_err(window_error)
}

/// Builds the window for a reserved editor label. Never call with the gate held.
fn build_editor_window<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), WireError> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title("Kern")
        // Kern's own handler takes drops of files (dnd.rs); Tauri's would take them first.
        .disable_drag_drop_handler()
        .inner_size(EDITOR_SIZE.0, EDITOR_SIZE.1)
        .min_inner_size(EDITOR_MIN_SIZE.0, EDITOR_MIN_SIZE.1)
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
    id: FileId,
    kind: Result<Kind, WireError>,
}

async fn resolve<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Resolved {
    let id = FileId::of(path);
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
    Resolved { id, kind }
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
    open_paths_in(app, MAIN, paths, origin, gesture, token).await
}

/// [`open_paths_impl`] for a request that came from window `home`: a text
/// file that opens as a tab opens in `home` when that window holds tabs (the
/// main window or an editor window), else in `main`. Folders open in `main`.
pub async fn open_paths_in<R: Runtime>(
    app: &AppHandle<R>,
    home: &str,
    paths: Vec<PathBuf>,
    origin: Origin,
    gesture: Gesture,
    token: &str,
) -> Vec<OpenOutcome> {
    let mut out = Vec::with_capacity(paths.len());
    // Index in `out`, and the file to open.
    let mut defaults: Vec<(usize, PathBuf)> = Vec::new();
    for path in paths {
        match try_open(app, home, &path, origin, gesture, token).await {
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
    /// A text file for a tab of window `window`, held for it in the registry.
    DocTab {
        path: PathBuf,
        window: String,
    },
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
    home: &str,
    path: &Path,
    origin: Origin,
    gesture: Gesture,
    token: &str,
) -> Result<Step, WireError> {
    // All file access happens before the registry is consulted. The check
    // and the reservation are one step under the gate; the window is built
    // after it (see the gate's rule).
    let resolved = resolve(app, path).await;
    place(app, home, path, &resolved, origin, gesture, token).await
}

/// Decides under the gate, then carries the decision out without it.
async fn place<R: Runtime>(
    app: &AppHandle<R>,
    home: &str,
    path: &Path,
    resolved: &Resolved,
    origin: Origin,
    gesture: Gesture,
    token: &str,
) -> Result<Step, WireError> {
    let st = state(app)?;
    let decided = under_gate(&st, path, |survey| {
        decide(
            app,
            &st,
            home,
            path,
            resolved,
            (origin, gesture),
            token,
            survey,
        )
        .transpose()
    })
    .await?;
    let Decision { plan, unanswered } = decided.ok_or_else(|| {
        wire_error(
            "Internal",
            "the open registry kept naming a window that does not exist",
            Some(path),
        )
    })??;
    let wp = WirePath::from(path);
    // Registered documents that did not answer were compared by their path text only, so the
    // file may be open under another name of one of them: said with the result.
    let unchecked = (!unanswered.is_empty()).then(|| {
        wire_error(
            "OpenCheck",
            format!(
                "could not check whether {} is already open under another name: {} did not answer; it was opened by its path",
                path.display(),
                unanswered_words(&unanswered)
            ),
            Some(path),
        )
    });
    let done = |action, location| {
        Step::Done(OpenOutcome {
            path: wp.clone(),
            action,
            location,
            error: if matches!(action, "doc_tab" | "doc_window") {
                unchecked.clone()
            } else {
                None
            },
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
        Placement::DocTab { path: p, window } => {
            // The path is held for `window` already; if the tab cannot be asked for, it is let go.
            let held = Location::Opening {
                window: window.clone(),
            };
            let sent = (|| {
                if window == MAIN {
                    ensure_main(app)?;
                }
                send_directive(
                    app,
                    &window,
                    &Directive::DocTab {
                        path: WirePath::from(&p),
                    },
                )?;
                focus(app, &window, token)
            })();
            if let Err(e) = sent {
                st.open.remove_if(&p, &held);
                return Err(e);
            }
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
                    text_state: None,
                    ack: false,
                },
            )?;
            focus(app, &label, &token)?;
            Ok(done("doc_window", Some(loc)))
        }
        Placement::Focus(loc) => {
            match &loc {
                // The tab is on its way: the window that is making it is brought forward.
                Location::Opening { window } => {
                    focus(app, window, token)?;
                }
                Location::Tab { window, tab_id } => {
                    send_directive(
                        app,
                        window,
                        &Directive::FocusTab {
                            tab_id: tab_id.clone(),
                        },
                    )?;
                    focus(app, window, token)?;
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

/// What [`decide`] settled on, and the registered paths that did not answer
/// the look it used.
struct Decision {
    plan: Placement,
    unanswered: Vec<PathBuf>,
}

/// The registry check and the reservation, on the look `survey`, under the
/// gate. Takes no step that waits for the main thread or the file system.
/// `Ok(None)` asks for a new look: a registry entry whose window is gone was
/// dropped, and the path is to be routed afresh.
#[allow(clippy::too_many_arguments)]
fn decide<R: Runtime>(
    app: &AppHandle<R>,
    st: &WindowState,
    home: &str,
    path: &Path,
    resolved: &Resolved,
    (origin, gesture): (Origin, Gesture),
    token: &str,
    survey: &Survey,
) -> Result<Option<Decision>, WireError> {
    let found = survey.lookup(&resolved.id);
    let kind = match (&resolved.kind, found.location.is_some()) {
        (Ok(k), _) => *k,
        // A document already open stays focusable after its file is gone.
        (Err(_), true) => Kind::Other,
        (Err(e), false) => return Err(e.clone()),
    };
    let unanswered = found.unanswered;
    let plan = match route(path, found.location, origin, gesture, kind) {
        Target::FolderTab(p) => Placement::FolderTab(p),
        Target::DocTab(p) => {
            // The window that asked, when it holds tabs; otherwise main. Held for it from
            // here until its tab registers, so a second open of the file is focused, not
            // opened: both would load the text and one would unseat the other.
            let window = if window_kind(home) == Some(WindowKind::Editor) {
                home.to_owned()
            } else {
                MAIN.to_owned()
            };
            st.open.insert(
                &p,
                Location::Opening {
                    window: window.clone(),
                },
            );
            Placement::DocTab { path: p, window }
        }
        Target::DefaultApp(p) => Placement::DefaultApp(p),
        Target::DocWindow(p) => {
            let label = reserve_doc_label(app, st, token);
            st.open.insert(
                &p,
                Location::Window {
                    label: label.clone(),
                },
            );
            Placement::NewDoc { path: p, label }
        }
        Target::Focus(loc) => {
            let gone = match &loc {
                Location::Tab { window, .. } | Location::Opening { window } => {
                    app.get_webview_window(window).is_none()
                }
                Location::Window { label } => {
                    app.get_webview_window(label).is_none()
                        && !st.lock().creating.contains_key(label)
                }
            };
            if gone {
                st.open.remove_window(loc.window());
                return Ok(None);
            }
            Placement::Focus(loc)
        }
    };
    Ok(Some(Decision { plan, unanswered }))
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
    window: WebviewWindow<R>,
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
    let mut opened = open_paths_in(&app, window.label(), good, origin, gesture, "")
        .await
        .into_iter();
    // `open_paths_impl` gives one outcome per path, so none is missing.
    out.into_iter()
        .map(|o| o.or_else(|| opened.next()))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| wire_error("Internal", "an open outcome is missing", None))
}

/// A window registers and releases only its own places: its tabs and, for a
/// document window, itself.
fn own_place(window_label: &str, location: &Location) -> Result<(), WireError> {
    if location.window() == window_label {
        Ok(())
    } else {
        Err(wire_error(
            "Denied",
            format!(
                "window {window_label} may not register a place of window {}",
                location.window()
            ),
            None,
        ))
    }
}

/// A place in words, for what is said when a file is already open there.
pub fn describe_place(location: &Location) -> String {
    match location {
        Location::Window { .. } => "a window of its own".to_owned(),
        Location::Tab { window, .. } | Location::Opening { window } if window == MAIN => {
            "a tab of the main window".to_owned()
        }
        Location::Tab { .. } | Location::Opening { .. } => "a tab of an editor window".to_owned(),
    }
}

/// Whether a registration at `want` may take over what the registry holds
/// as `held`: the same place, or the tab a text file was routed to.
fn may_take_over(held: &Location, want: &Location) -> bool {
    held == want
        || matches!((held, want), (Location::Opening { window: h }, Location::Tab { window: w, .. }) if h == w)
}

/// The frontend opened `path` at `location`, a place of the calling window.
/// A path already open at another place is refused (`AlreadyOpen`, naming
/// it): the registration would unseat that place's editor, and two editors
/// on one file lose one user's text. `adopting_from` is set by the main window when `location` is the tab it
/// made for the document of window `adopting_from` (a move Home): the
/// registration is refused once the backend has taken that move back, so a
/// late registration cannot take the path from the window that kept it.
#[tauri::command]
pub async fn doc_opened<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    path: WirePath,
    location: Location,
    adopting_from: Option<String>,
) -> Result<(), WireError> {
    own_place(window.label(), &location)?;
    let p = path.to_path_buf()?;
    let q = p.clone();
    let id = blocking(move || Ok(FileId::of(&q))).await?;
    let st = state(&app)?;
    match adopting_from {
        None => {
            // Looked at and registered in one step, with the opens that reserve a path. A
            // registered document that did not answer the look is compared by its text; the
            // open that routed the file here said so.
            let done = under_gate(&st, &p, |survey| match survey.lookup(&id).location {
                Some(held) if !may_take_over(&held, &location) => Some(Err(wire_error(
                    "AlreadyOpen",
                    format!("this file is already open in {}", describe_place(&held)),
                    Some(&p),
                ))),
                _ => {
                    st.open.insert(&p, location.clone());
                    Some(Ok(()))
                }
            })
            .await?;
            done.ok_or_else(registry_busy)??;
        }
        Some(from) => {
            if window.label() != MAIN {
                return Err(wire_error(
                    "Denied",
                    "only the main window registers the tab of a move Home",
                    None,
                ));
            }
            // Checked and registered under the lock `cancel_adoption` takes to
            // end the move, so the two cannot interleave.
            let inner = st.lock();
            if !inner.adopting.contains_key(&from) {
                return Err(wire_error(
                    "AdoptionOver",
                    format!("the move from window {from} is over; it keeps the document"),
                    Some(&p),
                ));
            }
            st.open.insert(&p, location);
            drop(inner);
        }
    }
    Ok(())
}

/// The frontend closed `path` at `location`, a place of the calling window.
/// Only that registration goes: a tab closing after its document moved to a
/// window leaves the window's. With `tab_closed` the tab itself is gone (not
/// only this path released, as when a Save As moves the document to another
/// file), and everything held at that tab goes with it, whatever its path.
#[tauri::command]
pub fn doc_closed<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    path: WirePath,
    location: Location,
    tab_closed: Option<bool>,
) -> Result<(), WireError> {
    own_place(window.label(), &location)?;
    let p = path.to_path_buf()?;
    let st = state(&app)?;
    st.open.remove_if(&p, &location);
    if let Location::Tab { window, tab_id } = &location {
        // A tab that never registered (its file did not open) lets go of the path held for it.
        st.open.remove_if(
            &p,
            &Location::Opening {
                window: window.clone(),
            },
        );
        // A tab that is gone holds nothing: not a Save As target whose save was still on its
        // way, nor anything else registered at it.
        if tab_closed == Some(true) {
            st.open.remove_tab(window, tab_id);
        }
    }
    Ok(())
}

fn registry_busy() -> WireError {
    wire_error("Internal", "the open registry could not be read", None)
}

/// Whether `path`, by any name, is open in a place other than `own`, a place
/// of the calling window that holds a document. Save As asks this before it
/// writes: a file open in another place is never written over (two editors
/// on one file lose one user's text), and a path that leads to the document's
/// own file is that file, not another. With `reserve`, a path found free is
/// held for `own` in the same step, so nothing can open it between the check
/// and the write; the holder lets go with `doc_closed` when the save does not
/// happen, and the document's own registration of the new path replaces it
/// when it does. When a registered document's file does not answer a look in
/// time the question cannot be answered, and the call fails (`OpenCheck`)
/// naming the path that did not answer: nothing is held and nothing is
/// written over a file that may be open elsewhere.
#[tauri::command]
pub async fn doc_open_elsewhere<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    path: WirePath,
    own: Location,
    reserve: Option<bool>,
) -> Result<Held, WireError> {
    own_place(window.label(), &own)?;
    let p = path.to_path_buf()?;
    let q = p.clone();
    let id = blocking(move || Ok(FileId::of(&q))).await?;
    let st = state(&app)?;
    let answer = under_gate(&st, &p, |survey| {
        let held = survey.held_by(&id, &own);
        if reserve == Some(true) && held == Ok(Held::Free) {
            st.open.reserve(&p, own.clone());
        }
        Some(held)
    })
    .await?
    .ok_or_else(registry_busy)?;
    answer.map_err(|silent| {
        wire_error(
            "OpenCheck",
            format!(
                "could not check whether {} is open elsewhere: {} did not answer",
                p.display(),
                unanswered_words(&silent)
            ),
            Some(&p),
        )
    })
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

/// Detaches a document tab of the calling window into a window of its own
/// (D4.5). `text_state` is the tab's editor state, handed to the window
/// untouched, so unsaved text moves with the document.
///
/// The tab is not given up until the new window says it holds the document
/// and has registered it (`detached`); the call returns then, and the
/// frontend closes the tab. If the window refuses (`refuse_detach`), is
/// closed, or does not answer within the timeout, the call fails with the
/// reason, the half-made window is closed without asking (it holds no text
/// the tab does not hold) and the tab keeps its registration.
#[tauri::command]
pub async fn detach_doc<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    tab_id: String,
    path: WirePath,
    text_state: Option<Value>,
) -> Result<String, WireError> {
    let p = path.to_path_buf()?;
    let st = state(&app)?;
    let q = p.clone();
    let id = blocking(move || Ok(FileId::of(&q))).await?;
    // Check and reserve under the gate; build the window after it.
    let reserved = under_gate(&st, &p, |survey| {
        let prior = survey.lookup(&id).location;
        match &prior {
            Some(Location::Window { label }) => {
                return Some(Err(wire_error(
                    "AlreadyOpen",
                    format!("the document is already open in window {label}"),
                    Some(&p),
                )));
            }
            Some(Location::Tab {
                window: w,
                tab_id: registered,
            }) if w != window.label() || registered != &tab_id => {
                return Some(Err(wire_error(
                    "TabMismatch",
                    format!("the document is open in tab {registered} of window {w}, not tab {tab_id} of window {}", window.label()),
                    Some(&p),
                )));
            }
            // Only a tab that has registered its document is moved: the registry is how the
            // window holding the tab is known to be the one asking.
            None | Some(Location::Opening { .. }) => {
                return Some(Err(wire_error(
                    "NotRegistered",
                    "the document has not finished opening in this tab, so it cannot be moved yet",
                    Some(&p),
                )));
            }
            _ => {}
        }
        let label = reserve_doc_label(&app, &st, "");
        let (tx, rx) = mpsc::channel();
        st.lock().detaching.insert(label.clone(), tx);
        // The window takes the registration over from the tab now.
        st.open.insert(
            &p,
            Location::Window {
                label: label.clone(),
            },
        );
        Some(Ok((label, prior, rx)))
    })
    .await?;
    let (label, prior, rx) = reserved.ok_or_else(registry_busy)??;
    let result = build_doc_window(&app, &label);
    let token = built(&st, &label);
    if let Err(e) = result {
        undo_detach(&app, &st, &label, &p, prior);
        return Err(e);
    }
    let started = send_directive(
        &app,
        &label,
        &Directive::LoadDoc {
            path,
            text_state,
            ack: true,
        },
    )
    .and_then(|()| focus(&app, &label, &token));
    if let Err(e) = started {
        undo_detach(&app, &st, &label, &p, prior);
        return Err(e);
    }
    let timeout = st.adopt_timeout;
    let answer = match blocking(move || Ok(rx.recv_timeout(timeout).ok())).await {
        Ok(a) => a,
        Err(e) => {
            undo_detach(&app, &st, &label, &p, prior);
            return Err(e);
        }
    };
    match answer {
        Some(Ok(())) => {
            st.lock().detaching.remove(&label);
            Ok(label)
        }
        Some(Err(reason)) => {
            undo_detach(&app, &st, &label, &p, prior);
            Err(wire_error("DetachRefused", reason, Some(&p)))
        }
        None => {
            undo_detach(&app, &st, &label, &p, prior);
            Err(wire_error(
                "DetachTimeout",
                "the new window did not take the document; it stays in its tab",
                Some(&p),
            ))
        }
    }
}

/// Takes a tab's move to a new window back: the window is closed without
/// asking and the path is registered at the tab again (or forgotten, if it
/// was not open before).
fn undo_detach<R: Runtime>(
    app: &AppHandle<R>,
    st: &WindowState,
    label: &str,
    path: &Path,
    prior: Option<Location>,
) {
    st.lock().detaching.remove(label);
    st.lock().creating.remove(label);
    let mine = Location::Window {
        label: label.to_owned(),
    };
    match prior {
        Some(old) => st.open.insert(path, old),
        None => st.open.remove_if(path, &mine),
    }
    if let Some(w) = app.get_webview_window(label) {
        if let Err(e) = w.destroy() {
            eprintln!("kern: could not close the half-made window {label}: {e}");
        }
    }
}

/// The calling document window holds the document it was sent for a tab's
/// move (`detach_doc`) and has registered it.
#[tauri::command]
pub fn detached<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    label: String,
) -> Result<(), WireError> {
    answer_detach(&app, &window, &label, Ok(()))
}

/// The calling document window will not take the document of a tab's move:
/// the move ends at once with `reason` and the tab keeps the document.
#[tauri::command]
pub fn refuse_detach<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    label: String,
    reason: String,
) -> Result<(), WireError> {
    answer_detach(&app, &window, &label, Err(reason))
}

fn answer_detach<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    label: &str,
    answer: Result<(), String>,
) -> Result<(), WireError> {
    if window.label() != label {
        return Err(wire_error(
            "Denied",
            "a window answers only for itself",
            None,
        ));
    }
    let tx = state(app)?.lock().detaching.remove(label);
    match tx {
        Some(tx) => {
            // A receiver that is gone has given the move up already.
            let _ = tx.send(answer);
            Ok(())
        }
        None => Err(wire_error(
            "NoDetach",
            format!("no move to window {label} is waiting; this window is closing"),
            None,
        )),
    }
}

/// Opens a new editor window rooted at the folder `root`. Resolves to the
/// window's label. Asked for by the main window and by editor windows.
#[tauri::command]
pub async fn open_editor<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    root: WirePath,
) -> Result<String, WireError> {
    if !matches!(
        window_kind(window.label()),
        Some(WindowKind::Main | WindowKind::Editor)
    ) {
        return Err(wire_error(
            "Denied",
            "only the main window and editor windows open editor windows",
            None,
        ));
    }
    let p = root.to_path_buf()?;
    let q = p.clone();
    // Follows links: a link to a folder is a folder.
    blocking(move || match std::fs::metadata(&q) {
        Ok(m) if m.is_dir() => Ok(()),
        Ok(_) => Err(wire_error("NotAFolder", "that is not a folder", Some(&q))),
        Err(e) => Err(io_error(&q, &e)),
    })
    .await?;
    let st = state(&app)?;
    let label = reserve_editor_label(&app, &st);
    let result = build_editor_window(&app, &label);
    let token = built(&st, &label);
    result?;
    send_directive(&app, &label, &Directive::EditorRoot { path: root })?;
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
    let answer = match blocking(move || Ok(rx.recv_timeout(timeout).ok())).await {
        Ok(a) => a,
        Err(e) => {
            cancel_adoption(&app, &st, &label, &path);
            return Err(e);
        }
    };
    if let Some(Err(reason)) = answer {
        cancel_adoption(&app, &st, &label, &path);
        return Err(wire_error("AdoptRefused", reason, Some(&path)));
    }
    if answer.is_none() {
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
            let _ = tx.send(Ok(()));
            Ok(())
        }
        None => Err(wire_error(
            "NoAdoption",
            format!("no move from window {label} is waiting; drop the tab"),
            None,
        )),
    }
}

/// `main` will not take the document of window `label` (see
/// `move_doc_to_main`): the move ends at once with `reason`, and the window
/// keeps the document.
#[tauri::command]
pub fn refuse_adoption<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    label: String,
    reason: String,
) -> Result<(), WireError> {
    if window.label() != MAIN {
        return Err(wire_error("Denied", "only the main window adopts", None));
    }
    let tx = state(&app)?.lock().adopting.remove(&label);
    match tx {
        Some(tx) => {
            let _ = tx.send(Err(reason));
            Ok(())
        }
        None => Err(wire_error(
            "NoAdoption",
            format!("no move from window {label} is waiting"),
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
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            ask_to_close(window);
        }
        WindowEvent::Destroyed => {
            let app = window.app_handle();
            crate::zoom::forget(app, window.label());
            if let Some(st) = app.try_state::<WindowState>() {
                // Its own document and its tabs; other windows' tabs stay.
                st.open.remove_window(window.label());
                let mut inner = st.lock();
                inner.ready.remove(window.label());
                inner.pending.remove(window.label());
                // A tab's move to this window ends: nothing will answer.
                if let Some(tx) = inner.detaching.remove(window.label()) {
                    let _ = tx.send(Err(
                        "the new window was closed before it took the document".to_owned()
                    ));
                }
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
    match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            if let Some(l) = app.try_state::<Launches>() {
                if !l.exit_requested() {
                    api.prevent_exit();
                }
            }
        }
        tauri::RunEvent::Exit => crate::clipboard::store_on_exit(),
        _ => {}
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
