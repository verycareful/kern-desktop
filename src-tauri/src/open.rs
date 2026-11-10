// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Where an opened path goes: the rules for a click, a launch and a
//! document that is already open. [`route`] is a pure function of what it is
//! told. The registry holds places and takes no file-system step while its
//! lock is held: which file each registered path leads to is looked up by a
//! [`Survey`], on threads of its own, with a bound on the wait, and the
//! caller that decides on it checks the registry's generation to know that
//! nothing changed since the look.

use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Where the request came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    /// A click or key inside a Kern window.
    Inside,
    /// Another file manager, the command line, the desktop entry, `xdg-open`.
    Outside,
}

/// How the user asked, inside Kern.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Gesture {
    #[default]
    Default,
    /// Ctrl+double-click, or "Open in new window".
    NewWindow,
}

/// Where an open document lives. A tab belongs to the window that holds it:
/// the main window and every editor window have tabs of their own.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Location {
    Tab {
        window: String,
        tab_id: String,
    },
    Window {
        label: String,
    },
    /// A text file routed to a tab of `window` whose tab has not registered
    /// yet (the directive is on its way): the path is held for that window,
    /// so a second open of it, by any name, is focused there and not opened.
    Opening {
        window: String,
    },
}

impl Location {
    /// The label of the window that shows this place.
    pub fn window(&self) -> &str {
        match self {
            Location::Tab { window, .. } => window,
            Location::Window { label } => label,
            Location::Opening { window } => window,
        }
    }
}

/// What names one file, whatever path reaches it: the path with links
/// resolved, and the file's identity on its device. A symlink shares the
/// first with its target and a hard link shares the second with the other
/// names of the file; the registry matches on either, so one file is never
/// open twice under two names. It is always looked up live: a save replaces
/// the file by rename, which changes its inode, so nothing remembered from
/// an earlier look is trusted.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FileId {
    /// The path with links resolved. For a path that does not exist (a
    /// document deleted on disk, a link whose target is gone) the nearest
    /// existing folder's resolved path with the missing names after it.
    pub canonical: Option<PathBuf>,
    /// `(st_dev, st_ino)` of what the path leads to (stat(2), following
    /// links), when the file exists.
    pub ident: Option<(u64, u64)>,
}

/// Links followed before a path is given up as a loop: Linux's own limit
/// (`MAXSYMLINKS` in the kernel's `namei.c`).
const MAX_LINKS: usize = 40;

/// `path` with links resolved, also when it or a target does not exist: a
/// dangling link is followed to where it points, and a missing name is
/// resolved through its nearest existing folder.
fn canonical_lenient(path: &Path, links_left: usize) -> Option<PathBuf> {
    if let Ok(c) = std::fs::canonicalize(path) {
        return Some(c);
    }
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.file_type().is_symlink() => {
            let left = links_left.checked_sub(1)?;
            let target = std::fs::read_link(path).ok()?;
            let next = if target.is_absolute() {
                target
            } else {
                path.parent()?.join(target)
            };
            canonical_lenient(&next, left)
        }
        // It exists but cannot be resolved (no permission): not guessed at.
        Ok(_) => None,
        Err(_) => {
            let name = path.file_name()?;
            canonical_lenient(path.parent()?, links_left).map(|p| p.join(name))
        }
    }
}

impl FileId {
    /// Looks `path` up on the disk now.
    pub fn of(path: &Path) -> FileId {
        FileId {
            canonical: canonical_lenient(path, MAX_LINKS),
            ident: std::fs::metadata(path).ok().map(|m| (m.dev(), m.ino())),
        }
    }

    fn names_same_file_as(&self, other: &FileId) -> bool {
        fn same<T: PartialEq>(a: &Option<T>, b: &Option<T>) -> bool {
            a.is_some() && a == b
        }
        same(&self.canonical, &other.canonical) || same(&self.ident, &other.ident)
    }
}

/// How a path stands against the registry from the point of view of one
/// place that holds a document.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Held {
    /// Nothing has the file open.
    Free,
    /// The place asking has it open: the path leads to its own file.
    Own,
    /// Another place has it open.
    Elsewhere { location: Location },
}

/// What to do with a path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    FolderTab(PathBuf),
    DocTab(PathBuf),
    DocWindow(PathBuf),
    Focus(Location),
    DefaultApp(PathBuf),
}

/// What a path is, resolved through links by the caller.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Folder,
    /// A file the editor opens (kernkraft's MIME database says it is text).
    Text,
    /// Any other file.
    Other,
}

struct Entry {
    location: Location,
    /// Held for a Save As that has not written yet: not the path of the
    /// window's document, whatever the place says.
    reserved: bool,
}

/// An open document the registry moved to a new path, at the place that holds it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Moved {
    pub from: PathBuf,
    pub to: PathBuf,
    pub location: Location,
}

/// What [`OpenRegistry::retarget`] did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Retargeted {
    pub moved: Vec<Moved>,
    /// The documents not moved because their new path is already open.
    pub kept: Vec<PathBuf>,
}

#[derive(Default)]
struct Book {
    map: HashMap<PathBuf, Entry>,
    /// Counts every change to `map`; a decision made on a look at the
    /// registry holds only while this is the number the look saw.
    generation: u64,
}

/// What looks up a path's [`FileId`]. Production passes [`FileId::of`]; a
/// test passes one that can block.
pub type Stat = Arc<dyn Fn(&Path) -> FileId + Send + Sync>;

/// How a look stands.
enum Answer {
    Pending,
    Done(FileId),
    /// The stat panicked: there will be no answer from this look.
    Lost,
}

/// The look at one path: the answer, once it is in.
struct Look {
    started: Instant,
    answer: Mutex<Answer>,
    done: Condvar,
}

/// The looks in progress, by path. A path whose stat does not return keeps
/// its one look (and its one thread) until it does, however many surveys
/// ask, so a hung mount costs one thread, not one per open. A look is shared
/// by path whatever `stat` the asking survey passed: a registry has one stat
/// (the application's, or a test's), and the first one to start a look is the
/// one that answers it.
type Looking = Arc<Mutex<HashMap<PathBuf, Arc<Look>>>>;

/// The documents open in Kern: path to place.
#[derive(Default)]
pub struct OpenRegistry {
    book: Mutex<Book>,
    looking: Looking,
    /// Told whenever a path is let go (see [`OpenRegistry::on_release`]).
    released: Mutex<Option<Release>>,
}

/// What is called when the registry lets a path go.
pub type Release = Arc<dyn Fn() + Send + Sync>;

impl OpenRegistry {
    pub fn new() -> OpenRegistry {
        OpenRegistry::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Book> {
        self.book.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records `path` as open at `location`, replacing an earlier place.
    pub fn insert(&self, path: &Path, location: Location) {
        self.put(path, location, false);
    }

    /// Holds `path` at `location` for a Save As that has not written yet.
    /// The place's own registration of the path replaces the hold.
    pub fn reserve(&self, path: &Path, location: Location) {
        self.put(path, location, true);
    }

    fn put(&self, path: &Path, location: Location, reserved: bool) {
        let mut book = self.lock();
        book.generation += 1;
        book.map
            .insert(path.to_path_buf(), Entry { location, reserved });
    }

    /// Calls `f` after every change that lets a path go (a tab closing, a
    /// window going, a hold dropped), never for one that changes nothing and
    /// never with the registry's lock held, so `f` may ask the registry
    /// something. A place that was refused a file because another place had
    /// it open learns here that it may try again.
    pub fn on_release(&self, f: Release) {
        *self.released.lock().unwrap_or_else(PoisonError::into_inner) = Some(f);
    }

    fn announce(&self, changed: bool) {
        if !changed {
            return;
        }
        let f = self
            .released
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        if let Some(f) = f {
            f();
        }
    }

    /// Forgets `path`, whatever place it has.
    pub fn remove(&self, path: &Path) {
        let mut book = self.lock();
        let changed = book.map.remove(path).is_some();
        if changed {
            book.generation += 1;
        }
        drop(book);
        self.announce(changed);
    }

    /// Forgets `path` only if it is registered at `location`: a tab closing
    /// after its document moved to a window must not erase the window.
    pub fn remove_if(&self, path: &Path, location: &Location) {
        let mut book = self.lock();
        let changed = book.map.get(path).is_some_and(|e| &e.location == location);
        if changed {
            book.map.remove(path);
            book.generation += 1;
        }
        drop(book);
        self.announce(changed);
    }

    /// Forgets every path held at the tab `tab_id` of `window`: its
    /// document and any Save As target held for it.
    pub fn remove_tab(&self, window: &str, tab_id: &str) {
        let mut book = self.lock();
        let before = book.map.len();
        book.map.retain(|_, e| {
            !matches!(&e.location, Location::Tab { window: w, tab_id: t } if w == window && t == tab_id)
        });
        let changed = book.map.len() != before;
        if changed {
            book.generation += 1;
        }
        drop(book);
        self.announce(changed);
    }

    /// Re-keys every document open at `from`, or under it when `from` is a
    /// folder, to the same place under `to`: the documents of a rename or a
    /// move done inside Kern. A document whose new path is registered already
    /// stays where it was and is named in [`Retargeted::kept`], so neither
    /// registration is lost. A Save As hold and a path routed to a tab that
    /// has not registered are left alone; they are not documents yet.
    pub fn retarget(&self, from: &Path, to: &Path) -> Retargeted {
        let mut book = self.lock();
        let mut found: Vec<(PathBuf, PathBuf)> = book
            .map
            .iter()
            .filter(|(_, e)| {
                !e.reserved && matches!(e.location, Location::Tab { .. } | Location::Window { .. })
            })
            .filter_map(|(p, _)| {
                let rest = p.strip_prefix(from).ok()?;
                let new = if rest.as_os_str().is_empty() {
                    to.to_path_buf()
                } else {
                    to.join(rest)
                };
                Some((p.clone(), new))
            })
            .collect();
        found.sort();
        let mut out = Retargeted::default();
        for (old, new) in found {
            if book.map.contains_key(&new) {
                out.kept.push(old);
                continue;
            }
            if let Some(entry) = book.map.remove(&old) {
                out.moved.push(Moved {
                    from: old,
                    to: new.clone(),
                    location: entry.location.clone(),
                });
                book.map.insert(new, entry);
            }
        }
        let changed = !out.moved.is_empty();
        if changed {
            book.generation += 1;
        }
        drop(book);
        self.announce(changed);
        out
    }

    /// The path open in window `label`, not counting a Save As target held
    /// for it.
    pub fn path_of_window(&self, label: &str) -> Option<PathBuf> {
        self.lock()
            .map
            .iter()
            .find(|(_, e)| {
                !e.reserved && matches!(&e.location, Location::Window { label: l } if l == label)
            })
            .map(|(p, _)| p.clone())
    }

    /// Forgets what window `label` held: the document it shows as a
    /// standalone window and every tab it has. Other windows' tabs stay.
    pub fn remove_window(&self, label: &str) {
        let mut book = self.lock();
        let before = book.map.len();
        book.map.retain(|_, e| e.location.window() != label);
        let changed = book.map.len() != before;
        if changed {
            book.generation += 1;
        }
        drop(book);
        self.announce(changed);
    }

    /// The number the registry's generation is now; see [`Survey::generation`].
    pub fn generation(&self) -> u64 {
        self.lock().generation
    }

    /// A copy of what is registered, to look at without the lock.
    pub fn snapshot(&self) -> Snapshot {
        let book = self.lock();
        Snapshot {
            generation: book.generation,
            entries: book
                .map
                .iter()
                .map(|(p, e)| (p.clone(), e.location.clone()))
                .collect(),
            looking: Arc::clone(&self.looking),
        }
    }

    /// [`Snapshot::survey`] of the registry as it is now. Blocks for up to
    /// `bound`; never call it with a lock held.
    pub fn survey(&self, path: &Path, stat: &Stat, bound: Duration) -> Survey {
        self.snapshot().survey(path, stat, bound)
    }
}

/// What the registry held at one moment, owned, so it can be looked at on
/// another thread.
pub struct Snapshot {
    generation: u64,
    entries: Vec<(PathBuf, Location)>,
    looking: Looking,
}

impl Snapshot {
    /// Looks up the file behind every registered path (`stat`, one thread
    /// per path, none of it under a lock) and waits at most `bound` in all
    /// for the answers. A path whose look did not finish stays unanswered.
    /// Nothing is looked up when `path` itself is registered: it is found
    /// by its text.
    pub fn survey(self, path: &Path, stat: &Stat, bound: Duration) -> Survey {
        let exact = self
            .entries
            .iter()
            .find(|(p, _)| p == path)
            .map(|(_, l)| l.clone());
        let deadline = Instant::now() + bound;
        let looks: Vec<Option<Arc<Look>>> = if exact.is_some() {
            Vec::new()
        } else {
            self.entries
                .iter()
                .map(|(p, _)| start_look(&self.looking, p, stat))
                .collect()
        };
        // The asked path is looked at the same way, shared and bounded like the registered ones:
        // a path on a mount that stopped answering costs one thread and one wait, not one of
        // each per attempt.
        let asked = if exact.is_some() {
            None
        } else {
            start_look(&self.looking, path, stat).and_then(|l| wait_for(&l, deadline, bound))
        };
        let mut entries = Vec::with_capacity(self.entries.len());
        for (i, (p, location)) in self.entries.into_iter().enumerate() {
            let id = looks
                .get(i)
                .and_then(|l| l.as_ref())
                .and_then(|l| wait_for(l, deadline, bound));
            entries.push(Surveyed {
                path: p,
                location,
                id,
            });
        }
        Survey {
            generation: self.generation,
            asked_path: path.to_path_buf(),
            asked,
            looked: true,
            exact,
            entries,
        }
    }
}

impl Snapshot {
    /// A survey in which no registered path was looked at, so each is
    /// compared by its text only. Takes no step on the file system. `asked`
    /// is the look at the asked path that an earlier survey made, if it got
    /// one.
    pub fn unlooked(self, path: &Path, asked: Option<FileId>) -> Survey {
        Survey {
            generation: self.generation,
            asked_path: path.to_path_buf(),
            asked,
            looked: false,
            exact: self
                .entries
                .iter()
                .find(|(p, _)| p == path)
                .map(|(_, l)| l.clone()),
            entries: self
                .entries
                .into_iter()
                .map(|(path, location)| Surveyed {
                    path,
                    location,
                    id: None,
                })
                .collect(),
        }
    }
}

/// The look at `path`: the one in progress, or a new one on a thread of its
/// own. `None` when no thread could be made.
fn start_look(looking: &Looking, path: &Path, stat: &Stat) -> Option<Arc<Look>> {
    let mut map = looking.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(l) = map.get(path) {
        return Some(Arc::clone(l));
    }
    let look = Arc::new(Look {
        started: Instant::now(),
        answer: Mutex::new(Answer::Pending),
        done: Condvar::new(),
    });
    let (l, p, stat, looking) = (
        Arc::clone(&look),
        path.to_path_buf(),
        Arc::clone(stat),
        Arc::clone(looking),
    );
    std::thread::Builder::new()
        .name("kern-open-stat".to_owned())
        .spawn(move || {
            // Whatever happens to the stat, the look leaves the map and its waiters are told:
            // a stat that panics would otherwise leave the path unanswered for good.
            let mut over = EndLook {
                looking,
                path: p.clone(),
                look: l,
                answer: Answer::Lost,
            };
            over.answer = Answer::Done(stat(&p));
        })
        .ok()?;
    map.insert(path.to_path_buf(), Arc::clone(&look));
    Some(look)
}

/// Ends a look when dropped, also when the stat unwinds: the look is taken out of the map and
/// its waiters get `answer`.
struct EndLook {
    looking: Looking,
    path: PathBuf,
    look: Arc<Look>,
    answer: Answer,
}

impl Drop for EndLook {
    fn drop(&mut self) {
        self.looking
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.path);
        let answer = std::mem::replace(&mut self.answer, Answer::Lost);
        *self
            .look
            .answer
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = answer;
        self.look.done.notify_all();
    }
}

/// The answer of `look`, waiting no later than `deadline`. A look that has
/// run for `bound` already and has not answered is not waited for again.
fn wait_for(look: &Look, deadline: Instant, bound: Duration) -> Option<FileId> {
    let mut answer = look.answer.lock().unwrap_or_else(PoisonError::into_inner);
    loop {
        match &*answer {
            Answer::Done(id) => return Some(id.clone()),
            Answer::Lost => return None,
            Answer::Pending => {}
        }
        let now = Instant::now();
        if now >= deadline || look.started.elapsed() >= bound {
            return None;
        }
        answer = look
            .done
            .wait_timeout(answer, deadline - now)
            .unwrap_or_else(PoisonError::into_inner)
            .0;
    }
}

struct Surveyed {
    path: PathBuf,
    location: Location,
    /// `None` when the path's look did not answer in time.
    id: Option<FileId>,
}

/// The registry looked at once, for one asked path.
pub struct Survey {
    /// The registry's generation when the snapshot was taken. A decision
    /// made on this survey is sound only if the registry's generation is
    /// still this number when it is carried out.
    pub generation: u64,
    asked_path: PathBuf,
    /// The look at the asked path, when it was made and answered in time.
    asked: Option<FileId>,
    /// False for a survey in which nothing was looked at ([`Snapshot::unlooked`]), so what is
    /// unanswered was never asked, as against a path that was asked and did not answer.
    pub looked: bool,
    exact: Option<Location>,
    entries: Vec<Surveyed>,
}

/// What a survey found for a path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lookup {
    /// Where the file is open, if it was found.
    pub location: Option<Location>,
    /// The registered paths whose look did not answer in time, when the
    /// file was not found: it may be one of them.
    pub unanswered: Vec<PathBuf>,
}

impl Survey {
    /// Where the asked path is open: under the same name, or under another
    /// name of the same file (`id` is the caller's look at the path: a
    /// symlink shares the resolved path, a hard link the device and inode),
    /// which stops two dirty copies of one file. A registered path that did
    /// not answer is compared by its text only: with the asked path and with
    /// the asked path's own resolution.
    pub fn lookup(&self, id: &FileId) -> Lookup {
        self.lookup_skipping(id, None)
    }

    /// [`Survey::lookup`] in which a registered path at `own` that did not
    /// answer is left out of `unanswered`: it is the asking place's own
    /// document, not another one the file might be open in. A reserved
    /// entry (the target of a Save As) at `own` is left out as well: it is
    /// the same place's own hold.
    fn lookup_skipping(&self, id: &FileId, own: Option<&Location>) -> Lookup {
        if let Some(location) = &self.exact {
            return Lookup {
                location: Some(location.clone()),
                unanswered: Vec::new(),
            };
        }
        let mut unanswered = Vec::new();
        for e in &self.entries {
            match &e.id {
                Some(seen) if seen.names_same_file_as(id) => {
                    return Lookup {
                        location: Some(e.location.clone()),
                        unanswered: Vec::new(),
                    };
                }
                Some(_) => {}
                None if id.canonical.as_deref() == Some(e.path.as_path()) => {
                    return Lookup {
                        location: Some(e.location.clone()),
                        unanswered: Vec::new(),
                    };
                }
                None if Some(&e.location) == own => {}
                None => unanswered.push(e.path.clone()),
            }
        }
        Lookup {
            location: None,
            unanswered,
        }
    }

    /// What this survey found out about the asked path itself, for a later pass that looks at
    /// nothing ([`Snapshot::unlooked`]).
    pub fn into_asked(self) -> Option<FileId> {
        self.asked
    }

    /// The asked path and what could not be told about it: where it is open (by its name, or by
    /// its file as the survey's own look at it found), and the paths that did not answer. The
    /// asked path is among them when its own look did not answer in time.
    pub fn lookup_asked(&self) -> Lookup {
        self.lookup_asked_for(None)
    }

    fn lookup_asked_for(&self, own: Option<&Location>) -> Lookup {
        if self.exact.is_some() {
            return self.lookup_skipping(&FileId::default(), own);
        }
        match &self.asked {
            Some(id) => self.lookup_skipping(id, own),
            None => {
                let mut found = self.lookup_skipping(&FileId::default(), own);
                found.unanswered.push(self.asked_path.clone());
                found
            }
        }
    }

    /// [`Survey::held_by`] for the asked path, with the survey's own look at it.
    pub fn held_by_asked(&self, own: &Location) -> Result<Held, Vec<PathBuf>> {
        Self::held_from(self.lookup_asked_for(Some(own)), own)
    }

    /// How the asked path stands for the place `own` that holds a document:
    /// the file is its own, free, or open somewhere else. `Err` names the
    /// registered paths that did not answer when the answer depends on them.
    /// The place's own document is not among them: a file that is the
    /// place's own cannot also be open elsewhere, and a Save As that is the
    /// way out of a mount that stopped answering must not wait for that
    /// mount. A path that matches the unanswered file's text is still found
    /// to be the place's own.
    pub fn held_by(&self, id: &FileId, own: &Location) -> Result<Held, Vec<PathBuf>> {
        Self::held_from(self.lookup_skipping(id, Some(own)), own)
    }

    fn held_from(found: Lookup, own: &Location) -> Result<Held, Vec<PathBuf>> {
        match found.location {
            Some(loc) if &loc == own => Ok(Held::Own),
            Some(location) => Ok(Held::Elsewhere { location }),
            None if found.unanswered.is_empty() => Ok(Held::Free),
            None => Err(found.unanswered),
        }
    }
}

/// The rules, with no file access. `found` is where the survey found the
/// path open ([`Survey::lookup`]) and `kind` what it is, resolved through
/// links: a link to a folder is a folder. The target keeps
/// `path` as given.
pub fn route(
    path: &Path,
    found: Option<Location>,
    origin: Origin,
    gesture: Gesture,
    kind: Kind,
) -> Target {
    if let Some(loc) = found {
        return Target::Focus(loc);
    }
    let p = path.to_path_buf();
    match kind {
        Kind::Folder => Target::FolderTab(p),
        Kind::Other => Target::DefaultApp(p),
        Kind::Text if origin == Origin::Outside || gesture == Gesture::NewWindow => {
            Target::DocWindow(p)
        }
        Kind::Text => Target::DocTab(p),
    }
}
