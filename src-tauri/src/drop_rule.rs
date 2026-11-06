// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! What Kern answers a drag from another application with, as plain
//! functions (the GTK signals that use them are in [`crate::dnd`]).
//!
//! The pointer must show what Kern will do. A drop with no modifier moves what
//! is on the destination's filesystem and copies the rest, item by item (a move
//! is then a rename; `kernkraft_fs::same_filesystem` says which). An
//! application that offers exactly one of copy and move is obeyed. A drop with
//! several kinds of file shows the action most of them take, and both halves
//! still run. A tie shows a copy, which removes nothing. Nothing is shown as
//! accepted until the list of files has been read, the page has said which
//! folder the pointer is over, and the filesystems have been looked at for that
//! folder: until then, and whenever there is nothing Kern can act on, the
//! answer is "no action", which GTK's `gtk_drag_status` documents as declining
//! the drop.
//!
//! At the drop, an action selected by the compositor that differs from the one
//! Kern last showed is the user's modifier (a Wayland compositor maps Ctrl to
//! copy and Shift to move, whatever the destination preferred), and is obeyed.
//!
//! GTK emits `drag-leave` before `drag-drop` (GTK 3 reference, "drag-leave"),
//! so a leave does not end a drag by itself.

use std::fmt::Display;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use gtk::gdk::DragAction;
use tauri::Url;

use crate::windows::{window_kind, WindowKind};

/// Shortest time between two forwarded pointer positions. The page only
/// highlights a place and answers; 50 ms (20 positions a second) keeps a
/// highlight within the 100 ms in which a response to a pointer feels
/// immediate (Nielsen, response times) and bounds the traffic to the page.
pub const HOVER_INTERVAL: Duration = Duration::from_millis(50);

/// Who deals with a drag that arrives at a webview.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stance {
    /// Not a drag of files (text for a field in the page): the page's own.
    NotOurs,
    /// A drag of files Kern declines: the pointer shows no drop and the page
    /// never sees it.
    Refuse,
    /// A drag of files Kern judges.
    Take,
}

/// `takes_files` is whether the webview is one that takes files (see
/// [`takes_files`]), `offers_files` whether the drag offers a list of files,
/// `own_source` whether the widget the drag started from is one of this
/// process's own (the native drag Kern starts when an item leaves the window;
/// dragging inside Kern is pointer events).
pub fn stance(takes_files: bool, offers_files: bool, own_source: bool) -> Stance {
    if !offers_files {
        Stance::NotOurs
    } else if !takes_files || own_source {
        Stance::Refuse
    } else {
        Stance::Take
    }
}

/// Whether the window labelled `label` takes files dropped from other
/// applications: the main window, which has folder views, and the editor
/// windows, which have a folder tree and open text files. A document window
/// shows one document and has nowhere to put files.
pub fn takes_files(label: &str) -> bool {
    matches!(
        window_kind(label),
        Some(WindowKind::Main | WindowKind::Editor)
    )
}

/// True when the filesystems decide: the other application allows both copy
/// and move. Otherwise the one it allows is the action, and nothing is looked at.
pub fn needs_filesystems(offered: DragAction) -> bool {
    offered.contains(DragAction::COPY | DragAction::MOVE)
}

/// What a drag does at one destination.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    /// The action shown, or empty when Kern refuses.
    pub action: DragAction,
    /// How many of the files are moved, and how many copied.
    pub moves: usize,
    pub copies: usize,
    /// Why Kern refuses, when it does.
    pub refusal: Option<String>,
}

impl Verdict {
    fn refused(why: impl Into<String>) -> Verdict {
        Verdict {
            action: DragAction::empty(),
            moves: 0,
            copies: 0,
            refusal: Some(why.into()),
        }
    }
}

/// The verdict for a drag that offers `offered`, given the answer for each
/// file of whether moving it to the destination is a rename (`Ok(true)`), a
/// copy and delete (`Ok(false)`) or could not be told. The answers are not
/// looked at unless [`needs_filesystems`].
pub fn verdict<E: Display>(offered: DragAction, same: &[Result<bool, E>]) -> Verdict {
    let usable = offered & (DragAction::COPY | DragAction::MOVE);
    if usable.is_empty() {
        return Verdict::refused(
            "the other application allows neither copy nor move, which is all Kern does with dropped files",
        );
    }
    if !needs_filesystems(offered) {
        let action = usable;
        return Verdict {
            action,
            moves: 0,
            copies: 0,
            refusal: None,
        };
    }
    let moves = same.iter().filter(|a| matches!(a, Ok(true))).count();
    let copies = same.iter().filter(|a| matches!(a, Ok(false))).count();
    if moves + copies == 0 {
        return match same.iter().find_map(|a| a.as_ref().err()) {
            Some(e) => Verdict::refused(format!(
                "Kern cannot tell whether the dropped files are on this folder's filesystem: {e}"
            )),
            None => Verdict::refused("there are no files in what is being dragged"),
        };
    }
    Verdict {
        action: if moves > copies {
            DragAction::MOVE
        } else {
            DragAction::COPY
        },
        moves,
        copies,
        refusal: None,
    }
}

/// The verdict for files dropped where they are opened: nothing is moved or
/// copied, so no filesystem is looked at and the source loses nothing. A copy
/// is shown when the source offers one; a source that offers only a move is
/// shown a move (the drop is then finished as a failure, see
/// [`finish_success`], and the source deletes nothing).
pub fn open_verdict(offered: DragAction) -> Verdict {
    let usable = offered & (DragAction::COPY | DragAction::MOVE);
    if usable.is_empty() {
        return Verdict::refused(
            "the other application allows neither copy nor move, which is all Kern does with dropped files",
        );
    }
    Verdict {
        action: if usable.contains(DragAction::COPY) {
            DragAction::COPY
        } else {
            usable
        },
        moves: 0,
        copies: 0,
        refusal: None,
    }
}

/// The list of files a drag offers, as far as it has been read.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Listing {
    /// Asked for, not yet answered.
    Waiting,
    /// Answered with something Kern cannot use; the reason.
    Unusable(String),
    Ready(Vec<PathBuf>),
}

/// Where the page says the pointer is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Whereto {
    /// Not yet said.
    Unknown,
    /// Over a place that takes no drop, or one that could not be worked out;
    /// the reason, in the user's words.
    Refused(String),
    /// Over this folder.
    Folder(PathBuf),
    /// Over the place where the dropped files are opened, not put anywhere
    /// ([`open_verdict`]).
    Open,
}

/// What Kern answers now, and why when it declines.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Standing {
    pub action: DragAction,
    pub refusal: Option<String>,
}

/// The answer for the state of a drag: no action until everything is known.
pub fn standing(listing: &Listing, whereto: &Whereto, verdict: Option<&Verdict>) -> Standing {
    let none = |refusal: Option<String>| Standing {
        action: DragAction::empty(),
        refusal,
    };
    match (listing, whereto) {
        (Listing::Unusable(why), _) => none(Some(why.clone())),
        (Listing::Waiting, _) => none(None),
        (Listing::Ready(_), Whereto::Unknown) => none(None),
        (Listing::Ready(_), Whereto::Refused(why)) => none(Some(why.clone())),
        (Listing::Ready(_), Whereto::Folder(_) | Whereto::Open) => match verdict {
            None => none(None),
            Some(v) => Standing {
                action: v.action,
                refusal: v.refusal.clone(),
            },
        },
    }
}

/// The user's modifier at a drop: the action the compositor selected, when it
/// is exactly copy or move and not the one Kern showed.
pub fn user_modifier(selected: DragAction, shown: DragAction) -> Option<&'static str> {
    if shown.is_empty() || selected == shown {
        return None;
    }
    if selected == DragAction::COPY {
        Some("copy")
    } else if selected == DragAction::MOVE {
        Some("move")
    } else {
        None
    }
}

/// Whether the compositor selected something other than Kern's answer that is
/// neither a plain copy nor a plain move (Ctrl+Shift selects a link on
/// Wayland). Kern carries out only copies and moves, so such a drop is refused
/// rather than given Kern's default, which may move the files.
pub fn unsupported_choice(selected: DragAction, shown: DragAction) -> bool {
    !shown.is_empty()
        && !selected.is_empty()
        && selected != shown
        && selected != DragAction::COPY
        && selected != DragAction::MOVE
}

/// Whether a drop that was passed on (`sent`) is finished as a success. Only a
/// copy is: on Wayland, finishing a drop whose final action is a move tells the
/// source it may delete its data, and the `delete` flag of `gtk_drag_finish`
/// is not carried by the protocol. Kern moves the files itself, and a move it
/// skips, cancels or fails must leave the originals where they are, so a move
/// is finished as a failure and the source deletes nothing.
pub fn finish_success(sent: bool, selected: DragAction) -> bool {
    sent && selected == DragAction::COPY
}

/// What a throttle says about a position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gate {
    /// Send it now.
    Now,
    /// Send the latest position after this long.
    Later(Duration),
    /// One is already waiting; it will carry the latest position.
    Skip,
}

impl Gate {
    pub fn is_later(&self) -> bool {
        matches!(self, Gate::Later(_))
    }
}

/// Limits how often positions are sent, and makes sure the last one is: a
/// position inside the interval is sent once the interval is over, so a
/// pointer that stops is reported where it stopped.
#[derive(Clone, Debug)]
pub struct Throttle {
    interval: Duration,
    last: Option<Instant>,
    waiting: bool,
}

impl Throttle {
    pub fn new(interval: Duration) -> Throttle {
        Throttle {
            interval,
            last: None,
            waiting: false,
        }
    }

    pub fn gate(&mut self, now: Instant) -> Gate {
        let Some(last) = self.last else {
            self.last = Some(now);
            return Gate::Now;
        };
        let since = now.saturating_duration_since(last);
        if since >= self.interval {
            self.last = Some(now);
            self.waiting = false;
            Gate::Now
        } else if self.waiting {
            Gate::Skip
        } else {
            self.waiting = true;
            Gate::Later(self.interval - since)
        }
    }

    /// The delayed position has been sent.
    pub fn fired(&mut self, now: Instant) {
        self.waiting = false;
        self.last = Some(now);
    }

    /// Forgets everything: the next position goes at once.
    pub fn reset(&mut self) {
        self.last = None;
        self.waiting = false;
    }
}

/// True when the page may navigate to `url`: the application's own origin
/// (`tauri://localhost`) and, in a development run, the dev server `dev`. A file
/// dropped on a page that does not take it would otherwise be opened by the
/// webview itself, replacing Kern's page with the file.
pub fn navigation_allowed(url: &Url, dev: Option<&Url>) -> bool {
    if url.scheme() == "tauri" && url.host_str() == Some("localhost") {
        return true;
    }
    dev.is_some_and(|d| {
        url.scheme() == d.scheme()
            && url.host_str() == d.host_str()
            && url.port_or_known_default() == d.port_or_known_default()
    })
}
