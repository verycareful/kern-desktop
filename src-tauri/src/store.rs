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
//! A file that is not a JSON document of the expected shape is never reset in
//! place: it is moved aside to `<name>.corrupt-<unix-seconds>` (suffixes `-1`,
//! `-2` on a collision, and never over an existing copy) and the caller gets
//! a [`CorruptReport`] once; the next read finds no file and uses defaults.
//!
//! `settings.json` is read field by field. A field this version cannot
//! parse (a value a newer Kern wrote, say) keeps its raw JSON, is written
//! back unchanged, and is reported once per run; in memory it holds its
//! default. Unknown keys, including unknown keys inside `follow`, survive a
//! rewrite.
//!
//! Paths are stored as [`WirePath`], so a name that is not UTF-8 survives.

use std::collections::HashSet;
use std::fs;
use std::io::{self, ErrorKind};
use std::marker::PhantomData;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use kernkraft_fs::{write_bytes_atomic, BaseDirs};
use kernkraft_tauri::{WireError, WireItemError, WirePath};
use kernkraft_theme::{Density, Follow, KernAccent, Mode};
use rustix::fs::{renameat_with, RenameFlags, CWD};
use rustix::io::Errno;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Most recents kept: two screens of the panel; older entries drop.
pub const RECENTS_CAP: usize = 50;

/// Smallest and largest editor zoom factor: 25% to 500%, the range Chromium
/// documents for page zoom, which the editor's zoom keys mirror.
pub const ZOOM_MIN: f32 = 0.25;
pub const ZOOM_MAX: f32 = 5.0;

/// The interface sizes, in percent of the webview's normal size: the steps of
/// the Larger and Smaller actions (maintainer, 2026-10-28). The frontend's
/// `INTERFACE_SIZES` lists the same values.
pub const INTERFACE_SIZES: [u32; 5] = [80, 90, 100, 110, 125];
/// A little smaller than the webview's normal size (maintainer, 2026-10-28).
pub const DEFAULT_INTERFACE_SIZE: u32 = 90;

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
/// are exactly what `theme_set_prefs` takes. The two maps are not part of
/// the wire form: they hold what a rewrite must put back.
#[derive(Clone, Debug, PartialEq, Serialize)]
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
    /// Editor zoom factor, [`ZOOM_MIN`] to [`ZOOM_MAX`]; 1.0 is the theme's
    /// size.
    pub editor_zoom: f32,
    pub view_mode: ViewMode,
    pub show_hidden: bool,
    /// The interface size in percent, one of [`INTERFACE_SIZES`]; applied as
    /// the zoom of every window (`zoom.rs`).
    pub interface_size: u32,
    /// Keys inside `follow` this version does not define.
    #[serde(skip)]
    pub follow_extra: Map<String, Value>,
    /// Top-level keys this version does not define, and the raw value of
    /// any defined field that did not parse (it overrides the field's
    /// default when written).
    #[serde(skip)]
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
            interface_size: DEFAULT_INTERFACE_SIZE,
            follow_extra: Map::new(),
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

/// A store file that was moved aside (`moved_to` set), or a settings field
/// that could not be read and was kept as it is (`field` set).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CorruptReport {
    /// The file's name, e.g. `pins.json`.
    pub file: String,
    /// Where the unreadable file now is.
    pub moved_to: Option<WirePath>,
    /// The settings field that did not parse.
    pub field: Option<String>,
    /// Why it did not parse.
    pub reason: String,
}

/// A store file's value, with what happened while loading and changing it.
#[derive(Clone, Debug, PartialEq)]
pub struct Loaded<T> {
    pub value: T,
    /// Problems found while loading, each reported once per run.
    pub corrupt: Vec<CorruptReport>,
    /// Whether the call changed and rewrote the file.
    pub changed: bool,
}

/// What [`Store::prune`] did, with the stores as they are afterwards. An
/// entry is dropped only when its target is gone; every other outcome keeps
/// it, and failures to find out are in `errors`.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct PruneReport {
    pub pins_removed: Vec<WirePath>,
    pub recents_removed: Vec<WirePath>,
    pub errors: Vec<WireItemError>,
    /// Store problems found on the way (see [`CorruptReport`]).
    pub corrupt: Vec<CorruptReport>,
    pub pins: Pins,
    pub recents: Recents,
}

fn werr(kind: &str, message: String, path: Option<&Path>) -> WireError {
    WireError {
        kind: kind.to_owned(),
        message,
        path: path.map(WirePath::from),
        details: None,
    }
}

fn io_err(path: &Path, e: &io::Error) -> WireError {
    werr("Io", format!("{}: {e}", path.display()), Some(path))
}

fn invalid(what: &str, e: impl std::fmt::Display) -> WireError {
    werr("InvalidArgument", format!("invalid {what}: {e}"), None)
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // The guarded values only order file access or remember what was
    // reported, and the file is re-read under the lock, so a poisoned lock
    // holds no half-state.
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn since_epoch() -> Result<std::time::Duration, WireError> {
    SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| {
        werr(
            "Clock",
            format!("the system clock is before 1970: {e}"),
            None,
        )
    })
}

fn unix_secs() -> Result<u64, WireError> {
    Ok(since_epoch()?.as_secs())
}

fn unix_ms() -> Result<u64, WireError> {
    Ok(u64::try_from(since_epoch()?.as_millis()).unwrap_or(u64::MAX))
}

/// Moves `path` to `<path>.corrupt-<unix_secs>`, or `-1`, `-2`, ... after
/// it when that name is taken. The kernel does the move with
/// `renameat2(RENAME_NOREPLACE)`, so nothing is ever overwritten; on a
/// filesystem without that flag (`EINVAL`, or `ENOSYS` on an old kernel) a
/// hard link, which also fails if the name exists, followed by removing the
/// original does the same. Returns the new path.
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
        let moved = match renameat_with(CWD, path, CWD, &to, RenameFlags::NOREPLACE) {
            Ok(()) => Ok(()),
            Err(Errno::INVAL | Errno::NOSYS) => fs::hard_link(path, &to)
                .and_then(|()| fs::remove_file(path))
                .map_err(|e| (e.kind(), e)),
            Err(e) => {
                let e = io::Error::from(e);
                Err((e.kind(), e))
            }
        };
        match moved {
            Ok(()) => return Ok(to),
            Err((ErrorKind::AlreadyExists, _)) => {}
            Err((_, e)) => return Err(io_err(&to, &e)),
        }
    }
    unreachable!("the loop ends by returning")
}

/// A field of a file that could not be read.
struct FieldProblem {
    field: String,
    reason: String,
}

/// A value a [`JsonFile`] holds: how to read it from JSON and write it back.
trait Stored: Default {
    /// Reads the document. `Err` means it is not a document of this kind at
    /// all (the file is moved aside); field problems are returned beside a
    /// usable value.
    fn parse(value: Value) -> Result<(Self, Vec<FieldProblem>), String>;
    fn render(&self) -> Result<Value, String>;
}

macro_rules! stored_by_serde {
    ($t:ty) => {
        impl Stored for $t {
            fn parse(value: Value) -> Result<(Self, Vec<FieldProblem>), String> {
                serde_json::from_value(value)
                    .map(|v| (v, Vec::new()))
                    .map_err(|e| e.to_string())
            }
            fn render(&self) -> Result<Value, String> {
                serde_json::to_value(self).map_err(|e| e.to_string())
            }
        }
    };
}
stored_by_serde!(Pins);
stored_by_serde!(Recents);

/// Reads `key` of `obj` into `slot`. A value that does not parse, or that
/// `check` refuses, is a problem: the raw value goes to `keep` and `slot`
/// stays at its default.
fn take<T: DeserializeOwned>(
    obj: &mut Map<String, Value>,
    key: &str,
    slot: &mut T,
    keep: &mut Map<String, Value>,
    problems: &mut Vec<FieldProblem>,
    check: impl Fn(&T) -> Result<(), String>,
) {
    let Some(raw) = obj.remove(key) else {
        return;
    };
    let parsed = serde_json::from_value::<T>(raw.clone())
        .map_err(|e| e.to_string())
        .and_then(|v| check(&v).map(|()| v));
    match parsed {
        Ok(v) => *slot = v,
        Err(reason) => {
            problems.push(FieldProblem {
                field: key.to_owned(),
                reason,
            });
            keep.insert(key.to_owned(), raw);
        }
    }
}

/// The names of the keys of `follow` that this version defines.
const FOLLOW_KEYS: [&str; 4] = ["colours", "accent", "fonts", "radius"];

/// Reads `follow`: the known switches (a missing one is on, the default),
/// and the keys beside them.
fn parse_follow(raw: &Value) -> Result<(Follow, Map<String, Value>), String> {
    let Value::Object(given) = raw else {
        return Err("not an object".to_owned());
    };
    let Ok(Value::Object(mut base)) = serde_json::to_value(Follow::default()) else {
        return Err("the default follow switches do not serialise".to_owned());
    };
    let mut extra = Map::new();
    for (k, v) in given {
        if FOLLOW_KEYS.contains(&k.as_str()) {
            base.insert(k.clone(), v.clone());
        } else {
            extra.insert(k.clone(), v.clone());
        }
    }
    let follow =
        serde_json::from_value::<Follow>(Value::Object(base)).map_err(|e| e.to_string())?;
    Ok((follow, extra))
}

/// Accepts every value of a type that parsed.
fn any_value<T>(_: &T) -> Result<(), String> {
    Ok(())
}

fn check_zoom(z: &f32) -> Result<(), String> {
    if z.is_finite() && (ZOOM_MIN..=ZOOM_MAX).contains(z) {
        Ok(())
    } else {
        Err(format!("zoom {z} is outside {ZOOM_MIN} to {ZOOM_MAX}"))
    }
}

fn check_interface_size(size: &u32) -> Result<(), String> {
    if INTERFACE_SIZES.contains(size) {
        Ok(())
    } else {
        Err(format!(
            "interface size {size} is not one of {INTERFACE_SIZES:?}"
        ))
    }
}

fn check_roots(roots: &[WirePath]) -> Result<(), String> {
    roots
        .iter()
        .try_for_each(|r| r.to_path_buf().map(|_| ()).map_err(|e| e.to_string()))
}

impl Stored for Settings {
    fn parse(value: Value) -> Result<(Settings, Vec<FieldProblem>), String> {
        let Value::Object(mut obj) = value else {
            return Err("not a JSON object".to_owned());
        };
        let mut s = Settings::default();
        let mut keep = Map::new();
        let mut problems = Vec::new();
        take(
            &mut obj,
            "theme_mode",
            &mut s.theme_mode,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "accent",
            &mut s.accent,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "density",
            &mut s.density,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "scan_roots",
            &mut s.scan_roots,
            &mut keep,
            &mut problems,
            |r: &Vec<WirePath>| check_roots(r),
        );
        take(
            &mut obj,
            "scan_documents",
            &mut s.scan_documents,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "scan_downloads",
            &mut s.scan_downloads,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "terminal",
            &mut s.terminal,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "word_wrap",
            &mut s.word_wrap,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "editor_zoom",
            &mut s.editor_zoom,
            &mut keep,
            &mut problems,
            check_zoom,
        );
        take(
            &mut obj,
            "view_mode",
            &mut s.view_mode,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "show_hidden",
            &mut s.show_hidden,
            &mut keep,
            &mut problems,
            any_value,
        );
        take(
            &mut obj,
            "interface_size",
            &mut s.interface_size,
            &mut keep,
            &mut problems,
            check_interface_size,
        );
        if let Some(raw) = obj.remove("follow") {
            match parse_follow(&raw) {
                Ok((follow, extra)) => {
                    s.follow = follow;
                    s.follow_extra = extra;
                }
                Err(reason) => {
                    problems.push(FieldProblem {
                        field: "follow".to_owned(),
                        reason,
                    });
                    keep.insert("follow".to_owned(), raw);
                }
            }
        }
        s.extra = obj;
        s.extra.extend(keep);
        Ok((s, problems))
    }

    fn render(&self) -> Result<Value, String> {
        let Value::Object(mut out) = serde_json::to_value(self).map_err(|e| e.to_string())? else {
            return Err("settings are not an object".to_owned());
        };
        if let Some(Value::Object(follow)) = out.get_mut("follow") {
            follow.extend(self.follow_extra.clone());
        }
        out.extend(self.extra.clone());
        Ok(Value::Object(out))
    }
}

/// One JSON file with its lock.
struct JsonFile<T> {
    path: PathBuf,
    guard: Mutex<()>,
    /// Fields already reported this run; cleared by a write, which may fix
    /// them. Only touched under `guard`.
    reported: Mutex<HashSet<String>>,
    marker: PhantomData<fn() -> T>,
}

impl<T: Stored> JsonFile<T> {
    fn new(path: PathBuf) -> JsonFile<T> {
        JsonFile {
            path,
            guard: Mutex::new(()),
            reported: Mutex::new(HashSet::new()),
            marker: PhantomData,
        }
    }

    fn file_name(&self) -> String {
        self.path
            .file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    }

    /// Reads the file; a missing one is the default, one that is not a
    /// document of the right kind is moved aside and is the default too.
    /// Any other failure is an error.
    fn load(&self) -> Result<(T, Vec<CorruptReport>), WireError> {
        let bytes = match fs::read(&self.path) {
            Ok(b) => b,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok((T::default(), Vec::new())),
            Err(e) => return Err(io_err(&self.path, &e)),
        };
        let parsed = serde_json::from_slice::<Value>(&bytes)
            .map_err(|e| e.to_string())
            .and_then(T::parse);
        match parsed {
            Ok((value, problems)) => {
                let mut reported = lock(&self.reported);
                let reports = problems
                    .into_iter()
                    .filter(|p| reported.insert(p.field.clone()))
                    .map(|p| CorruptReport {
                        file: self.file_name(),
                        moved_to: None,
                        field: Some(p.field),
                        reason: p.reason,
                    })
                    .collect();
                Ok((value, reports))
            }
            Err(reason) => {
                let moved = move_aside(&self.path, unix_secs()?)?;
                Ok((
                    T::default(),
                    vec![CorruptReport {
                        file: self.file_name(),
                        moved_to: Some(WirePath::from(moved.as_path())),
                        field: None,
                        reason,
                    }],
                ))
            }
        }
    }

    fn save(&self, value: &T) -> Result<(), WireError> {
        let dir = self.path.parent().unwrap_or_else(|| Path::new("/"));
        fs::create_dir_all(dir).map_err(|e| io_err(dir, &e))?;
        let json = value.render().map_err(|e| {
            werr(
                "Internal",
                format!("serialising {}: {e}", self.file_name()),
                None,
            )
        })?;
        let mut bytes = serde_json::to_vec_pretty(&json).map_err(|e| {
            werr(
                "Internal",
                format!("serialising {}: {e}", self.file_name()),
                None,
            )
        })?;
        bytes.push(b'\n');
        write_bytes_atomic(&self.path, None, &bytes)?;
        lock(&self.reported).clear();
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
    /// this version does not define, a value of the wrong type, an
    /// `editor_zoom` outside [`ZOOM_MIN`] to [`ZOOM_MAX`], an `interface_size`
    /// that is not one of [`INTERFACE_SIZES`] or a scan root
    /// that is not an absolute path refuses the whole patch and writes
    /// nothing. A `null` clears `terminal`.
    ///
    /// `follow` may be sent partly: the switches it names are changed and
    /// the others keep their values. Every other field is replaced whole.
    pub fn settings_set(&self, patch: Map<String, Value>) -> Result<Loaded<Settings>, WireError> {
        let known = known_settings_keys();
        if let Some(bad) = patch.keys().find(|k| !known.contains(k.as_str())) {
            return Err(invalid("setting", format!("unknown field {bad:?}")));
        }
        self.settings.update(|current| {
            let Value::Object(mut merged) = current.render().map_err(|e| invalid("setting", e))?
            else {
                return Err(werr(
                    "Internal",
                    "settings are not an object".to_owned(),
                    None,
                ));
            };
            for (key, value) in &patch {
                match (merged.get_mut(key), value) {
                    (Some(Value::Object(have)), Value::Object(given)) if key == "follow" => {
                        have.extend(given.clone());
                    }
                    _ => {
                        merged.insert(key.clone(), value.clone());
                    }
                }
            }
            let (next, problems) =
                Settings::parse(Value::Object(merged)).map_err(|e| invalid("setting", e))?;
            if let Some(p) = problems.iter().find(|p| patch.contains_key(&p.field)) {
                return Err(invalid("setting", format!("{}: {}", p.field, p.reason)));
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
        self.recent_touch_at(path, unix_ms()?)
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
    /// and it is not on a removable volume that is absent. A volume is
    /// absent when its mount directory (see [`MOUNT_LAYOUTS`]) is missing
    /// or is not a mount point ([`volume_online`]); the entry is kept for
    /// when the volume returns. Any other `lstat` error keeps the entry and
    /// is reported in `errors`. A dangling symlink exists, so it stays.
    ///
    /// The paths are examined without holding a store lock (a hung network
    /// mount must not block pinning). The removals are then applied under
    /// the lock, to the entries still in the file: an entry added meanwhile
    /// is untouched.
    pub fn prune_with(&self, layouts: &[(PathBuf, usize)]) -> Result<PruneReport, WireError> {
        let mut report = PruneReport::default();
        let mut corrupt = Vec::new();

        let pins_seen = self.pins.get()?;
        let recents_seen = self.recents.get()?;
        corrupt.extend(pins_seen.corrupt);
        corrupt.extend(recents_seen.corrupt);
        let drop_pins = judge_all(pins_seen.value.entries.iter(), layouts, &mut report.errors);
        let drop_recents = judge_all(
            recents_seen.value.entries.iter().map(|e| &e.path),
            layouts,
            &mut report.errors,
        );

        let pins = self.pins.update(|pins| {
            pins.entries.retain(|e| {
                let gone = drop_pins.contains(e);
                if gone {
                    report.pins_removed.push(e.clone());
                }
                !gone
            });
            Ok(!report.pins_removed.is_empty())
        })?;
        let recents = self.recents.update(|recents| {
            recents.entries.retain(|e| {
                let gone = drop_recents.contains(&e.path);
                if gone {
                    report.recents_removed.push(e.path.clone());
                }
                !gone
            });
            Ok(!report.recents_removed.is_empty())
        })?;
        corrupt.extend(pins.corrupt);
        corrupt.extend(recents.corrupt);
        report.corrupt = corrupt;
        report.pins = pins.value;
        report.recents = recents.value;
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

/// Whether the volume mounted at `mount` is present: the directory exists
/// and is a mount point, which is when its device number differs from its
/// parent's (stat(2) `st_dev`). A missing directory, or one that only
/// remains as an empty directory after an unmount, is not.
pub fn volume_online(mount: &Path) -> io::Result<bool> {
    let dir = match fs::symlink_metadata(mount) {
        Ok(m) => m,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e),
    };
    let parent = fs::symlink_metadata(mount.parent().unwrap_or_else(|| Path::new("/")))?;
    Ok(dir.dev() != parent.dev())
}

/// The entries of `entries` to drop, judged by [`Store::prune_with`]'s
/// rules; failures to judge go to `errors` and keep the entry.
fn judge_all<'a>(
    entries: impl Iterator<Item = &'a WirePath>,
    layouts: &[(PathBuf, usize)],
    errors: &mut Vec<WireItemError>,
) -> Vec<WirePath> {
    let mut gone = Vec::new();
    for entry in entries {
        match judge(entry, layouts) {
            Ok(true) => gone.push(entry.clone()),
            Ok(false) => {}
            Err(error) => errors.push(WireItemError {
                path: entry.clone(),
                error,
            }),
        }
    }
    gone
}

/// Whether `entry` is to be dropped.
fn judge(entry: &WirePath, layouts: &[(PathBuf, usize)]) -> Result<bool, WireError> {
    let path = entry.to_path_buf()?;
    match fs::symlink_metadata(&path) {
        Ok(_) => Ok(false),
        Err(e) if e.kind() == ErrorKind::NotFound => match mount_dir(&path, layouts) {
            None => Ok(true),
            Some(mount) => volume_online(&mount).map_err(|e| io_err(&mount, &e)),
        },
        Err(e) => Err(io_err(&path, &e)),
    }
}
