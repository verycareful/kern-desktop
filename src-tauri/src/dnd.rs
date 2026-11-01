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
//! second handler on the same widget would never run.
//!
//! A drag that offers `text/uri-list` is Kern's to judge or refuse, never
//! WebKit's, so WebKit does not see a drag it will not get the end of: the
//! handlers answer `drag-motion` and `drag-drop` themselves and stop
//! `drag-leave` for every such drag. Any other drag (text for a field in the
//! page) is left entirely to WebKit. The rules, as functions, are in
//! [`crate::drop_rule`]; what the handlers do with them:
//!
//! - Only the main window's webview takes files. A document window answers
//!   every drag of files with no action, so the pointer shows no drop. So
//!   does a drag that starts from one of Kern's own widgets (the native drag
//!   started when an item leaves the window): dragging inside Kern is made of
//!   pointer events.
//! - On the first `drag-motion` of a drag Kern asks for the list of files once
//!   and keeps it for the drag. Until it has arrived, and until the page has
//!   said which folder the pointer is over, the answer is no action.
//!   A list with a URI that is not a local `file://` URI, one that names no
//!   file, and one with a `.` or `..` segment in a path (which another
//!   application resolves textually, RFC 3986 section 5.2.4, while a symbolic
//!   link would make the filesystem resolve it differently; the clipboard
//!   refuses the same) refuse the drag, with the reason.
//! - The pointer's position goes to the page as [`EVENT_DRAG_OVER`], at most
//!   every [`HOVER_INTERVAL`] and always the last one, and the page answers with
//!   [`dnd_target`]: the folder under the pointer, or why there is none.
//!   Kern then looks at the filesystems for that folder
//!   (`kernkraft_fs::same_filesystem`, on a thread of its own, once per folder
//!   and drag) and answers GTK with the action it will perform. A refusal is
//!   told to the page as [`EVENT_DRAG_REFUSAL`] so it can say why.
//! - [`EVENT_DRAG_LEAVE`] follows `drag-leave`; GTK emits that before
//!   `drag-drop` as well, so the drag's state is kept until the next drag.
//! - `drag-drop` with no action shown is refused (`gtk_drag_finish` with
//!   failure) and told to the page as [`EVENT_DROP_REFUSED`]. Otherwise the
//!   list read at the first motion is sent as [`EVENT_DROP`] with the position,
//!   the size of the webview, what the other application offers and the user's
//!   modifier. An action the compositor selected that differs from the one Kern
//!   showed is that modifier. The drop is finished with `delete` unset: Kern
//!   moves or copies by itself, and the source is never asked to delete
//!   anything.

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Instant;

use gtk::gdk::{self, DragAction};
use gtk::glib::{self, SignalHandlerId};
use gtk::prelude::*;
use kernkraft_tauri::{WireError, WirePath};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Manager, Runtime, Webview, WebviewWindow};

use crate::clipboard::{
    encode_uri_list, on_main, refuse_dot_segments, try_decode_uri_list, TARGET_URI_LIST,
};
use crate::drop_rule::{
    needs_filesystems, stance, standing, user_modifier, verdict, Gate, Listing, Stance, Throttle,
    Verdict, Whereto, HOVER_INTERVAL,
};
use crate::windows::{wire_error, MAIN};

/// A drop from another application, sent to the window that received it.
pub const EVENT_DROP: &str = "kern://drop";
/// A drop Kern declined: `{drag, reason}`.
pub const EVENT_DROP_REFUSED: &str = "kern://drop-refused";
/// The pointer of a drag is over the webview: `{drag, position, view}`.
pub const EVENT_DRAG_OVER: &str = "kern://drag-over";
/// The files of a drag have been read: `{drag, paths}`.
pub const EVENT_DRAG_FILES: &str = "kern://drag-files";
/// Why Kern declines a drag now, or null when it does not: `{drag, refusal}`.
pub const EVENT_DRAG_REFUSAL: &str = "kern://drag-refusal";
/// The pointer of a drag left the webview: `{drag}`.
pub const EVENT_DRAG_LEAVE: &str = "kern://drag-leave";

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
    /// `copy` or `move` when the user chose it with a modifier key, else null.
    pub modifier: Option<&'static str>,
    /// The drag, as in the events that came before the drop.
    pub drag: u64,
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

/// True when the drag offers a list of files (`text/uri-list`).
pub fn offers_files<I, S>(targets: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    targets.into_iter().any(|t| t.as_ref() == TARGET_URI_LIST)
}

/// True when the path part of a `file://` URI has a segment that is `.` or `..` once its
/// percent escapes are read. The decoder resolves such segments textually (RFC 3986
/// section 5.2.4), so they have to be looked for in the URI itself.
fn has_dot_segment(uri: &[u8]) -> bool {
    let rest = uri.get(7..).unwrap_or_default();
    let path = rest
        .iter()
        .position(|&b| b == b'/')
        .map_or(&[][..], |i| &rest[i..]);
    path.split(|&b| b == b'/').any(|seg| {
        let mut plain = Vec::with_capacity(seg.len());
        let mut i = 0;
        while i < seg.len() {
            let hex = seg.get(i + 1..i + 3).and_then(|h| {
                std::str::from_utf8(h)
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
            });
            match (seg[i], hex) {
                (b'%', Some(byte)) => {
                    plain.push(byte);
                    i += 3;
                }
                (byte, _) => {
                    plain.push(byte);
                    i += 1;
                }
            }
        }
        plain == b"." || plain == b".."
    })
}

/// The paths a dropped `text/uri-list` names, byte for byte. A URI that is not
/// a local file, a list that names no file and a URI with a `.` or `..` segment
/// are errors, the last as the clipboard refuses such a path (see the module
/// documentation).
pub fn uri_list_paths(bytes: &[u8]) -> Result<Vec<PathBuf>, WireError> {
    let dotted = bytes
        .split(|&b| b == b'\n')
        .map(|l| l.strip_suffix(b"\r").unwrap_or(l))
        .find(|l| l.len() >= 7 && l[..7].eq_ignore_ascii_case(b"file://") && has_dot_segment(l));
    if let Some(line) = dotted {
        return Err(wire_error(
            "BadPath",
            format!(
                "{} has a . or .. segment, which other applications resolve differently",
                String::from_utf8_lossy(line)
            ),
            None,
        ));
    }
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
    modifier: Option<&'static str>,
    drag: u64,
) -> DropPayload {
    DropPayload {
        paths: paths.iter().map(|p| WirePath::from(p.as_path())).collect(),
        position: DropPosition { x: at.x, y: at.y },
        view: DropView {
            width: at.width,
            height: at.height,
        },
        offered: action_names(offered),
        modifier,
        drag,
    }
}

fn target_names(context: &gdk::DragContext) -> Vec<String> {
    context
        .list_targets()
        .iter()
        .map(|a| a.name().to_string())
        .collect()
}

/// One drag from another application: what has been read and said about it.
struct Drag {
    id: u64,
    context: gdk::DragContext,
    offered: DragAction,
    /// The time of the latest `drag-motion`, which `drag_status` answers.
    time: u32,
    pos: (f64, f64),
    view: (f64, f64),
    asked: bool,
    listing: Listing,
    whereto: Whereto,
    /// By destination folder.
    verdicts: HashMap<PathBuf, Verdict>,
    judging: HashSet<PathBuf>,
    /// The refusal last told to the page.
    told: Option<String>,
    left: bool,
    throttle: Throttle,
}

impl Drag {
    fn new(id: u64, context: &gdk::DragContext) -> Drag {
        Drag {
            id,
            context: context.clone(),
            offered: context.actions(),
            time: 0,
            pos: (0.0, 0.0),
            view: (0.0, 0.0),
            asked: false,
            listing: Listing::Waiting,
            whereto: Whereto::Unknown,
            verdicts: HashMap::new(),
            judging: HashSet::new(),
            told: None,
            left: false,
            throttle: Throttle::new(HOVER_INTERVAL),
        }
    }

    fn verdict(&self) -> Option<&Verdict> {
        match &self.whereto {
            Whereto::Folder(p) => self.verdicts.get(p),
            _ => None,
        }
    }
}

/// Sends an event to the page.
type Emit = Box<dyn Fn(&str, Value) -> Result<(), WireError>>;

/// A webview that takes drags. Lives on the GTK main thread.
struct Target {
    label: String,
    main: bool,
    emit: Emit,
    report: Box<dyn Fn(WireError)>,
    drag: RefCell<Option<Drag>>,
    next: Cell<u64>,
    /// An event that could not be delivered has been reported for this drag.
    reported: Cell<bool>,
}

thread_local! {
    // GTK objects live on the main thread, which is the only one that touches these.
    static TARGETS: RefCell<HashMap<String, Rc<Target>>> = RefCell::new(HashMap::new());
}

fn target_of(label: &str) -> Option<Rc<Target>> {
    TARGETS.with(|t| t.borrow().get(label).cloned())
}

impl Target {
    /// Sends an event to the page. A failure is shown to the user once per drag; the
    /// events are sent many times a second and the same failure would repeat.
    fn send(&self, event: &str, payload: Value) -> bool {
        match (self.emit)(event, payload) {
            Ok(()) => true,
            Err(e) => {
                if !self.reported.replace(true) {
                    (self.report)(e);
                }
                false
            }
        }
    }

    /// Answers GTK with what Kern will do now, and tells the page when the reason
    /// for declining changed.
    fn apply(&self, d: &mut Drag) {
        let s = standing(&d.listing, &d.whereto, d.verdict());
        d.context.drag_status(s.action, d.time);
        if s.refusal != d.told {
            d.told = s.refusal.clone();
            self.send(
                EVENT_DRAG_REFUSAL,
                json!({"drag": d.id, "refusal": s.refusal}),
            );
        }
    }

    /// Looks at the filesystems for the folder the pointer is over, unless that is known
    /// or under way. The answer comes back through [`judged`].
    fn judge(&self, d: &mut Drag) {
        let (Listing::Ready(sources), Whereto::Folder(dest)) = (&d.listing, &d.whereto) else {
            return;
        };
        if d.verdicts.contains_key(dest) || d.judging.contains(dest) {
            return;
        }
        if !needs_filesystems(d.offered) {
            let none: [Result<bool, String>; 0] = [];
            d.verdicts.insert(dest.clone(), verdict(d.offered, &none));
            return;
        }
        let (label, id) = (self.label.clone(), d.id);
        let (sources, dest) = (sources.clone(), dest.clone());
        d.judging.insert(dest.clone());
        let spawned = {
            let dest = dest.clone();
            std::thread::Builder::new()
                .name("kern-same-filesystem".into())
                .spawn(move || {
                    let answers: Vec<Result<bool, String>> =
                        kernkraft_fs::same_filesystem(&sources, &dest)
                            .into_iter()
                            .map(|a| a.map_err(|e| e.to_string()))
                            .collect();
                    glib::MainContext::default().invoke(move || judged(&label, id, dest, answers));
                })
        };
        if let Err(e) = spawned {
            d.judging.remove(&dest);
            let why: [Result<bool, String>; 1] =
                [Err(format!("the filesystems could not be looked at: {e}"))];
            d.verdicts.insert(dest, verdict(d.offered, &why));
        }
    }

    fn send_over(&self, d: &Drag) {
        self.send(
            EVENT_DRAG_OVER,
            json!({
                "drag": d.id,
                "position": {"x": d.pos.0, "y": d.pos.1},
                "view": {"width": d.view.0, "height": d.view.1},
            }),
        );
    }

    /// Sends the pointer's position, at most every [`HOVER_INTERVAL`], the last one
    /// after the interval.
    fn hover(self: &Rc<Self>, d: &mut Drag) {
        match d.throttle.gate(Instant::now()) {
            Gate::Now => self.send_over(d),
            Gate::Later(wait) => {
                let (me, id) = (self.clone(), d.id);
                glib::timeout_add_local_once(wait, move || {
                    let mut slot = me.drag.borrow_mut();
                    if let Some(d) = slot.as_mut().filter(|d| d.id == id && !d.left) {
                        d.throttle.fired(Instant::now());
                        me.send_over(d);
                    }
                });
            }
            Gate::Skip => {}
        }
    }

    /// `drag-motion` over a drag of files Kern judges. True when the files must be asked for
    /// (after the borrow of the drag is released).
    fn motion(
        self: &Rc<Self>,
        context: &gdk::DragContext,
        pos: (f64, f64),
        view: (f64, f64),
        time: u32,
    ) -> bool {
        let mut slot = self.drag.borrow_mut();
        if slot.as_ref().is_none_or(|d| d.context != *context) {
            self.reported.set(false);
            let id = self.next.get() + 1;
            self.next.set(id);
            *slot = Some(Drag::new(id, context));
        }
        let d = slot.as_mut().expect("a drag was just made");
        d.time = time;
        d.pos = pos;
        d.view = view;
        if d.left {
            // Back after leaving: the page forgot where the pointer was and what the files are.
            d.left = false;
            d.whereto = Whereto::Unknown;
            d.told = None;
            d.throttle.reset();
            if let Listing::Ready(paths) = &d.listing {
                let wire: Vec<WirePath> =
                    paths.iter().map(|p| WirePath::from(p.as_path())).collect();
                self.send(EVENT_DRAG_FILES, json!({"drag": d.id, "paths": wire}));
            }
        }
        self.apply(d);
        self.hover(d);
        !std::mem::replace(&mut d.asked, true)
    }

    /// The list of files of the drag arrived.
    fn received(&self, context: &gdk::DragContext, data: &gtk::SelectionData) -> bool {
        let mut slot = self.drag.borrow_mut();
        let Some(d) = slot
            .as_mut()
            .filter(|d| d.context == *context && d.asked && d.listing == Listing::Waiting)
        else {
            return false;
        };
        d.listing = if data.length() < 0 {
            Listing::Unusable("the other application gave no list of files".to_owned())
        } else {
            match uri_list_paths(&data.data()) {
                Ok(paths) => Listing::Ready(paths),
                Err(e) => Listing::Unusable(e.message),
            }
        };
        if let Listing::Ready(paths) = &d.listing {
            let wire: Vec<WirePath> = paths.iter().map(|p| WirePath::from(p.as_path())).collect();
            self.send(EVENT_DRAG_FILES, json!({"drag": d.id, "paths": wire}));
        }
        self.judge(d);
        self.apply(d);
        true
    }

    fn leave(&self, context: &gdk::DragContext) {
        let mut slot = self.drag.borrow_mut();
        if let Some(d) = slot.as_mut().filter(|d| d.context == *context && !d.left) {
            d.left = true;
            self.send(EVENT_DRAG_LEAVE, json!({"drag": d.id}));
        }
    }

    /// The page says where the pointer is.
    fn answer(&self, drag: u64, whereto: Whereto) {
        let mut slot = self.drag.borrow_mut();
        if let Some(d) = slot.as_mut().filter(|d| d.id == drag && !d.left) {
            d.whereto = whereto;
            self.judge(d);
            self.apply(d);
        }
    }

    /// `drag-drop` over a drag of files Kern judges.
    fn drop_files(&self, context: &gdk::DragContext, at: DropGeometry, time: u32) {
        let taken = {
            let mut slot = self.drag.borrow_mut();
            if slot.as_ref().is_some_and(|d| d.context == *context) {
                slot.take()
            } else {
                None
            }
        };
        let Some(d) = taken else {
            self.send(
                EVENT_DROP_REFUSED,
                json!({"drag": 0, "reason": "the drop came before Kern had seen the files being dragged, so nothing was done"}),
            );
            context.drag_finish(false, false, time);
            return;
        };
        let s = standing(&d.listing, &d.whereto, d.verdict());
        let Listing::Ready(paths) = &d.listing else {
            return self.refuse_drop(context, &d, s.refusal, time);
        };
        if s.action.is_empty() {
            return self.refuse_drop(context, &d, s.refusal, time);
        }
        let modifier = user_modifier(context.selected_action(), s.action);
        let payload = drop_payload(paths, at, d.offered, modifier, d.id);
        let sent = match serde_json::to_value(&payload) {
            Ok(v) => self.send(EVENT_DROP, v),
            Err(e) => {
                (self.report)(wire_error(
                    "Drop",
                    format!("the drop could not be passed on: {e}"),
                    None,
                ));
                false
            }
        };
        context.drag_finish(sent, false, time);
    }

    fn refuse_drop(&self, context: &gdk::DragContext, d: &Drag, why: Option<String>, time: u32) {
        let reason = why.unwrap_or_else(|| {
            "Kern had not finished working out where the files would go, so nothing was done"
                .to_owned()
        });
        self.send(EVENT_DROP_REFUSED, json!({"drag": d.id, "reason": reason}));
        context.drag_finish(false, false, time);
    }
}

/// The filesystems have been looked at for `dest`.
fn judged(label: &str, drag: u64, dest: PathBuf, answers: Vec<Result<bool, String>>) {
    let Some(t) = target_of(label) else { return };
    let mut slot = t.drag.borrow_mut();
    let Some(d) = slot.as_mut().filter(|d| d.id == drag) else {
        return;
    };
    d.judging.remove(&dest);
    d.verdicts
        .insert(dest.clone(), verdict(d.offered, &answers));
    if !d.left && d.whereto == Whereto::Folder(dest) {
        t.apply(d);
    }
}

fn takes(target: &Target, context: &gdk::DragContext) -> Stance {
    stance(
        target.main,
        offers_files(target_names(context)),
        context.drag_get_source_widget().is_some(),
    )
}

fn size_of<W: IsA<gtk::Widget>>(widget: &W) -> (f64, f64) {
    (
        f64::from(widget.allocated_width()),
        f64::from(widget.allocated_height()),
    )
}

/// Takes drags of files on `view`, the webview's widget, and tells `webview`'s page.
/// Returns the handlers so a test of the wiring could remove them; the webview keeps
/// them for its lifetime.
fn connect<R: Runtime, W: IsA<gtk::Widget>>(view: &W, webview: Webview<R>) -> Vec<SignalHandlerId> {
    let label = webview.label().to_owned();
    let target = Rc::new(Target {
        label: label.clone(),
        main: label == MAIN,
        emit: {
            let webview = webview.clone();
            Box::new(move |event, payload| {
                webview
                    .emit_to(webview.label(), event, payload)
                    .map_err(|e| {
                        wire_error(
                            "Drop",
                            format!("a message about a dragged file could not be passed to the window: {e}"),
                            None,
                        )
                    })
            })
        },
        report: {
            let app = webview.app_handle().clone();
            Box::new(move |e| crate::windows::show_errors(&app, &[e], ""))
        },
        drag: RefCell::new(None),
        next: Cell::new(0),
        reported: Cell::new(false),
    });
    TARGETS.with(|t| t.borrow_mut().insert(label, target.clone()));
    let uri_list = gdk::Atom::intern(TARGET_URI_LIST);

    let motion = {
        let t = target.clone();
        view.connect_drag_motion(
            move |widget, context, x, y, time| match takes(&t, context) {
                Stance::NotOurs => false,
                Stance::Refuse => {
                    context.drag_status(DragAction::empty(), time);
                    true
                }
                Stance::Take => {
                    let ask =
                        t.motion(context, (f64::from(x), f64::from(y)), size_of(widget), time);
                    // Asked after the drag's state is released: the answer is a signal of its own.
                    if ask {
                        widget.drag_get_data(context, &uri_list, time);
                    }
                    true
                }
            },
        )
    };

    let received = {
        let t = target.clone();
        view.connect_drag_data_received(move |widget, context, _, _, data, _, _| {
            // Data Kern did not ask for (WebKit's own drags) is WebKit's.
            if t.received(context, data) {
                widget.stop_signal_emission_by_name("drag-data-received");
            }
        })
    };

    let left = {
        let t = target.clone();
        view.connect_drag_leave(move |widget, context, _| {
            let stance = takes(&t, context);
            if stance == Stance::NotOurs {
                return;
            }
            // WebKit never saw this drag, so it has nothing to leave.
            widget.stop_signal_emission_by_name("drag-leave");
            if stance == Stance::Take {
                t.leave(context);
            }
        })
    };

    let dropped = {
        let t = target.clone();
        view.connect_drag_drop(
            move |widget, context, x, y, time| match takes(&t, context) {
                Stance::NotOurs => false,
                Stance::Refuse => {
                    context.drag_finish(false, false, time);
                    true
                }
                Stance::Take => {
                    let (width, height) = size_of(widget);
                    let at = DropGeometry {
                        x: f64::from(x),
                        y: f64::from(y),
                        width,
                        height,
                    };
                    t.drop_files(context, at, time);
                    true
                }
            },
        )
    };

    vec![motion, received, left, dropped]
}

/// What the page says about where a drag's pointer is.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum WireTarget {
    /// Over this folder, which takes the files.
    Folder { path: WirePath },
    /// Over a place that takes none, or one that could not be worked out; the
    /// reason in the user's words.
    Refused { reason: String },
}

/// The page's answer to [`EVENT_DRAG_OVER`]: where the pointer of `drag` is. An answer
/// about a drag that is over, or an earlier one, is ignored.
#[tauri::command]
pub async fn dnd_target<R: Runtime>(
    window: WebviewWindow<R>,
    drag: u64,
    target: WireTarget,
) -> Result<(), WireError> {
    let whereto = match target {
        WireTarget::Refused { reason } => Whereto::Refused(reason),
        WireTarget::Folder { path } => {
            let p = path
                .to_path_buf()
                .map_err(|e| wire_error("BadPath", e.to_string(), None))?;
            refuse_dot_segments(std::slice::from_ref(&p))?;
            if !p.is_absolute() {
                return Err(wire_error(
                    "BadPath",
                    format!("{} is not an absolute path", p.display()),
                    Some(&p),
                ));
            }
            Whereto::Folder(p)
        }
    };
    let label = window.label().to_owned();
    window
        .app_handle()
        .run_on_main_thread(move || {
            if let Some(t) = target_of(&label) {
                t.answer(drag, whereto);
            }
        })
        .map_err(|e| wire_error("Window", format!("the main thread is gone: {e}"), None))
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
            // Without the handlers a file dropped on the window would be opened by the webview.
            if let Err(e) = attached {
                let err = wire_error(
                    "Drop",
                    format!(
                        "dropping files on the window ({}) will not work: {e}",
                        webview.label()
                    ),
                    None,
                );
                crate::windows::show_errors(webview.app_handle(), &[err], "");
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
