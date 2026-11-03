// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Where an opened path goes: the rules of design D4.3 to D4.5 and 6.1
//! (kern-desktop 0.1.0.0 design), as a pure function. The caller does the
//! file-system work (what the path is, which file it resolves to, via
//! [`FileId::of`]) and passes the answers in; the registry and the rules
//! never touch the disk.

use std::collections::HashMap;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

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
    /// Ctrl+double-click, or "Open in new window" (D4.3).
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
    /// A file the editor opens (D6.1).
    Text,
    /// Any other file.
    Other,
}

struct Entry {
    location: Location,
}

/// The documents open in Kern: path to place.
#[derive(Default)]
pub struct OpenRegistry {
    map: Mutex<HashMap<PathBuf, Entry>>,
}

impl OpenRegistry {
    pub fn new() -> OpenRegistry {
        OpenRegistry::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<PathBuf, Entry>> {
        self.map.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records `path` as open at `location`, replacing an earlier place.
    pub fn insert(&self, path: &Path, location: Location) {
        self.lock().insert(path.to_path_buf(), Entry { location });
    }

    /// Forgets `path`, whatever place it has.
    pub fn remove(&self, path: &Path) {
        self.lock().remove(path);
    }

    /// Forgets `path` only if it is registered at `location`: a tab closing
    /// after its document moved to a window must not erase the window.
    pub fn remove_if(&self, path: &Path, location: &Location) {
        let mut map = self.lock();
        if map.get(path).is_some_and(|e| &e.location == location) {
            map.remove(path);
        }
    }

    /// Where `path` is open: under the same name, or under another name of
    /// the same file (`id` is the caller's look at `path`: a symlink shares
    /// the resolved path, a hard link the device and inode), which stops two
    /// dirty copies of one file. Every registered path is looked at again
    /// now, outside the lock, and compared with `id` by identity and by
    /// resolved path; nothing remembered from registration is used.
    pub fn get(&self, path: &Path, id: &FileId) -> Option<Location> {
        let all: Vec<(PathBuf, Location)> = {
            let map = self.lock();
            if let Some(e) = map.get(path) {
                return Some(e.location.clone());
            }
            map.iter()
                .map(|(p, e)| (p.clone(), e.location.clone()))
                .collect()
        };
        all.into_iter()
            .find(|(p, _)| FileId::of(p).names_same_file_as(id))
            .map(|(_, l)| l)
    }

    /// How `path` stands for the place `own` that holds a document: the
    /// file is its own (the path leads to the file it has open), free, or
    /// open somewhere else.
    pub fn held_by(&self, path: &Path, id: &FileId, own: &Location) -> Held {
        match self.get(path, id) {
            None => Held::Free,
            Some(loc) if &loc == own => Held::Own,
            Some(location) => Held::Elsewhere { location },
        }
    }

    /// The path open in window `label`.
    pub fn path_of_window(&self, label: &str) -> Option<PathBuf> {
        self.lock()
            .iter()
            .find(|(_, e)| matches!(&e.location, Location::Window { label: l } if l == label))
            .map(|(p, _)| p.clone())
    }

    /// Forgets what window `label` held: the document it shows as a
    /// standalone window and every tab it has. Other windows' tabs stay.
    pub fn remove_window(&self, label: &str) {
        self.lock().retain(|_, e| e.location.window() != label);
    }
}

/// The rules, with no file access. `id` is the caller's look at `path` (see
/// [`FileId`]) and `kind` what it is, resolved through links:
/// a link to a folder is a folder (Review Focus 4). The target keeps `path`
/// as given.
pub fn route(
    path: &Path,
    id: &FileId,
    origin: Origin,
    gesture: Gesture,
    kind: Kind,
    open: &OpenRegistry,
) -> Target {
    if let Some(loc) = open.get(path, id) {
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
