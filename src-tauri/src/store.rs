// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Persistent settings, pins and recents (parent spec section 6.3).
//!
//! Three JSON files: `settings.json` under `$XDG_CONFIG_HOME/kern/`, and
//! `pins.json` and `recents.json` under `$XDG_STATE_HOME/kern/` (XDG Base
//! Directory Specification 0.8, `$XDG_CONFIG_HOME` and `$XDG_STATE_HOME`,
//! resolved by `kernkraft_fs::base_dirs_from`). Every write goes through
//! `kernkraft_fs::write_bytes_atomic`, so a crash leaves the old file or the
//! new one, never a torn one.
//!
//! Each file has its own lock, held across the whole read, change and write,
//! so two windows pinning at once cannot lose one of the pins. Fields this
//! version does not know are kept in a flattened map and written back, so a
//! newer or older Kern sharing the files does not lose them.
//!
//! A file that does not parse is never reset in place: it is moved aside to
//! `<name>.corrupt-<unix-seconds>` (suffixes `-1`, `-2` on a collision, and
//! never over an existing copy) and the caller gets a [`CorruptReport`] once;
//! the next read finds no file and uses defaults.
//!
//! Paths are stored as [`WirePath`], so a name that is not UTF-8 survives.

use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::marker::PhantomData;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use kernkraft_fs::{write_bytes_atomic, BaseDirs};
use kernkraft_tauri::{WireError, WireItemError, WirePath};
use kernkraft_theme::{Density, Follow, KernAccent, Mode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Most recents kept: two screens of the panel; older entries drop.
pub const RECENTS_CAP: usize = 50;

/// Directory name under the XDG config and state homes.
const APP_DIR: &str = "kern";

/// Where removable volumes are mounted, as (base directory, number of path
/// components below it that name the mount directory). UDisks mounts at
/// `/run/media/<user>/<label>`; `/media/<name>` and `/mnt/<name>` are the
/// traditional manual mount points.
pub const MOUNT_LAYOUTS: &[(&str, usize)] = &[("/run/media", 2), ("/media", 1), ("/mnt", 1)];

/// The Files view mode.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    #[default]
    List,
    Grid,
}

/// `settings.json`. Theme types are kernkraft-theme's, so the stored values
/// are exactly what `theme_set_prefs` takes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme_mode: Mode,
    pub accent: KernAccent,
    pub density: Density,
    pub follow: Follow,
    pub scan_roots: Vec<WirePath>,
    pub scan_documents: bool,
    pub scan_downloads: bool,
    /// The user's terminal command; `None` lets kernkraft pick one.
    pub terminal: Option<String>,
    pub word_wrap: bool,
    /// Editor zoom factor; 1.0 is the theme's size.
    pub editor_zoom: f32,
    pub view_mode: ViewMode,
    pub show_hidden: bool,
    /// Fields written by another version of Kern.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Settings {
    fn default() -> Settings {
        Settings {
            theme_mode: Mode::default(),
            accent: KernAccent::default(),
            density: Density::default(),
            follow: Follow::default(),
            scan_roots: Vec::new(),
            scan_documents: true,
            scan_downloads: true,
            terminal: None,
            word_wrap: false,
            editor_zoom: 1.0,
            view_mode: ViewMode::default(),
            show_hidden: false,
            extra: Map::new(),
        }
    }
}

/// `pins.json`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Pins {
    pub entries: Vec<WirePath>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// One recent file or folder.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RecentEntry {
    pub path: WirePath,
    /// Milliseconds since the Unix epoch when it was last opened.
    pub opened_ms: u64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// `recents.json`, newest first.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Recents {
    pub entries: Vec<RecentEntry>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A store file that did not parse and was moved aside.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CorruptReport {
    /// The file's name, e.g. `pins.json`.
    pub file: String,
    /// Where the unreadable file now is.
    pub moved_to: WirePath,
    /// Why it did not parse.
    pub reason: String,
}

/// A store file's value, with what happened while loading and changing it.
#[derive(Clone, Debug, PartialEq)]
pub struct Loaded<T> {
    pub value: T,
    /// Set when the file was unreadable JSON and defaults were used.
    pub corrupt: Option<CorruptReport>,
    /// Whether the call changed and rewrote the file.
    pub changed: bool,
}

/// What [`Store::prune`] did. An entry is dropped only when its target is
/// gone; every other outcome keeps it, and failures to find out are in
/// `errors`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct PruneReport {
    pub pins_removed: Vec<WirePath>,
    pub recents_removed: Vec<WirePath>,
    pub errors: Vec<WireItemError>,
    /// Set when a store file was unreadable (see [`CorruptReport`]).
    pub corrupt: Vec<CorruptReport>,
}

fn werr(kind: &str, message: String, path: Option<&Path>) -> WireError {
    WireError {
        kind: kind.to_owned(),
        message,
        path: path.map(WirePath::from),
        details: None,
    }
}

fn io_err(path: &Path, e: &std::io::Error) -> WireError {
    werr("Io", format!("{}: {e}", path.display()), Some(path))
}

fn invalid(what: &str, e: impl std::fmt::Display) -> WireError {
    werr("InvalidArgument", format!("invalid {what}: {e}"), None)
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // The guarded value is `()`: the lock only orders file access, and the
    // file is re-read under it, so a poisoned lock holds no half-state.
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// Moves `path` to `<path>.corrupt-<unix_secs>`, or `-1`, `-2`, ... after
/// it when that name is taken. The move is a hard link (which fails if the
/// name exists, so nothing is overwritten) followed by removing the
/// original. Returns the new path.
pub fn move_aside(path: &Path, unix_secs: u64) -> Result<PathBuf, WireError> {
    let name = path
        .file_name()
        .ok_or_else(|| werr("InvalidArgument", "no file name".to_owned(), Some(path)))?
        .to_string_lossy()
        .into_owned();
    let dir = path.parent().unwrap_or_else(|| Path::new("/"));
    for n in 0u64.. {
        let candidate = if n == 0 {
            format!("{name}.corrupt-{unix_secs}")
        } else {
            format!("{name}.corrupt-{unix_secs}-{n}")
        };
        let to = dir.join(candidate);
        match fs::hard_link(path, &to) {
            Ok(()) => {
                fs::remove_file(path).map_err(|e| io_err(path, &e))?;
                return Ok(to);
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
            Err(e) => return Err(io_err(&to, &e)),
        }
    }
    unreachable!("the loop ends by returning")
}

/// One JSON file with its lock.
struct JsonFile<T> {
    path: PathBuf,
    guard: Mutex<()>,
    marker: PhantomData<fn() -> T>,
}

impl<T: Serialize + DeserializeOwned + Default> JsonFile<T> {
    fn new(path: PathBuf) -> JsonFile<T> {
        JsonFile {
            path,
            guard: Mutex::new(()),
            marker: PhantomData,
        }
    }

    fn file_name(&self) -> String {
        self.path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    }

    /// Reads the file; a missing one is the default, an unparsable one is
    /// moved aside and is the default too. Any other failure is an error.
    fn load(&self) -> Result<(T, Option<CorruptReport>), WireError> {
        let bytes = match fs::read(&self.path) {
            Ok(b) => b,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok((T::default(), None)),
            Err(e) => return Err(io_err(&self.path, &e)),
        };
        match serde_json::from_slice::<T>(&bytes) {
            Ok(v) => Ok((v, None)),
            Err(e) => {
                let moved = move_aside(&self.path, unix_secs())?;
                Ok((
                    T::default(),
                    Some(CorruptReport {
                        file: self.file_name(),
                        moved_to: WirePath::from(moved.as_path()),
                        reason: e.to_string(),
                    }),
                ))
            }
        }
    }

    fn save(&self, value: &T) -> Result<(), WireError> {
        let dir = self.path.parent().unwrap_or_else(|| Path::new("/"));
        fs::create_dir_all(dir).map_err(|e| io_err(dir, &e))?;
        let mut bytes = serde_json::to_vec_pretty(value).map_err(|e| {
            werr(
                "Internal",
                format!("serialising {}: {e}", self.file_name()),
                None,
            )
        })?;
        bytes.push(b'\n');
        write_bytes_atomic(&self.path, None, &bytes)?;
        Ok(())
    }

    fn get(&self) -> Result<Loaded<T>, WireError> {
        let _held = lock(&self.guard);
        let (value, corrupt) = self.load()?;
        Ok(Loaded {
            value,
            corrupt,
            changed: false,
        })
    }

    /// Loads, runs `change` (which returns whether it changed the value),
    /// and writes only when it did, all under the file's lock. A `change`
    /// error writes nothing.
    fn update(
        &self,
        change: impl FnOnce(&mut T) -> Result<bool, WireError>,
    ) -> Result<Loaded<T>, WireError> {
        let _held = lock(&self.guard);
        let (mut value, corrupt) = self.load()?;
        let changed = change(&mut value)?;
        if changed {
            self.save(&value)?;
        }
        Ok(Loaded {
            value,
            corrupt,
            changed,
        })
    }
}

/// The three stores of one user.
pub struct Store {
    settings: JsonFile<Settings>,
    pins: JsonFile<Pins>,
    recents: JsonFile<Recents>,
}

impl Store {
    /// A store keeping `settings.json` in `config_dir` and the other two
    /// files in `state_dir`. Neither directory is created until a write.
    pub fn new(config_dir: PathBuf, state_dir: PathBuf) -> Store {
        Store {
            settings: JsonFile::new(config_dir.join("settings.json")),
            pins: JsonFile::new(state_dir.join("pins.json")),
            recents: JsonFile::new(state_dir.join("recents.json")),
        }
    }

    /// The store under `$XDG_CONFIG_HOME/kern` and `$XDG_STATE_HOME/kern`.
    pub fn from_base_dirs(base: &BaseDirs) -> Store {
        Store::new(base.config.join(APP_DIR), base.state.join(APP_DIR))
    }

    pub fn settings_get(&self) -> Result<Loaded<Settings>, WireError> {
        self.settings.get()
    }

    /// Merges `patch` (field name to new value) into the settings. A field
    /// this version does not define, a value of the wrong type, or a scan
    /// root that is not an absolute path refuses the whole patch and writes
    /// nothing. A `null` clears `terminal`.
    pub fn settings_set(&self, patch: Map<String, Value>) -> Result<Loaded<Settings>, WireError> {
        let known = known_settings_keys();
        if let Some(bad) = patch.keys().find(|k| !known.contains(k.as_str())) {
            return Err(invalid("setting", format!("unknown field {bad:?}")));
        }
        self.settings.update(|current| {
            let Value::Object(mut merged) = serde_json::to_value(&*current)
                .map_err(|e| werr("Internal", format!("serialising settings: {e}"), None))?
            else {
                return Err(werr(
                    "Internal",
                    "settings are not an object".to_owned(),
                    None,
                ));
            };
            merged.extend(patch);
            let next: Settings =
                serde_json::from_value(Value::Object(merged)).map_err(|e| invalid("setting", e))?;
            for root in &next.scan_roots {
                root.to_path_buf()?;
            }
            let changed = next != *current;
            *current = next;
            Ok(changed)
        })
    }

    pub fn pins_get(&self) -> Result<Loaded<Pins>, WireError> {
        self.pins.get()
    }

    /// Pins `path` at the end. Pinning a pinned path changes nothing.
    pub fn pin(&self, path: &WirePath) -> Result<Loaded<Pins>, WireError> {
        let key = path.to_path_buf()?;
        self.pins.update(|pins| {
            if pins.entries.iter().any(|e| same_path(e, &key)) {
                return Ok(false);
            }
            pins.entries.push(WirePath::from(key.as_path()));
            Ok(true)
        })
    }

    pub fn unpin(&self, path: &WirePath) -> Result<Loaded<Pins>, WireError> {
        let key = path.to_path_buf()?;
        self.pins.update(|pins| {
            let before = pins.entries.len();
            pins.entries.retain(|e| !same_path(e, &key));
            Ok(pins.entries.len() != before)
        })
    }

    /// Puts the pins in the order of `paths`. A pin the request omits keeps
    /// its place after the named ones (another window may have pinned it
    /// meanwhile), and a path that is not pinned (unpinned meanwhile) is
    /// skipped; no pin is ever lost by a reorder.
    pub fn pins_reorder(&self, paths: &[WirePath]) -> Result<Loaded<Pins>, WireError> {
        let wanted = paths
            .iter()
            .map(WirePath::to_path_buf)
            .collect::<Result<Vec<_>, _>>()?;
        self.pins.update(|pins| {
            let before = pins.entries.clone();
            let mut rest = std::mem::take(&mut pins.entries);
            let mut ordered = Vec::with_capacity(rest.len());
            for key in &wanted {
                if let Some(i) = rest.iter().position(|e| same_path(e, key)) {
                    ordered.push(rest.remove(i));
                }
            }
            ordered.extend(rest);
            let changed = ordered != before;
            pins.entries = ordered;
            Ok(changed)
        })
    }

    pub fn recents_get(&self) -> Result<Loaded<Recents>, WireError> {
        self.recents.get()
    }

    /// Records `path` as opened now.
    pub fn recent_touch(&self, path: &WirePath) -> Result<Loaded<Recents>, WireError> {
        self.recent_touch_at(path, unix_ms())
    }

    /// Records `path` as opened at `opened_ms`: an existing entry moves to
    /// the top (keeping its unknown fields), a new one is inserted there,
    /// and entries beyond [`RECENTS_CAP`] drop.
    pub fn recent_touch_at(
        &self,
        path: &WirePath,
        opened_ms: u64,
    ) -> Result<Loaded<Recents>, WireError> {
        let key = path.to_path_buf()?;
        self.recents.update(|recents| {
            let mut entry = match recents
                .entries
                .iter()
                .position(|e| same_path(&e.path, &key))
            {
                Some(i) => recents.entries.remove(i),
                None => RecentEntry {
                    path: WirePath::from(key.as_path()),
                    opened_ms,
                    extra: Map::new(),
                },
            };
            entry.opened_ms = opened_ms;
            recents.entries.insert(0, entry);
            recents.entries.truncate(RECENTS_CAP);
            Ok(true)
        })
    }

    /// Drops the pins and recents whose target is gone, using the system's
    /// removable-volume mount points ([`MOUNT_LAYOUTS`]).
    pub fn prune(&self) -> Result<PruneReport, WireError> {
        let layouts: Vec<(PathBuf, usize)> = MOUNT_LAYOUTS
            .iter()
            .map(|(base, depth)| (PathBuf::from(base), *depth))
            .collect();
        self.prune_with(&layouts)
    }

    /// [`Store::prune`] with the mount layouts given.
    ///
    /// An entry is dropped only when `lstat` says its path does not exist
    /// and it is not on a removable volume that is currently absent (its
    /// mount directory is itself missing: the volume is unplugged, not the
    /// file deleted). Any other `lstat` error keeps the entry and is
    /// reported in `errors`. A dangling symlink exists, so it stays.
    pub fn prune_with(&self, layouts: &[(PathBuf, usize)]) -> Result<PruneReport, WireError> {
        let mut report = PruneReport::default();
        let mut errors = Vec::new();
        let pins = self.pins.update(|pins| {
            let mut removed = Vec::new();
            pins.entries
                .retain(|e| keep_entry(e, layouts, &mut removed, &mut errors));
            let changed = !removed.is_empty();
            report.pins_removed = removed;
            Ok(changed)
        })?;
        let recents = self.recents.update(|recents| {
            let mut removed = Vec::new();
            recents
                .entries
                .retain(|e| keep_entry(&e.path, layouts, &mut removed, &mut errors));
            let changed = !removed.is_empty();
            report.recents_removed = removed;
            Ok(changed)
        })?;
        report.errors = errors;
        report.corrupt = [pins.corrupt, recents.corrupt]
            .into_iter()
            .flatten()
            .collect();
        Ok(report)
    }
}

/// The field names a settings patch may carry.
fn known_settings_keys() -> HashSet<String> {
    match serde_json::to_value(Settings::default()) {
        Ok(Value::Object(m)) => m.into_iter().map(|(k, _)| k).collect(),
        _ => HashSet::new(),
    }
}

/// Whether the stored path is `key`. A stored value that does not decode
/// never matches, so it can only be removed by editing the file.
fn same_path(stored: &WirePath, key: &Path) -> bool {
    stored.to_path_buf().is_ok_and(|p| p == key)
}

/// The mount directory `path` lies on, when it is under one of `layouts`.
fn mount_dir(path: &Path, layouts: &[(PathBuf, usize)]) -> Option<PathBuf> {
    layouts.iter().find_map(|(base, depth)| {
        let rest = path.strip_prefix(base).ok()?;
        let mut dir = base.clone();
        let mut taken = 0;
        for c in rest.components().take(*depth) {
            dir.push(c);
            taken += 1;
        }
        (taken == *depth).then_some(dir)
    })
}

/// Decides one entry for [`Store::prune_with`]: true keeps it. A dropped
/// path is added to `removed`, a failure to decide to `errors`.
fn keep_entry(
    entry: &WirePath,
    layouts: &[(PathBuf, usize)],
    removed: &mut Vec<WirePath>,
    errors: &mut Vec<WireItemError>,
) -> bool {
    let path = match entry.to_path_buf() {
        Ok(p) => p,
        Err(e) => {
            errors.push(WireItemError {
                path: entry.clone(),
                error: e.into(),
            });
            return true;
        }
    };
    let mut fail = |at: &Path, e: &std::io::Error| {
        errors.push(WireItemError {
            path: entry.clone(),
            error: io_err(at, e),
        });
        true
    };
    match fs::symlink_metadata(&path) {
        Ok(_) => true,
        Err(e) if e.kind() == ErrorKind::NotFound => match mount_dir(&path, layouts) {
            None => {
                removed.push(entry.clone());
                false
            }
            Some(mount) => match fs::symlink_metadata(&mount) {
                Err(m) if m.kind() == ErrorKind::NotFound => true,
                Ok(_) => {
                    removed.push(entry.clone());
                    false
                }
                Err(m) => fail(&mount, &m),
            },
        },
        Err(e) => fail(&path, &e),
    }
}
