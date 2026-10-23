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
//! In: Tauri's own handling of a drop from another application is forwarded
//! as [`EVENT_DROP`], `{ paths, position }`. The frontend decides copy or
//! move (Ctrl copies, Shift moves, otherwise a move on the same filesystem
//! and a copy across) and calls `start_op`.

use std::cell::RefCell;
use std::path::PathBuf;

use gtk::gdk;
use gtk::glib::SignalHandlerId;
use gtk::prelude::*;
use kernkraft_tauri::{WireError, WirePath};
use serde::Serialize;
use tauri::{DragDropEvent, Emitter, Manager, Runtime, WebviewWindow, Window};

use crate::clipboard::{encode_uri_list, on_main, TARGET_URI_LIST};
use crate::windows::wire_error;

/// A drop from another application: `{ paths, position }`, sent to the
/// window that received it.
pub const EVENT_DROP: &str = "kern://drop";

/// The pointer at a drop, in physical pixels from the webview's top left
/// corner (Tauri's `DragDropEvent::Drop`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct DropPosition {
    pub x: f64,
    pub y: f64,
}

/// The payload of [`EVENT_DROP`].
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DropPayload {
    pub paths: Vec<WirePath>,
    pub position: DropPosition,
}

/// The payload for a drop of `paths` at `(x, y)`.
pub fn drop_payload(paths: &[PathBuf], x: f64, y: f64) -> DropPayload {
    DropPayload {
        paths: paths.iter().map(|p| WirePath::from(p.as_path())).collect(),
        position: DropPosition { x, y },
    }
}

/// Window events: a drop is forwarded to the window's frontend. Enter, over
/// and leave are not (the frontend highlights from its own pointer events).
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) = event {
        let payload = drop_payload(paths, position.x, position.y);
        if let Err(e) = window.emit_to(window.label(), EVENT_DROP, payload) {
            eprintln!("kern: could not forward a drop to {}: {e}", window.label());
        }
    }
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
