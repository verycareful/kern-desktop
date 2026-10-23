// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The system clipboard, shared with Dolphin, Nautilus, Thunar and terminals
//! (design 5.8).
//!
//! Copy and cut offer three targets on the `CLIPBOARD` selection:
//!
//! - `x-special/gnome-copied-files`: the GNOME convention, which Dolphin,
//!   Nautilus and Thunar read. An operation line (`copy` or `cut`), then one
//!   `file://` URI per line, no trailing newline.
//! - `text/uri-list`: RFC 2483, section 5. One URI per line, lines ended by
//!   CRLF, lines starting `#` are comments. Read as a copy.
//! - `UTF8_STRING`: the paths, newline separated, so pasting into a
//!   terminal gives paths. A name that is not UTF-8 cannot be exact text;
//!   it is written with U+FFFD for the bytes that are not UTF-8. The two
//!   URI targets stay exact, and a file manager pastes from those. The
//!   alternative, writing such a name in its URI form, would hand a terminal
//!   a string that is no path at all.
//!
//! URIs are `file://` with an empty or `localhost` host (RFC 8089); the
//! encoder and decoder are in [`crate::cli`] and work on bytes, so a name
//! that is not UTF-8 survives a round trip.
//!
//! Reading asks GTK for the contents without waiting on the main thread
//! (`gtk_clipboard_request_contents`) and gives up after [`TIMEOUT`]. A
//! clipboard holding neither target gives `None`. A target that is present
//! but cannot be decoded is an error naming the target. GTK3 reads and
//! writes the clipboard under Wayland only while the window has focus; when
//! GTK refuses ownership that is returned as an error. A read without focus
//! shows no targets, which GTK does not tell apart from an empty clipboard.

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

use gtk::gdk;
use kernkraft_tauri::{WireError, WirePath};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::cli::{file_uri_encode, file_uri_path};
use crate::windows::{blocking, wire_error};

/// The GNOME convention's target.
pub const TARGET_GNOME: &str = "x-special/gnome-copied-files";
/// RFC 2483's target.
pub const TARGET_URI_LIST: &str = "text/uri-list";
/// The X11 text target; GTK maps it to the Wayland text MIME type.
pub const TARGET_TEXT: &str = "UTF8_STRING";

/// How long a command waits for GTK. The clipboard's owner is another
/// process, and one that is busy (a file manager building a large list) can
/// take seconds to answer; 5 s covers that and is short enough that a hung
/// owner is reported while the user still remembers the keypress. The main
/// thread never waits: only the command's own thread does.
pub const TIMEOUT: Duration = Duration::from_secs(5);

/// What a paste does with the files.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipOp {
    Copy,
    Cut,
}

impl ClipOp {
    fn word(self) -> &'static str {
        match self {
            ClipOp::Copy => "copy",
            ClipOp::Cut => "cut",
        }
    }
}

/// A clipboard payload that cannot be read.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("the clipboard's {target} is not usable: {reason}")]
pub struct ClipError {
    pub target: &'static str,
    pub reason: String,
}

fn bad(target: &'static str, reason: impl Into<String>) -> ClipError {
    ClipError {
        target,
        reason: reason.into(),
    }
}

/// `x-special/gnome-copied-files` for `paths`.
pub fn encode_gnome_copied(op: ClipOp, paths: &[PathBuf]) -> Vec<u8> {
    let mut out = String::from(op.word());
    for p in paths {
        out.push('\n');
        out.push_str(&file_uri_encode(p));
    }
    out.into_bytes()
}

/// The lines of a payload, the line end (LF, or CRLF) removed.
fn lines(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    bytes
        .split(|&b| b == b'\n')
        .map(|l| l.strip_suffix(b"\r").unwrap_or(l))
}

fn uri_path(target: &'static str, line: &[u8]) -> Result<PathBuf, ClipError> {
    file_uri_path(OsStr::from_bytes(line))
        .map_err(|why| bad(target, format!("{}: {why}", String::from_utf8_lossy(line))))
}

/// Reads `x-special/gnome-copied-files`. A trailing line end and empty
/// lines are tolerated; the operation must be `copy` or `cut`, and there
/// must be at least one path, each a local `file://` URI.
pub fn try_decode_gnome_copied(bytes: &[u8]) -> Result<(ClipOp, Vec<PathBuf>), ClipError> {
    let mut it = lines(bytes);
    let op = match it.next().unwrap_or_default() {
        b"copy" => ClipOp::Copy,
        b"cut" => ClipOp::Cut,
        other => {
            return Err(bad(
                TARGET_GNOME,
                format!(
                    "the first line is {:?}, not copy or cut",
                    String::from_utf8_lossy(other)
                ),
            ))
        }
    };
    let paths = it
        .filter(|l| !l.is_empty())
        .map(|l| uri_path(TARGET_GNOME, l))
        .collect::<Result<Vec<_>, _>>()?;
    if paths.is_empty() {
        return Err(bad(TARGET_GNOME, "it names no files"));
    }
    Ok((op, paths))
}

/// [`try_decode_gnome_copied`] without the reason.
pub fn decode_gnome_copied(bytes: &[u8]) -> Option<(ClipOp, Vec<PathBuf>)> {
    try_decode_gnome_copied(bytes).ok()
}

/// `text/uri-list` for `paths`: each URI ends CRLF (RFC 2483, section 5).
pub fn encode_uri_list(paths: &[PathBuf]) -> Vec<u8> {
    let mut out = String::new();
    for p in paths {
        out.push_str(&file_uri_encode(p));
        out.push_str("\r\n");
    }
    out.into_bytes()
}

/// Reads `text/uri-list`: comment lines (`#`) and empty lines are skipped,
/// a bare LF ends a line as well as CRLF, and there must be at least one
/// URI, each a local `file://` URI.
pub fn try_decode_uri_list(bytes: &[u8]) -> Result<Vec<PathBuf>, ClipError> {
    let paths = lines(bytes)
        .filter(|l| !l.is_empty() && !l.starts_with(b"#"))
        .map(|l| uri_path(TARGET_URI_LIST, l))
        .collect::<Result<Vec<_>, _>>()?;
    if paths.is_empty() {
        return Err(bad(TARGET_URI_LIST, "it names no files"));
    }
    Ok(paths)
}

/// [`try_decode_uri_list`] without the reason.
pub fn decode_uri_list(bytes: &[u8]) -> Option<Vec<PathBuf>> {
    try_decode_uri_list(bytes).ok()
}

/// The `UTF8_STRING` target: the paths, newline separated, with U+FFFD for
/// bytes that are not UTF-8.
pub fn encode_utf8_text(paths: &[PathBuf]) -> Vec<u8> {
    paths
        .iter()
        .map(|p| p.to_string_lossy())
        .collect::<Vec<_>>()
        .join("\n")
        .into_bytes()
}

/// What is on the clipboard for a paste.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ClipContents {
    pub op: ClipOp,
    pub paths: Vec<WirePath>,
}

fn clip_error(e: &ClipError) -> WireError {
    wire_error("Clipboard", e.to_string(), None)
}

/// Runs `f` on the GTK main thread and waits for the value it sends, up to
/// [`TIMEOUT`]. `f` may hand the sender on to a GTK callback.
pub(crate) async fn on_main<R, T, F>(app: &AppHandle<R>, f: F) -> Result<T, WireError>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(Sender<Result<T, WireError>>) + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || f(tx))
        .map_err(|e| wire_error("Clipboard", format!("the main thread is gone: {e}"), None))?;
    blocking(move || match rx.recv_timeout(TIMEOUT) {
        Ok(r) => r,
        Err(RecvTimeoutError::Timeout) => Err(wire_error(
            "Timeout",
            format!(
                "no answer from the clipboard or the window system in {} s",
                TIMEOUT.as_secs()
            ),
            None,
        )),
        Err(RecvTimeoutError::Disconnected) => Err(wire_error(
            "Clipboard",
            "the clipboard request was dropped before it answered",
            None,
        )),
    })
    .await
}

fn paths_of(list: &[PathBuf]) -> Result<Vec<PathBuf>, WireError> {
    if list.is_empty() {
        return Err(wire_error("InvalidArgument", "no files to copy", None));
    }
    Ok(list.to_vec())
}

fn decode_wire(paths: Vec<WirePath>) -> Result<Vec<PathBuf>, WireError> {
    let list = paths
        .iter()
        .map(|p| {
            p.to_path_buf()
                .map_err(|e| wire_error("BadPath", e.to_string(), None))
        })
        .collect::<Result<Vec<_>, _>>()?;
    paths_of(&list)
}

/// Puts `paths` on the system clipboard for a paste elsewhere.
#[tauri::command]
pub async fn clip_set<R: Runtime>(
    app: AppHandle<R>,
    op: ClipOp,
    paths: Vec<WirePath>,
) -> Result<(), WireError> {
    let paths = decode_wire(paths)?;
    let gnome = encode_gnome_copied(op, &paths);
    let uris = encode_uri_list(&paths);
    let text = encode_utf8_text(&paths);
    on_main(&app, move |tx| {
        let _ = tx.send(set_files(gnome, uris, text));
    })
    .await
}

fn set_files(gnome: Vec<u8>, uris: Vec<u8>, text: Vec<u8>) -> Result<(), WireError> {
    let targets = [
        gtk::TargetEntry::new(TARGET_GNOME, gtk::TargetFlags::empty(), 0),
        gtk::TargetEntry::new(TARGET_URI_LIST, gtk::TargetFlags::empty(), 1),
        gtk::TargetEntry::new(TARGET_TEXT, gtk::TargetFlags::empty(), 2),
    ];
    let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
    let owned = clipboard.set_with_data(&targets, move |_, data, info| {
        let (name, bytes) = match info {
            0 => (TARGET_GNOME, &gnome),
            1 => (TARGET_URI_LIST, &uris),
            2 => (TARGET_TEXT, &text),
            _ => return,
        };
        data.set(&gdk::Atom::intern(name), 8, bytes);
    });
    if owned {
        Ok(())
    } else {
        Err(wire_error(
            "Clipboard",
            "GTK would not give Kern the clipboard (under Wayland the window must have focus)",
            None,
        ))
    }
}

/// Puts text on the system clipboard (Copy path).
#[tauri::command]
pub async fn clip_text<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), WireError> {
    on_main(&app, move |tx| {
        gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD).set_text(&text);
        let _ = tx.send(Ok(()));
    })
    .await
}

/// The files on the system clipboard, if any: `x-special/gnome-copied-files`
/// first, then `text/uri-list` (a copy).
#[tauri::command]
pub async fn clip_get<R: Runtime>(app: AppHandle<R>) -> Result<Option<ClipContents>, WireError> {
    on_main(&app, request_files).await
}

fn contents(op: ClipOp, paths: &[PathBuf]) -> ClipContents {
    ClipContents {
        op,
        paths: paths.iter().map(|p| WirePath::from(p.as_path())).collect(),
    }
}

fn request_files(tx: Sender<Result<Option<ClipContents>, WireError>>) {
    let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
    clipboard.request_contents(&gdk::Atom::intern(TARGET_GNOME), move |clipboard, data| {
        // A negative length is GTK's answer for a target the owner lacks.
        if data.length() >= 0 {
            let r = try_decode_gnome_copied(&data.data())
                .map(|(op, paths)| Some(contents(op, &paths)))
                .map_err(|e| clip_error(&e));
            let _ = tx.send(r);
            return;
        }
        clipboard.request_contents(&gdk::Atom::intern(TARGET_URI_LIST), move |_, data| {
            let r = if data.length() >= 0 {
                try_decode_uri_list(&data.data())
                    .map(|paths| Some(contents(ClipOp::Copy, &paths)))
                    .map_err(|e| clip_error(&e))
            } else {
                Ok(None)
            };
            let _ = tx.send(r);
        });
    });
}
