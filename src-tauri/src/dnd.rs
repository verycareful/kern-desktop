// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Drag and drop with other applications (design 5.8).
//!
//! Out: [`drag_out`] starts a native GTK drag from the calling window that
//! offers `text/uri-list` (RFC 2483, the same bytes the clipboard offers)
//! with the copy and move actions, so a terminal types the path, a browser
//! fills an upload field and a file manager copies or moves. Kern never
//! deletes or moves a source file because of a drag-out, whatever action the
//! target reports: `drag-end` only removes the drag source set up for it.
//!
//! The `drag` crate (CrabNebula) was evaluated and not used. Its GTK backend
//! writes each URI as `file://` followed by the path's display text, without
//! escaping, so a name with a space, `%`, `#` or `?` is a wrong URI and a
//! name that is not UTF-8 is altered; it offers copy or move, not both; and
//! it unwraps the pointer position. It would also add `gdkx11`.
//!
//! In: Kern takes the drop on the webview widget itself ([`plugin`]), with
//! Tauri's own drag and drop handling switched off for every window
//! (`dragDropEnabled: false` for the main window, `disable_drag_drop_handler`
//! for document windows). Tauri's `DragDropEvent` carries no drag action, its
//! handler decodes each URI lossily (a name that is not UTF-8 would become
//! another path), and its handler consumes the `drag-drop` signal, so a
//! second handler on the same widget would never run. The handlers here:
//!
//! - `drag-motion` accepts a drag that offers `text/uri-list` and at least one
//!   of copy and move, answering with [`accept_action`], and declines one that
//!   offers neither (link only), so the pointer shows what will happen. Any
//!   other drag (text, for a field in the page) is left to WebKit.
//! - `drag-drop` records where the pointer is and asks for the file list;
//!   `drag-data-received` decodes it byte for byte ([`uri_list_paths`]) and
//!   sends it to the window as [`EVENT_DROP`]. The drop is finished with
//!   `delete` unset: Kern moves or copies by itself, and the source is never
//!   asked to delete anything.
//!
//! [`EVENT_DROP`] carries the paths, the pointer's position and the size of
//! the webview in the same units (so the frontend finds the row under the
//! pointer at any scale or interface size by the ratio of the two), the
//! actions the other application offers, and the action GTK negotiated. The
//! frontend obeys an application that offers exactly one of copy and move and
//! otherwise asks the filesystems per item (copy across filesystems, move on
//! one). The negotiated action is carried but decides nothing: with both
//! offered, it cannot be told from the destination's own default.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use gtk::gdk::{self, DragAction};
use gtk::glib::SignalHandlerId;
use gtk::prelude::*;
use kernkraft_tauri::{WireError, WirePath};
use serde::Serialize;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Manager, Runtime, Webview, WebviewWindow};

use crate::clipboard::{
    encode_uri_list, on_main, refuse_dot_segments, try_decode_uri_list, TARGET_URI_LIST,
};
use crate::windows::wire_error;

/// A drop from another application, sent to the window that received it.
pub const EVENT_DROP: &str = "kern://drop";

/// Where the pointer was at a drop, and how big the webview was, in the
/// webview's own units (GTK widget coordinates).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DropGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The pointer at a drop, from the webview's top left corner.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct DropPosition {
    pub x: f64,
    pub y: f64,
}

/// The size of the webview, in the units of [`DropPosition`].
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct DropView {
    pub width: f64,
    pub height: f64,
}

/// The payload of [`EVENT_DROP`].
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DropPayload {
    pub paths: Vec<WirePath>,
    pub position: DropPosition,
    pub view: DropView,
    /// What the other application allows: `copy`, `move`, `link`, `ask`, in
    /// that order.
    pub offered: Vec<&'static str>,
    /// The action GTK negotiated, one of the same names, or null when it is
    /// not exactly one of them.
    pub selected: Option<&'static str>,
}

/// The names of the actions in `actions`: `copy`, `move`, `link`, `ask`, in
/// that order.
pub fn action_names(actions: DragAction) -> Vec<&'static str> {
    [
        (DragAction::COPY, "copy"),
        (DragAction::MOVE, "move"),
        (DragAction::LINK, "link"),
        (DragAction::ASK, "ask"),
    ]
    .into_iter()
    .filter(|(flag, _)| actions.contains(*flag))
    .map(|(_, name)| name)
    .collect()
}

/// The name of `action` when it is exactly one of the four named ones.
fn single_action(action: DragAction) -> Option<&'static str> {
    match action_names(action)[..] {
        [name] if action.bits().count_ones() == 1 => Some(name),
        _ => None,
    }
}

/// The action Kern answers a drag with while the pointer is over the window,
/// which is what the pointer then shows: the action GTK suggests (it follows
/// the modifier keys) when it is copy or move and the other application offers
/// it, else copy, else move. Empty when the drag offers neither, which
/// declines the drop.
pub fn accept_action(offered: DragAction, suggested: DragAction) -> DragAction {
    let usable = offered & (DragAction::COPY | DragAction::MOVE);
    if suggested == DragAction::COPY && usable.contains(DragAction::COPY) {
        DragAction::COPY
    } else if suggested == DragAction::MOVE && usable.contains(DragAction::MOVE) {
        DragAction::MOVE
    } else if usable.contains(DragAction::COPY) {
        DragAction::COPY
    } else if usable.contains(DragAction::MOVE) {
        DragAction::MOVE
    } else {
        DragAction::empty()
    }
}

/// True when the drag offers a list of files (`text/uri-list`).
pub fn offers_files<I, S>(targets: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    targets.into_iter().any(|t| t.as_ref() == TARGET_URI_LIST)
}

/// The paths a dropped `text/uri-list` names, byte for byte. A URI that is not
/// a local file and a list that names no file are errors. A `.` or `..`
/// segment in a URI is resolved textually, as RFC 3986 section 5.2.4 says a URI
/// means, which is what the application that made the list meant by it.
pub fn uri_list_paths(bytes: &[u8]) -> Result<Vec<PathBuf>, WireError> {
    try_decode_uri_list(bytes).map_err(|e| {
        wire_error(
            "Drop",
            format!(
                "the dropped files could not be read: the {} is not usable: {}",
                e.target, e.reason
            ),
            None,
        )
    })
}

/// The payload for a drop of `paths`.
pub fn drop_payload(
    paths: &[PathBuf],
    at: DropGeometry,
    offered: DragAction,
    selected: DragAction,
) -> DropPayload {
    DropPayload {
        paths: paths.iter().map(|p| WirePath::from(p.as_path())).collect(),
        position: DropPosition { x: at.x, y: at.y },
        view: DropView {
            width: at.width,
            height: at.height,
        },
        offered: action_names(offered),
        selected: single_action(selected),
    }
}

/// The drop being collected: where it was and what was offered, until its
/// file list arrives.
struct Pending {
    at: DropGeometry,
    offered: DragAction,
    selected: DragAction,
}

fn target_names(context: &gdk::DragContext) -> Vec<String> {
    context
        .list_targets()
        .iter()
        .map(|a| a.name().to_string())
        .collect()
}

/// Sends a drop to the webview's page, or tells the user why it could not be.
fn deliver<R: Runtime>(webview: &Webview<R>, payload: DropPayload) {
    if let Err(e) = webview.emit_to(webview.label(), EVENT_DROP, payload) {
        // The drop is lost; say so in the user's window.
        let err = wire_error(
            "Drop",
            format!("a dropped file could not be passed to the window: {e}"),
            None,
        );
        crate::windows::show_errors(webview.app_handle(), &[err], "");
    }
}

/// Takes drops of files on `view`, the webview's widget, and sends them to
/// `webview`'s page. Returns the handlers so a test of the wiring could
/// remove them; the webview keeps them for its lifetime.
fn connect<R: Runtime, W: IsA<gtk::Widget>>(view: &W, webview: Webview<R>) -> Vec<SignalHandlerId> {
    let pending: Rc<RefCell<Option<Pending>>> = Rc::default();
    let uri_list = gdk::Atom::intern(TARGET_URI_LIST);

    let motion = view.connect_drag_motion(|_, context, _, _, time| {
        if !offers_files(target_names(context)) {
            return false;
        }
        context.drag_status(
            accept_action(context.actions(), context.suggested_action()),
            time,
        );
        true
    });

    let dropped = {
        let pending = pending.clone();
        view.connect_drag_drop(move |widget, context, x, y, time| {
            if !offers_files(target_names(context)) {
                return false;
            }
            *pending.borrow_mut() = Some(Pending {
                at: DropGeometry {
                    x: f64::from(x),
                    y: f64::from(y),
                    width: f64::from(widget.allocated_width()),
                    height: f64::from(widget.allocated_height()),
                },
                offered: context.actions(),
                selected: context.selected_action(),
            });
            widget.drag_get_data(context, &uri_list, time);
            true
        })
    };

    let received = view.connect_drag_data_received(move |widget, context, _, _, data, _, time| {
        // Data Kern did not ask for (WebKit's own drags) is WebKit's.
        let Some(drop) = pending.borrow_mut().take() else {
            return;
        };
        widget.stop_signal_emission_by_name("drag-data-received");
        let paths = if data.length() < 0 {
            Err(wire_error(
                "Drop",
                "the other application gave no list of files for the drop",
                None,
            ))
        } else {
            uri_list_paths(&data.data())
        };
        match paths {
            Ok(paths) => {
                deliver(
                    &webview,
                    drop_payload(&paths, drop.at, drop.offered, drop.selected),
                );
                context.drag_finish(true, false, time);
            }
            Err(e) => {
                crate::windows::show_errors(webview.app_handle(), &[e], "");
                context.drag_finish(false, false, time);
            }
        }
    });

    vec![motion, dropped, received]
}

/// The plugin that lets every webview take drops of files. Register it
/// before the first window is created.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("kern-dnd")
        .on_webview_ready(|webview| {
            let target = webview.clone();
            let attached = webview.with_webview(move |platform| {
                connect(&platform.inner(), target);
            });
            // No window can show it and there is no log; stderr is what a
            // terminal launch or the journal shows.
            if let Err(e) = attached {
                eprintln!("kern: could not take drops on {}: {e}", webview.label());
            }
        })
        .build()
}

/// The drag in progress: the window it was set up on and its handlers.
struct Active {
    window: gtk::ApplicationWindow,
    handlers: Vec<SignalHandlerId>,
}

thread_local! {
    // GTK objects live on the main thread, which is the only one that
    // touches this.
    static ACTIVE: RefCell<Option<Active>> = const { RefCell::new(None) };
}

/// Ends the drag source set up by the last [`drag_out`], if any.
fn finish() {
    if let Some(a) = ACTIVE.with(|c| c.borrow_mut().take()) {
        for id in a.handlers {
            a.window.disconnect(id);
        }
        a.window.drag_source_unset();
    }
}

fn begin(window: &gtk::ApplicationWindow, uris: Vec<u8>) -> Result<(), WireError> {
    finish();
    let actions = gdk::DragAction::COPY | gdk::DragAction::MOVE;
    let targets = [gtk::TargetEntry::new(
        TARGET_URI_LIST,
        gtk::TargetFlags::OTHER_APP,
        0,
    )];
    window.drag_source_set(gdk::ModifierType::BUTTON1_MASK, &targets, actions);
    let atom = gdk::Atom::intern(TARGET_URI_LIST);
    let get = window.connect_drag_data_get(move |_, _, data, _, _| {
        data.set(&atom, 8, &uris);
    });
    let end = window.connect_drag_end(|_, _| finish());
    ACTIVE.with(|c| {
        *c.borrow_mut() = Some(Active {
            window: window.clone(),
            handlers: vec![get, end],
        });
    });
    let started = window
        .drag_source_get_target_list()
        .and_then(|list| window.drag_begin_with_coordinates(&list, actions, 1, None, -1, -1));
    match started {
        Some(_) => Ok(()),
        None => {
            finish();
            Err(wire_error(
                "Drag",
                "GTK would not start the drag (it needs the pointer button held in the window)",
                None,
            ))
        }
    }
}

/// Starts a native drag of `paths` out of the calling window.
#[tauri::command]
pub async fn drag_out<R: Runtime>(
    window: WebviewWindow<R>,
    paths: Vec<WirePath>,
) -> Result<(), WireError> {
    let list = paths
        .iter()
        .map(|p| {
            p.to_path_buf()
                .map_err(|e| wire_error("BadPath", e.to_string(), None))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if list.is_empty() {
        return Err(wire_error("InvalidArgument", "no files to drag", None));
    }
    refuse_dot_segments(&list)?;
    let uris = encode_uri_list(&list);
    let app = window.app_handle().clone();
    on_main(&app, move |tx| {
        let r = window
            .gtk_window()
            .map_err(|e| wire_error("Window", format!("no GTK window: {e}"), None))
            .and_then(|w| begin(&w, uris));
        let _ = tx.send(r);
    })
    .await
}
