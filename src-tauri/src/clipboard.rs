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
//! - `application/x-kde-cutselection`, on a cut only, with the content `1`.
//!   Dolphin and other KIO applications decide cut or copy from it (KIO's
//!   `setClipboardDataCut` writes it and `isClipboardDataCut` reads it),
//!   not from the GNOME target. On a read, a `text/uri-list` carrying it
//!   with `1` is a cut.
//! - The text targets `STRING`, `TEXT`, `text/plain` and `UTF8_STRING`
//!   (GTK's set of text targets, so X11 clients find one they ask for): the
//!   paths, newline separated, so pasting into a
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
//! A path with a `.` or `..` segment is refused: another application
//! collapses such segments textually (RFC 3986, section 5.2.4), which names
//! a different file when a symbolic link is involved.
//!
//! Reading asks GTK for the contents without waiting on the main thread
//! (`gtk_clipboard_request_contents`) and gives up after [`TIMEOUT`]. A
//! clipboard holding neither target gives `None`. A target that is present
//! but cannot be decoded is an error naming the target. GTK3 reads and
//! writes the clipboard under Wayland only while the window has focus, and
//! neither a read nor a write reports the refusal (a read shows no targets,
//! a write still returns success), so every command first requires that the
//! calling window is focused and fails with `NoFocus` otherwise.

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use gtk::gdk;
use kernkraft_tauri::{WireError, WirePath};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::cli::{file_uri_encode, file_uri_path};
use crate::windows::{blocking, wire_error};

/// The GNOME convention's target.
pub const TARGET_GNOME: &str = "x-special/gnome-copied-files";
/// RFC 2483's target.
pub const TARGET_URI_LIST: &str = "text/uri-list";
/// KDE's cut marker (KIO `isClipboardDataCut`).
pub const TARGET_KDE_CUT: &str = "application/x-kde-cutselection";
/// The text targets offered, the set of GTK's `add_text_targets`; GTK
/// converts the text for each.
pub const TARGETS_TEXT: [&str; 4] = ["STRING", "TEXT", "text/plain", "UTF8_STRING"];

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
/// [`TIMEOUT`]. `f` may hand the sender on to a GTK callback. The budget
/// includes the wait for the main thread; when it runs out, `f` is marked
/// cancelled and does nothing if the main thread reaches it later, so a
/// reported failure is never followed by the action happening.
pub(crate) async fn on_main<R, T, F>(app: &AppHandle<R>, f: F) -> Result<T, WireError>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(Sender<Result<T, WireError>>) + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    app.run_on_main_thread(move || {
        if !flag.load(Ordering::SeqCst) {
            f(tx);
        }
    })
    .map_err(|e| wire_error("Clipboard", format!("the main thread is gone: {e}"), None))?;
    blocking(move || match rx.recv_timeout(TIMEOUT) {
        Ok(r) => r,
        Err(RecvTimeoutError::Timeout) => {
            cancelled.store(true, Ordering::SeqCst);
            Err(wire_error(
                "Timeout",
                format!(
                    "no answer from the clipboard or the window system in {} s",
                    TIMEOUT.as_secs()
                ),
                None,
            ))
        }
        Err(RecvTimeoutError::Disconnected) => Err(wire_error(
            "Clipboard",
            "the clipboard request was dropped before it answered",
            None,
        )),
    })
    .await
}

/// `Ok` when the window that asked has the keyboard focus. Under Wayland
/// GTK3 gives clipboard access only to a focused window and says nothing
/// when it declines.
pub fn require_focus(focused: bool) -> Result<(), WireError> {
    if focused {
        Ok(())
    } else {
        Err(wire_error(
            "NoFocus",
            "Kern's window does not have focus, so the system clipboard cannot be used",
            None,
        ))
    }
}

async fn focused<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), WireError> {
    let w = window.clone();
    let f = blocking(move || {
        w.is_focused()
            .map_err(|e| wire_error("Window", format!("window operation failed: {e}"), None))
    })
    .await?;
    require_focus(f)
}

/// Refuses a path with a `.` or `..` segment, naming it. See the module
/// documentation.
pub fn refuse_dot_segments(paths: &[PathBuf]) -> Result<(), WireError> {
    for p in paths {
        if p.as_os_str()
            .as_bytes()
            .split(|&b| b == b'/')
            .any(|seg| seg == b"." || seg == b"..")
        {
            return Err(wire_error(
                "BadPath",
                format!(
                    "{} has a . or .. segment, which other applications resolve differently",
                    p.display()
                ),
                Some(p),
            ));
        }
    }
    Ok(())
}

/// The content of the KDE cut marker for `op`: `1` on a cut, none on a
/// copy.
pub fn kde_cut_data(op: ClipOp) -> Option<&'static [u8]> {
    match op {
        ClipOp::Cut => Some(b"1"),
        ClipOp::Copy => None,
    }
}

/// The operation of a `text/uri-list` given the content of the KDE cut
/// marker, if the owner offers one: `1` is a cut, anything else a copy.
pub fn uri_list_op(kde: Option<&[u8]>) -> ClipOp {
    if kde == Some(b"1") {
        ClipOp::Cut
    } else {
        ClipOp::Copy
    }
}

/// The targets offered for `op`, in the order GTK is told.
pub fn offered_targets(op: ClipOp) -> Vec<&'static str> {
    let mut t = vec![TARGET_GNOME, TARGET_URI_LIST];
    if kde_cut_data(op).is_some() {
        t.push(TARGET_KDE_CUT);
    }
    t.extend(TARGETS_TEXT);
    t
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
    refuse_dot_segments(&list)?;
    paths_of(&list)
}

/// Puts `paths` on the system clipboard for a paste elsewhere.
#[tauri::command]
pub async fn clip_set<R: Runtime>(
    window: WebviewWindow<R>,
    op: ClipOp,
    paths: Vec<WirePath>,
) -> Result<(), WireError> {
    let paths = decode_wire(paths)?;
    focused(&window).await?;
    let gnome = encode_gnome_copied(op, &paths);
    let uris = encode_uri_list(&paths);
    let text = String::from_utf8_lossy(&encode_utf8_text(&paths)).into_owned();
    let app = window.app_handle().clone();
    on_main(&app, move |tx| {
        let _ = tx.send(set_files(op, gnome, uris, text));
    })
    .await
}

/// Set once Kern has put something on the clipboard, so exit hands it to a
/// clipboard manager only when there is something of Kern's to keep.
static OWNED: AtomicBool = AtomicBool::new(false);

fn set_files(op: ClipOp, gnome: Vec<u8>, uris: Vec<u8>, text: String) -> Result<(), WireError> {
    let names = offered_targets(op);
    let targets: Vec<gtk::TargetEntry> = names
        .iter()
        .enumerate()
        .map(|(i, n)| gtk::TargetEntry::new(n, gtk::TargetFlags::empty(), i as u32))
        .collect();
    let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
    let owned = clipboard.set_with_data(&targets, move |_, data, info| {
        let Some(&name) = names.get(info as usize) else {
            return;
        };
        match name {
            TARGET_GNOME => data.set(&gdk::Atom::intern(name), 8, &gnome),
            TARGET_URI_LIST => data.set(&gdk::Atom::intern(name), 8, &uris),
            TARGET_KDE_CUT => data.set(&gdk::Atom::intern(name), 8, b"1"),
            // GTK converts the text to the target asked for.
            _ => {
                data.set_text(&text);
            }
        }
    });
    if owned {
        mark_storable(&clipboard);
        Ok(())
    } else {
        Err(wire_error(
            "Clipboard",
            "GTK would not give Kern the clipboard",
            None,
        ))
    }
}

fn mark_storable(clipboard: &gtk::Clipboard) {
    // SAFETY: `clipboard` is a live GtkClipboard; a null target array with a
    // count of 0 is GTK's documented way to say every offered form may be
    // stored (gtk_clipboard_set_can_store). gtk 0.18 has no safe binding.
    unsafe {
        gtk::ffi::gtk_clipboard_set_can_store(
            gtk::glib::translate::ToGlibPtr::to_glib_none(clipboard).0,
            std::ptr::null(),
            0,
        );
    }
    OWNED.store(true, Ordering::SeqCst);
}

/// Hands Kern's clipboard to the clipboard manager as the application exits
/// (X11; GTK declines at once where the display has none, as under Wayland).
/// GTK itself gives up on a manager that does not answer after its own
/// timeout of 10 s, and this runs only if Kern put something there.
pub fn store_on_exit() {
    if !OWNED.load(Ordering::SeqCst) {
        return;
    }
    let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
    if clipboard
        .display()
        .is_some_and(|d| d.supports_clipboard_persistence())
    {
        clipboard.store();
    }
}

/// Puts text on the system clipboard (Copy path).
#[tauri::command]
pub async fn clip_text<R: Runtime>(
    window: WebviewWindow<R>,
    text: String,
) -> Result<(), WireError> {
    focused(&window).await?;
    let app = window.app_handle().clone();
    on_main(&app, move |tx| {
        let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
        clipboard.set_text(&text);
        mark_storable(&clipboard);
        let _ = tx.send(Ok(()));
    })
    .await
}

/// The files on the system clipboard, if any: `x-special/gnome-copied-files`
/// first, then `text/uri-list` (a cut when it carries KDE's cut marker, else
/// a copy).
#[tauri::command]
pub async fn clip_get<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<Option<ClipContents>, WireError> {
    focused(&window).await?;
    let app = window.app_handle().clone();
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
        clipboard.request_contents(
            &gdk::Atom::intern(TARGET_URI_LIST),
            move |clipboard, data| {
                if data.length() < 0 {
                    let _ = tx.send(Ok(None));
                    return;
                }
                let list = try_decode_uri_list(&data.data());
                clipboard.request_contents(&gdk::Atom::intern(TARGET_KDE_CUT), move |_, marker| {
                    let kde = (marker.length() >= 0).then(|| marker.data());
                    let op = uri_list_op(kde.as_deref());
                    let r = list
                        .map(|paths| Some(contents(op, &paths)))
                        .map_err(|e| clip_error(&e));
                    let _ = tx.send(r);
                });
            },
        );
    });
}
