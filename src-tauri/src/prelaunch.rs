// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Launches that need no Kern window, handled before the application starts.
//!
//! `kern photo.png` only has to start the default application for the file.
//! Doing that before the session-bus name is claimed means such a process
//! never owns the name, so it can never swallow a launch forwarded to it,
//! and no window or webview is started for it. Anything that needs a window
//! (no arguments, a folder, a text file) goes on to claim the name or
//! forward to the running instance. A folder is a window, and so is a
//! file kernkraft's MIME database says the editor opens as text.
//!
//! `--apply-settings FILE` is also finished here: it writes the settings and
//! exits without a window or the bus name.

use std::path::{Path, PathBuf};

use kernkraft_fs::base_dirs;
use kernkraft_xdg_apps::{default_groups, launch_groups, AppRegistry, MimeDb, TerminalPrefs};

use crate::cli::{self, Plan};
use crate::instance::Invocation;
use crate::store::Store;

/// What one argument asks for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Class {
    /// A folder or a text file: a Kern window.
    Window,
    /// Any other file: its default application.
    DefaultApp(PathBuf),
    /// Cannot be opened; the reason is reported.
    Failed(String),
}

/// Whether the launch needs a Kern window. `arg_count` counts the
/// arguments that give a path or an error; none means the main window with
/// a Home tab. Arguments that only fail or go to default applications need
/// none.
pub fn needs_window(arg_count: usize, classes: &[Class]) -> bool {
    arg_count == 0 || classes.iter().any(|c| matches!(c, Class::Window))
}

/// The process status of a launch without a window: 0 when everything
/// started, else 1.
pub fn status(failures: usize) -> i32 {
    i32::from(failures > 0)
}

fn classify(path: &Path, db: &Result<MimeDb, String>) -> Class {
    match std::fs::metadata(path) {
        Err(e) => Class::Failed(format!("{}: {e}", path.display())),
        Ok(m) if m.is_dir() => Class::Window,
        Ok(_) => match db {
            Err(e) => Class::Failed(format!("{}: {e}", path.display())),
            Ok(db) if db.is_text(&db.guess(path)) => Class::Window,
            Ok(_) => Class::DefaultApp(path.to_path_buf()),
        },
    }
}

/// Handles the launch if it needs no window and returns the process status;
/// `None` means the application should start. Errors go to stderr.
pub fn run(inv: &Invocation) -> Option<i32> {
    let parsed = match cli::plan(&inv.argv, &inv.cwd) {
        Plan::Home => return None,
        Plan::Open(p) => p,
        Plan::ApplySettings(file) => return Some(apply_settings_launch(&file)),
    };
    let base = base_dirs();
    let db: Result<MimeDb, String> = match &base {
        Some(b) => MimeDb::load(
            &std::iter::once(b.data.clone())
                .chain(b.data_dirs.iter().cloned())
                .collect::<Vec<_>>(),
        )
        .map_err(|e| e.to_string()),
        None => Err("HOME is not set to an absolute path".to_owned()),
    };
    let classes: Vec<Class> = parsed.paths.iter().map(|p| classify(p, &db)).collect();
    if needs_window(parsed.paths.len() + parsed.errors.len(), &classes) {
        return None;
    }
    let mut failures: Vec<String> = parsed.errors.iter().map(ToString::to_string).collect();
    let mut apps = Vec::new();
    for c in classes {
        match c {
            Class::DefaultApp(p) => apps.push(p),
            Class::Failed(e) => failures.push(e),
            Class::Window => {}
        }
    }
    if let (Some(base), Ok(db)) = (&base, &db) {
        failures.extend(launch_default(base, db, &apps));
    }
    for f in &failures {
        eprintln!("kern: {f}");
    }
    Some(status(failures.len()))
}

/// Applies the settings patch in `file` to the user's store, reporting a
/// failure on stderr: 0 when written, else 1.
fn apply_settings_launch(file: &Path) -> i32 {
    let Some(base) = base_dirs() else {
        eprintln!("kern: HOME is not set to an absolute path");
        return 1;
    };
    match apply_settings(&Store::from_base_dirs(&base), file) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("kern: {e}");
            1
        }
    }
}

/// Merges the JSON object in `file` into `store`'s settings through
/// [`Store::settings_set`], which refuses the whole patch (and writes
/// nothing) when any field is unknown or out of range.
pub fn apply_settings(store: &Store, file: &Path) -> Result<(), String> {
    let bytes = std::fs::read(file).map_err(|e| format!("{}: {e}", file.display()))?;
    let patch = match serde_json::from_slice(&bytes) {
        Ok(serde_json::Value::Object(m)) => m,
        Ok(_) => return Err(format!("{}: not a JSON object", file.display())),
        Err(e) => return Err(format!("{}: {e}", file.display())),
    };
    store
        .settings_set(patch)
        .map(|_| ())
        .map_err(|e| format!("{}: {}", file.display(), e.message))
}

/// Starts each file's default application, one launch per application with
/// all its files, as kernkraft's `open_default` does. Every file is checked
/// first: if one has no default application nothing is started. An
/// application that fails to start is reported and does not stop the ones
/// after it; there is one failure line per such application.
fn launch_default(base: &kernkraft_fs::BaseDirs, db: &MimeDb, files: &[PathBuf]) -> Vec<String> {
    if files.is_empty() {
        return Vec::new();
    }
    let registry = match AppRegistry::load(base) {
        Ok(r) => r,
        Err(e) => return vec![e.to_string()],
    };
    let groups = match default_groups(&registry, db, files) {
        Ok(g) => g,
        Err(e) => return vec![e.to_string()],
    };
    // The terminal setting matters only to an application that wants one.
    let terminal = if groups.iter().any(|g| g.app.terminal) {
        match Store::from_base_dirs(base).settings_get() {
            Ok(l) => l.value.terminal,
            Err(e) => return vec![format!("reading the terminal setting: {}", e.message)],
        }
    } else {
        None
    };
    let prefs = TerminalPrefs {
        setting: terminal.as_deref(),
        base: Some(base),
    };
    launch_groups(&groups, &prefs)
        .into_iter()
        .filter_map(|o| o.result.err().map(|e| format!("{}: {e}", o.app)))
        .collect()
}
