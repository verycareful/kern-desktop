// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! `org.freedesktop.FileManager1`, so another application's "Show in
//! folder" opens Kern.
//!
//! Interface: freedesktop.org wiki, Specifications/file-manager-interface.
//! Object `/org/freedesktop/FileManager1`, methods `ShowFolders(as URIs, s
//! StartupId)`, `ShowItems(as URIs, s StartupId)` and
//! `ShowItemProperties(as URIs, s StartupId)`. The startup id is a startup
//! notification id or an xdg-activation token, and is used as the latter.
//! URIs are `file:` URIs (RFC 8089), decoded per RFC 3986 section 2.1 the
//! way command-line arguments are; only an empty host or `localhost` is
//! accepted.
//!
//! The service is served on the connection `instance` opened (from
//! `kernkraft-bus`, a Unix socket only). The name is requested with
//! `DoNotQueue` (D-Bus Specification, "Message Bus Names"): another file
//! manager that holds it is reported in [`Fm1Status`] and never displaced.
//! Kern does not allow replacement: once owned, the name is held until the
//! process exits, so a choice of Kern as file manager is not undone by
//! another application starting later.
//!
//! A call is a launch: it is counted in [`Launches`] before the method
//! returns, so an exiting instance does not drop it, and an instance that
//! is already exiting refuses it. D-Bus activation when Kern is not running
//! needs a service file, which packaging installs.
//!
//! Frontend contract, beyond `kern://open` (a folder tab):
//! - `kern://select { tab, paths }`: select `paths` in the folder tab of
//!   the folder `tab`, sent right after the directive that opens it.
//! - `kern://properties { paths }`: show the Properties of `paths`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, PoisonError};

use kernkraft_tauri::{WireError, WirePath};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Manager, Runtime};
use zbus::blocking::fdo::DBusProxy;
use zbus::blocking::Connection;
use zbus::fdo::{RequestNameFlags, RequestNameReply};
use zbus::names::BusName;

use crate::cli::{file_uri_path, ArgError};
use crate::instance::{exiting, InstanceError, Launches};
use crate::open::{Gesture, Origin};
use crate::windows::{
    arg_error, ensure_main, focus, io_error, launch_finished, open_paths_impl, send, show_errors,
    wire_error, EVENT_PROPERTIES, EVENT_SELECT, MAIN,
};

pub const BUS_NAME: &str = "org.freedesktop.FileManager1";
pub const OBJECT_PATH: &str = "/org/freedesktop/FileManager1";
pub const INTERFACE: &str = "org.freedesktop.FileManager1";

/// Which method was called.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Call {
    ShowFolders,
    ShowItems,
    ShowItemProperties,
}

/// One accepted call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub call: Call,
    /// The usable URIs, as paths.
    pub paths: Vec<PathBuf>,
    /// The URIs that were refused; they are reported with the rest.
    pub refused: Vec<ArgError>,
    /// The startup id, empty when none was given.
    pub token: String,
}

/// The URIs of a call as paths, and the URIs that were refused.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UriBatch {
    pub paths: Vec<PathBuf>,
    pub refused: Vec<ArgError>,
}

/// Decodes `uris` in order; every URI gives a path or a refusal.
pub fn uris_to_paths(uris: &[String]) -> UriBatch {
    let mut out = UriBatch::default();
    for uri in uris {
        let arg = std::ffi::OsString::from(uri);
        match file_uri_path(&arg) {
            Ok(p) => out.paths.push(p),
            Err(reason) => out.refused.push(ArgError { arg, reason }),
        }
    }
    out
}

/// A folder and the items of it to select.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Group {
    pub folder: PathBuf,
    pub items: Vec<PathBuf>,
}

/// Groups `paths` by parent folder, in order of first appearance, each item
/// once. A path with no parent (the root) is its own folder with nothing to
/// select.
pub fn group_by_parent(paths: &[PathBuf]) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    let mut index: HashMap<PathBuf, usize> = HashMap::new();
    let mut seen: HashSet<&Path> = HashSet::new();
    for p in paths {
        let (folder, item) = match p.parent() {
            Some(parent) => (parent.to_path_buf(), Some(p.clone())),
            None => (p.clone(), None),
        };
        let i = *index.entry(folder.clone()).or_insert_with(|| {
            groups.push(Group {
                folder,
                items: Vec::new(),
            });
            groups.len() - 1
        });
        if let Some(item) = item {
            if seen.insert(p.as_path()) {
                groups[i].items.push(item);
            }
        }
    }
    groups
}

/// Whether Kern serves the interface.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Fm1Status {
    pub owned: bool,
    /// The unique name of the connection that owns the well-known name:
    /// Kern's own when `owned`, the other file manager's when not.
    pub owner: Option<String>,
    /// Why the service is not served, when it is not.
    pub reason: Option<String>,
}

/// The status of the service, shared with the commands that read it.
#[derive(Clone, Debug)]
pub struct Fm1State(Arc<Mutex<Fm1Status>>);

impl Fm1State {
    pub fn new(status: Fm1Status) -> Fm1State {
        Fm1State(Arc::new(Mutex::new(status)))
    }

    pub fn get(&self) -> Fm1Status {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// The status when there is no session bus.
    pub fn unavailable(reason: &str) -> Fm1State {
        Fm1State::new(Fm1Status {
            owned: false,
            owner: None,
            reason: Some(reason.to_owned()),
        })
    }
}

struct Fm1 {
    tx: Sender<Request>,
    launches: Launches,
}

impl Fm1 {
    fn accept(&self, call: Call, uris: &[String], startup_id: String) -> zbus::fdo::Result<()> {
        let batch = uris_to_paths(uris);
        if batch.paths.is_empty() {
            let why = if batch.refused.is_empty() {
                "no URIs given".to_owned()
            } else {
                batch
                    .refused
                    .iter()
                    .map(ArgError::to_string)
                    .collect::<Vec<_>>()
                    .join("; ")
            };
            return Err(zbus::fdo::Error::InvalidArgs(format!(
                "no usable file URI: {why}"
            )));
        }
        if !self.launches.begin() {
            return Err(exiting());
        }
        let req = Request {
            call,
            paths: batch.paths,
            refused: batch.refused,
            token: startup_id,
        };
        if self.tx.send(req).is_err() {
            self.launches.finish();
            return Err(exiting());
        }
        Ok(())
    }
}

#[zbus::interface(name = "org.freedesktop.FileManager1")]
impl Fm1 {
    fn show_folders(&self, uris: Vec<String>, startup_id: String) -> zbus::fdo::Result<()> {
        self.accept(Call::ShowFolders, &uris, startup_id)
    }

    fn show_items(&self, uris: Vec<String>, startup_id: String) -> zbus::fdo::Result<()> {
        self.accept(Call::ShowItems, &uris, startup_id)
    }

    fn show_item_properties(&self, uris: Vec<String>, startup_id: String) -> zbus::fdo::Result<()> {
        self.accept(Call::ShowItemProperties, &uris, startup_id)
    }
}

/// What [`serve`] set up.
pub struct Service {
    pub status: Fm1State,
    /// Accepted calls, each already counted in [`Launches`].
    pub requests: Receiver<Request>,
}

fn owner_of(conn: &Connection, name: &str) -> (Option<String>, Option<String>) {
    let looked_up = BusName::try_from(name)
        .map_err(zbus::Error::from)
        .and_then(|n| DBusProxy::new(conn)?.get_name_owner(n).map_err(Into::into));
    match looked_up {
        Ok(owner) => (Some(owner.to_string()), None),
        Err(e) => (None, Some(format!("could not tell who owns {name}: {e}"))),
    }
}

/// What to add to the status when taking the unused object off the bus
/// failed (`Err`) or found nothing to take off (`Ok(false)`); `None` when
/// it was removed.
pub fn removal_note(removed: zbus::Result<bool>) -> Option<String> {
    match removed {
        Ok(true) => None,
        Ok(false) => {
            Some("the unused object was not registered, which should not happen".to_owned())
        }
        Err(e) => Some(format!("could not remove the unused object: {e}")),
    }
}

/// Serves [`INTERFACE`] on `conn` and requests `name` without queueing. The
/// object is served first so that a caller that sees the name finds it.
/// When another connection owns the name the object is removed again and
/// the status says who owns it.
pub fn serve(conn: &Connection, name: &str, launches: Launches) -> Result<Service, InstanceError> {
    let (tx, requests) = mpsc::channel();
    conn.object_server().at(OBJECT_PATH, Fm1 { tx, launches })?;
    let flags = RequestNameFlags::DoNotQueue.into();
    let owned = match conn.request_name_with_flags(name, flags) {
        Ok(RequestNameReply::PrimaryOwner | RequestNameReply::AlreadyOwner) => true,
        Ok(RequestNameReply::Exists | RequestNameReply::InQueue) | Err(zbus::Error::NameTaken) => {
            false
        }
        Err(e) => {
            let _ = conn.object_server().remove::<Fm1, _>(OBJECT_PATH);
            return Err(e.into());
        }
    };
    let state = if owned {
        let own = conn.unique_name().map(ToString::to_string);
        Fm1State::new(Fm1Status {
            owned: true,
            owner: own,
            reason: None,
        })
    } else {
        // Nothing will be called on this connection.
        let removed = conn.object_server().remove::<Fm1, _>(OBJECT_PATH);
        let (owner, problem) = owner_of(conn, name);
        let mut reason =
            problem.unwrap_or_else(|| format!("another file manager already owns {name}"));
        if let Some(note) = removal_note(removed) {
            reason.push_str("; ");
            reason.push_str(&note);
        }
        Fm1State::new(Fm1Status {
            owned: false,
            owner,
            reason: Some(reason),
        })
    };
    Ok(Service {
        status: state,
        requests,
    })
}

fn push_unique(errors: &mut Vec<WireError>, e: WireError) {
    if !errors.contains(&e) {
        errors.push(e);
    }
}

/// Does what `req` asks and returns every problem, in order: refused URIs
/// first. Nothing is shown; [`handle`] does that.
pub async fn run<R: Runtime>(app: &AppHandle<R>, req: Request) -> Vec<WireError> {
    let token = req.token.as_str();
    let mut errors: Vec<WireError> = Vec::new();
    for e in &req.refused {
        push_unique(&mut errors, arg_error(e));
    }
    match req.call {
        Call::ShowFolders => show_folders(app, &req.paths, token, &mut errors).await,
        Call::ShowItems => show_items(app, &req.paths, token, &mut errors).await,
        Call::ShowItemProperties => show_properties(app, &req.paths, token, &mut errors).await,
    }
    errors
}

/// The opened folders are routed as for any outside request (design D4.3);
/// a path that is not a folder is reported, not opened as a document.
async fn show_folders<R: Runtime>(
    app: &AppHandle<R>,
    paths: &[PathBuf],
    token: &str,
    errors: &mut Vec<WireError>,
) {
    let mut folders = Vec::new();
    for p in paths {
        match std::fs::metadata(p) {
            Ok(m) if m.is_dir() => folders.push(p.clone()),
            Ok(_) => push_unique(
                errors,
                wire_error("NotAFolder", "not a folder", Some(p.as_path())),
            ),
            Err(e) => push_unique(errors, io_error(p, &e)),
        }
    }
    if folders.is_empty() {
        return;
    }
    for o in open_paths_impl(app, folders, Origin::Outside, Gesture::Default, token).await {
        if let Some(e) = o.error {
            push_unique(errors, e);
        }
    }
}

async fn show_items<R: Runtime>(
    app: &AppHandle<R>,
    paths: &[PathBuf],
    token: &str,
    errors: &mut Vec<WireError>,
) {
    for group in group_by_parent(paths) {
        // A link is an item as itself, so a dangling one is still selected.
        let mut present: Vec<&Path> = Vec::new();
        for item in &group.items {
            match std::fs::symlink_metadata(item) {
                Ok(_) => present.push(item),
                Err(e) => push_unique(errors, io_error(item, &e)),
            }
        }
        let opened = open_paths_impl(
            app,
            vec![group.folder.clone()],
            Origin::Outside,
            Gesture::Default,
            token,
        )
        .await;
        let mut failed = false;
        for o in opened {
            if let Some(e) = o.error {
                failed = true;
                push_unique(errors, e);
            }
        }
        if failed || present.is_empty() {
            continue;
        }
        let payload = json!({
            "tab": WirePath::from(group.folder.as_path()),
            "paths": present.iter().map(|p| WirePath::from(*p)).collect::<Vec<_>>(),
        });
        if let Err(e) = send(app, MAIN, EVENT_SELECT, payload) {
            push_unique(errors, e);
        }
    }
}

async fn show_properties<R: Runtime>(
    app: &AppHandle<R>,
    paths: &[PathBuf],
    token: &str,
    errors: &mut Vec<WireError>,
) {
    let mut present = Vec::new();
    let mut present_paths: Vec<&Path> = Vec::new();
    for p in paths {
        match std::fs::symlink_metadata(p) {
            Ok(_) => {
                present.push(WirePath::from(p.as_path()));
                present_paths.push(p);
            }
            Err(e) => push_unique(errors, io_error(p, &e)),
        }
    }
    if present.is_empty() {
        return;
    }
    // Never an empty main: with no main window yet, it opens on the folder
    // of the first item (design ruling R42).
    if app.get_webview_window(MAIN).is_none() {
        let first = present_paths[0];
        let folder = first.parent().unwrap_or(first).to_path_buf();
        let opened =
            open_paths_impl(app, vec![folder], Origin::Outside, Gesture::Default, token).await;
        for e in opened.into_iter().filter_map(|o| o.error) {
            push_unique(errors, e);
        }
    }
    let shown = ensure_main(app)
        .and_then(|_| send(app, MAIN, EVENT_PROPERTIES, json!({ "paths": present })))
        .and_then(|()| focus(app, MAIN, token));
    if let Err(e) = shown {
        push_unique(errors, e);
    }
}

/// [`run`], then shows each problem in `main`.
pub async fn handle<R: Runtime>(app: &AppHandle<R>, req: Request) {
    let token = req.token.clone();
    let errors = run(app, req).await;
    show_errors(app, &errors, &token);
}

/// Starts the thread that applies accepted calls. Each was counted in
/// [`Launches`] when it was accepted.
pub fn serve_requests<R: Runtime>(app: AppHandle<R>, requests: Receiver<Request>) {
    std::thread::spawn(move || {
        for req in requests {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                handle(&app, req).await;
                launch_finished(&app);
            });
        }
    });
}

/// Whether Kern serves `org.freedesktop.FileManager1`, and if not why.
#[tauri::command]
pub fn fm1_status(state: tauri::State<'_, Fm1State>) -> Fm1Status {
    state.get()
}
