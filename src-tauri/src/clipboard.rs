// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The system clipboard, shared with Dolphin, Nautilus, Thunar and terminals.
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
//! - The text targets `STRING`, `TEXT`, `UTF8_STRING`,
//!   `text/plain;charset=utf-8` and `text/plain` (some of GTK's text
//!   targets, so clients find one they ask for): the paths, newline
//!   separated, so pasting into a terminal gives paths. GTK answers a bare
//!   `text/plain` in ASCII, escaping every other character, so a client that
//!   wants a name with such characters exactly asks for `UTF8_STRING` or
//!   `text/plain;charset=utf-8`, which carry it as UTF-8.
//!   A name that is not UTF-8 cannot be exact text;
//!   it is written with U+FFFD for the bytes that are not UTF-8. The two
//!   URI targets stay exact, and a file manager pastes from those. The
//!   alternative, writing such a name in its URI form, would hand a terminal
//!   a string that is no path at all.
//!
//! URIs are `file://` with an empty or `localhost` host (RFC 8089); the
//! encoder and decoder are in [`crate::cli`] and work on bytes, so a name
//! that is not UTF-8 survives a round trip.
//!
//! After a cut has been pasted, [`clip_clear_if`] ends the offer of those
//! files, but only if the clipboard still holds exactly that cut. The
//! clipboard's owner answers a read through the main loop, so the clipboard
//! can change between the read and the clear. Kern therefore notes whether
//! the clipboard's owner changed while it waited ([`Ownership`] for its own
//! offers, GTK's `owner-change` for anyone else's) and clears in the same
//! main-loop turn that decides, never after a change.
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

use std::cell::{Cell, RefCell};
use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::Duration;

use gtk::gdk;
use gtk::glib::{self, ObjectExt};
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
/// The text targets offered, some of those GTK's `add_text_targets` adds; GTK
/// converts the text for each. A bare `text/plain` is converted to ASCII with
/// the other characters escaped; `UTF8_STRING` and `text/plain;charset=utf-8`
/// are UTF-8.
pub const TARGETS_TEXT: [&str; 5] = [
    "STRING",
    "TEXT",
    "text/plain",
    "text/plain;charset=utf-8",
    "UTF8_STRING",
];

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
    on_main_with(app, |tx, _| f(tx)).await
}

/// [`on_main`] for work that can still be running when the budget runs out: `f` also gets
/// a flag that is set the moment the caller gives up and reports the timeout. Work that
/// finishes later must check it before it changes anything, since the caller has already
/// been told it did not happen.
pub(crate) async fn on_main_with<R, T, F>(app: &AppHandle<R>, f: F) -> Result<T, WireError>
where
    R: Runtime,
    T: Send + 'static,
    F: FnOnce(Sender<Result<T, WireError>>, Arc<AtomicBool>) + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    let abandoned = cancelled.clone();
    app.run_on_main_thread(move || {
        if !flag.load(Ordering::SeqCst) {
            f(tx, abandoned);
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
    // Lives as long as GTK keeps this offer: GTK drops the closure when the clipboard is
    // cleared, replaced, or taken by another application.
    let offer = OWNERSHIP.offer();
    let id = offer.id();
    let targets: Vec<gtk::TargetEntry> = names
        .iter()
        .enumerate()
        .map(|(i, n)| gtk::TargetEntry::new(n, gtk::TargetFlags::empty(), i as u32))
        .collect();
    let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
    let owned = clipboard.set_with_data(&targets, move |_, data, info| {
        let _offer = &offer;
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
        OWNERSHIP.claim(id);
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

/// What the clipboard holds for a paste: the operation and the paths, as
/// [`clip_get`] reads them.
type Held = Option<(ClipOp, Vec<PathBuf>)>;

/// Reads what the clipboard holds for a paste (`x-special/gnome-copied-files`
/// first, then `text/uri-list` with KDE's cut marker) and hands it to `done`.
/// Runs on the GTK main thread: the requests are answered by the main loop,
/// and `done` is called from it.
fn read_held<F>(done: F)
where
    F: FnOnce(Result<Held, ClipError>) + 'static,
{
    let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
    clipboard.request_contents(&gdk::Atom::intern(TARGET_GNOME), move |clipboard, data| {
        // A negative length is GTK's answer for a target the owner lacks.
        if data.length() >= 0 {
            done(try_decode_gnome_copied(&data.data()).map(Some));
            return;
        }
        clipboard.request_contents(
            &gdk::Atom::intern(TARGET_URI_LIST),
            move |clipboard, data| {
                if data.length() < 0 {
                    done(Ok(None));
                    return;
                }
                let list = try_decode_uri_list(&data.data());
                clipboard.request_contents(&gdk::Atom::intern(TARGET_KDE_CUT), move |_, marker| {
                    let kde = (marker.length() >= 0).then(|| marker.data());
                    let op = uri_list_op(kde.as_deref());
                    done(list.map(|paths| Some((op, paths))));
                });
            },
        );
    });
}

fn request_files(tx: Sender<Result<Option<ClipContents>, WireError>>) {
    read_held(move |held| {
        let _ = tx.send(
            held.map(|h| h.map(|(op, paths)| contents(op, &paths)))
                .map_err(|e| clip_error(&e)),
        );
    });
}

/// True when the clipboard holds `op` on exactly `paths`: the same operation
/// and the same paths in the same order.
pub fn holds_exactly(held: Option<&(ClipOp, Vec<PathBuf>)>, op: ClipOp, paths: &[PathBuf]) -> bool {
    matches!(held, Some((o, p)) if *o == op && p.as_slice() == paths)
}

/// Which offer of files, if any, is Kern's own clipboard content right now.
///
/// Every offer made with [`Ownership::offer`] holds an [`Offer`] for as long as GTK keeps
/// it; GTK drops the offer's closure, and with it the [`Offer`], when the clipboard is
/// cleared, replaced by a newer offer or text, or taken by another application. So
/// [`Ownership::current`] is the id of the offer Kern holds, or 0 when it holds none, and
/// an id that differs between two moments says the offer changed in between.
pub struct Ownership {
    current: AtomicU64,
    issued: AtomicU64,
}

impl Ownership {
    pub const fn new() -> Ownership {
        Ownership {
            current: AtomicU64::new(0),
            issued: AtomicU64::new(0),
        }
    }

    /// A new offer, not yet current. Call [`Ownership::claim`] with its id once GTK has
    /// accepted it.
    pub fn offer(&'static self) -> Offer {
        Offer {
            owner: self,
            id: self.issued.fetch_add(1, Ordering::SeqCst) + 1,
        }
    }

    /// Makes the offer with this id the current one.
    pub fn claim(&self, id: u64) {
        self.current.store(id, Ordering::SeqCst);
    }

    /// The id of Kern's offer of files, or 0.
    pub fn current(&self) -> u64 {
        self.current.load(Ordering::SeqCst)
    }
}

impl Default for Ownership {
    fn default() -> Ownership {
        Ownership::new()
    }
}

/// One offer of [`Ownership`]. Dropping it ends the offer, unless a newer one has been
/// claimed since.
pub struct Offer {
    owner: &'static Ownership,
    id: u64,
}

impl Offer {
    pub fn id(&self) -> u64 {
        self.id
    }
}

impl Drop for Offer {
    fn drop(&mut self) {
        let _ = self
            .owner
            .current
            .compare_exchange(self.id, 0, Ordering::SeqCst, Ordering::SeqCst);
    }
}

/// Kern's own offers of files on the clipboard.
static OWNERSHIP: Ownership = Ownership::new();

/// What clearing a pasted cut does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Clear {
    /// The clipboard is not that cut, or changed since it was read: it is left as it is.
    Keep,
    /// Kern's own offer: it is released. Nothing else is put on the clipboard.
    Release,
    /// Another application's offer (a cut made in a file manager): one application cannot
    /// release another's selection, so Kern takes the clipboard over with empty text.
    TakeOver,
}

/// What to do about a cut that was pasted, given what was found: whether the clipboard
/// held exactly that cut when it was read, whether the clipboard's owner changed since,
/// whether Kern holds an offer of files now, and whether the caller was already told
/// that the clear failed (it ran out of time). Anything but a clipboard that is still
/// the cut that was read is left alone, and nothing is cleared after a failure was
/// reported.
pub fn clear_plan(
    holds_cut: bool,
    changed_since_read: bool,
    kern_owns: bool,
    told_failed: bool,
) -> Clear {
    if !holds_cut || changed_since_read || told_failed {
        Clear::Keep
    } else if kern_owns {
        Clear::Release
    } else {
        Clear::TakeOver
    }
}

fn apply(clipboard: &gtk::Clipboard, plan: Clear) {
    match plan {
        Clear::Keep => return,
        Clear::Release => clipboard.clear(),
        Clear::TakeOver => clipboard.set_text(""),
    }
    // Nothing of Kern's to hand to a clipboard manager at exit any more.
    OWNED.store(false, Ordering::SeqCst);
}

/// Clears the clipboard only if it still holds `op` on exactly `paths`, and
/// says whether it did. It is for a cut that has been pasted: the files are
/// where they were pasted, and a second paste would only look for them in the
/// old place.
///
/// The clipboard's owner answers the read through the main loop, so the user
/// can copy something else while it is read. The owner is therefore checked
/// again in the callback that decides, in the same main-loop turn as the
/// clear: if GTK reported an owner change meanwhile, or Kern's own offer is
/// another one than when the read began, the clipboard is left alone and the
/// answer is `false`. Kern's own offer is released (`clear`); another
/// application's is taken over with empty text, since one application cannot
/// release another's selection. A clipboard that holds something unreadable
/// is not the cut, and is left.
///
/// An owner that never answers ends in a `Timeout` error after [`TIMEOUT`]. From then on
/// the `owner-change` watch is disconnected and a late answer clears nothing, because
/// the caller has been told the clear did not happen.
#[tauri::command]
pub async fn clip_clear_if<R: Runtime>(
    window: WebviewWindow<R>,
    op: ClipOp,
    paths: Vec<WirePath>,
) -> Result<bool, WireError> {
    let paths = decode_wire(paths)?;
    focused(&window).await?;
    let app = window.app_handle().clone();
    on_main_with(&app, move |tx, abandoned| {
        let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
        let offer_at_read = OWNERSHIP.current();
        let changed = Rc::new(Cell::new(false));
        let watch = Rc::new(RefCell::new(Some(clipboard.connect_local(
            "owner-change",
            false,
            {
                let changed = changed.clone();
                move |_| {
                    changed.set(true);
                    None
                }
            },
        ))));
        // However the read ends, the watch ends with it: when it answers, or when the caller
        // has given up and the owner has still not answered.
        let unwatch = {
            let (clipboard, watch) = (clipboard.clone(), watch.clone());
            move || {
                if let Some(id) = watch.borrow_mut().take() {
                    clipboard.disconnect(id);
                }
            }
        };
        glib::timeout_add_local_once(TIMEOUT, unwatch.clone());
        read_held(move |held| {
            unwatch();
            let holds = held.is_ok_and(|h| holds_exactly(h.as_ref(), op, &paths));
            let moved_on = changed.get() || OWNERSHIP.current() != offer_at_read;
            let plan = clear_plan(
                holds,
                moved_on,
                OWNERSHIP.current() != 0,
                abandoned.load(Ordering::SeqCst),
            );
            apply(&clipboard, plan);
            let _ = tx.send(Ok(plan != Clear::Keep));
        });
    })
    .await
}
