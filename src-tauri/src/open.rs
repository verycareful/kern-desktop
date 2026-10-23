// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Where an opened path goes: the rules of design D4.3 to D4.5 and 6.1
//! (kern-desktop 0.1.0.0 design), as a pure function over what the registry
//! knows.

use std::collections::HashMap;
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

/// Where an open document lives.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Location {
    Tab { tab_id: String },
    Window { label: String },
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

struct Entry {
    location: Location,
    /// The resolved path at registration, so a second route to one file
    /// (a symlink) is found too.
    canonical: Option<PathBuf>,
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
        let canonical = std::fs::canonicalize(path).ok();
        self.lock().insert(
            path.to_path_buf(),
            Entry {
                location,
                canonical,
            },
        );
    }

    pub fn remove(&self, path: &Path) {
        self.lock().remove(path);
    }

    /// Where `path` is open: under the same name, or through a link to the
    /// same file (a rule that stops two dirty copies of one file).
    pub fn get(&self, path: &Path) -> Option<Location> {
        let map = self.lock();
        if let Some(e) = map.get(path) {
            return Some(e.location.clone());
        }
        let canon = std::fs::canonicalize(path).ok()?;
        map.values()
            .find(|e| e.canonical.as_deref() == Some(canon.as_path()))
            .map(|e| e.location.clone())
    }

    /// The path open in window `label`.
    pub fn path_of_window(&self, label: &str) -> Option<PathBuf> {
        self.lock()
            .iter()
            .find(|(_, e)| matches!(&e.location, Location::Window { label: l } if l == label))
            .map(|(p, _)| p.clone())
    }

    /// Forgets what window `label` held.
    pub fn remove_window(&self, label: &str) {
        self.lock()
            .retain(|_, e| !matches!(&e.location, Location::Window { label: l } if l == label));
    }

    /// Forgets every tab. Tabs live only in the main window, so this is what
    /// its closing leaves.
    pub fn remove_tabs(&self) {
        self.lock()
            .retain(|_, e| !matches!(e.location, Location::Tab { .. }));
    }
}

/// The rules. `is_text` is whether the editor can open the file (D6.1);
/// `path_is_dir` follows links, so a link to a folder is a folder.
pub fn route(
    path: &Path,
    origin: Origin,
    gesture: Gesture,
    is_text: bool,
    open: &OpenRegistry,
) -> Target {
    route_kind(path, path.is_dir(), origin, gesture, is_text, open)
}

/// [`route`] with the folder test given.
pub fn route_kind(
    path: &Path,
    is_dir: bool,
    origin: Origin,
    gesture: Gesture,
    is_text: bool,
    open: &OpenRegistry,
) -> Target {
    if let Some(loc) = open.get(path) {
        return Target::Focus(loc);
    }
    let p = path.to_path_buf();
    if is_dir {
        Target::FolderTab(p)
    } else if !is_text {
        Target::DefaultApp(p)
    } else if origin == Origin::Outside || gesture == Gesture::NewWindow {
        Target::DocWindow(p)
    } else {
        Target::DocTab(p)
    }
}
