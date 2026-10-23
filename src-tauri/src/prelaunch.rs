// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Launches that need no Kern window, handled before the application starts.
//!
//! `kern photo.png` only has to start the default application for the file.
//! Doing that before the session-bus name is claimed means such a process
//! never owns the name, so it can never swallow a launch forwarded to it,
//! and no window or webview is started for it. Anything that needs a window
//! (no arguments, a folder, a text file) goes on to claim the name or
//! forward to the running instance. Kinds are decided as in design D4.3 and
//! D6.1 by kernkraft's MIME database.

use std::path::{Path, PathBuf};

use kernkraft_fs::base_dirs;
use kernkraft_xdg_apps::{launch_in_terminal, AppRegistry, DesktopEntry, MimeDb};

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

/// Starts each file's default application, one launch per application with
/// all its files. Every file is checked first: if one has no default
/// application nothing is started, as with kernkraft's `open_default`.
fn launch_default(base: &kernkraft_fs::BaseDirs, db: &MimeDb, files: &[PathBuf]) -> Vec<String> {
    if files.is_empty() {
        return Vec::new();
    }
    let registry = match AppRegistry::load(base) {
        Ok(r) => r,
        Err(e) => return vec![e.to_string()],
    };
    let mut groups: Vec<(&DesktopEntry, Vec<PathBuf>)> = Vec::new();
    for f in files {
        let mime = db.guess(f);
        let Some(app) = registry.default_for(&mime, db) else {
            return vec![format!(
                "{}: no default application for {mime}",
                f.display()
            )];
        };
        match groups.iter_mut().find(|(a, _)| a.id == app.id) {
            Some((_, g)) => g.push(f.clone()),
            None => groups.push((app, vec![f.clone()])),
        }
    }
    // The terminal setting matters only to an application that wants one.
    let terminal = if groups.iter().any(|(a, _)| a.terminal) {
        match Store::from_base_dirs(base).settings_get() {
            Ok(l) => l.value.terminal,
            Err(e) => return vec![format!("reading the terminal setting: {}", e.message)],
        }
    } else {
        None
    };
    let mut failures = Vec::new();
    for (app, group) in groups {
        if let Err(e) = launch_in_terminal(app, &group, None, terminal.as_deref()) {
            failures.push(format!("{}: {e}", app.id));
            break;
        }
    }
    failures
}
