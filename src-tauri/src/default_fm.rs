// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Whether Kern is the default file manager, and making it so.
//!
//! The default application for a type is the first desktop file ID the
//! association files name for it that is installed (MIME Applications
//! Associations 1.0.1, "Default Applications"), which kernkraft resolves.
//! The file manager is the default application for `inode/directory`
//! (Shared MIME-info Database 0.21). Making Kern the default runs
//! `xdg-mime default` through kernkraft, and only when the user asks.

use kernkraft_fs::{base_dirs, BaseDirs};
use kernkraft_tauri::WireError;
use kernkraft_xdg_apps::{set_default, AppRegistry, AppsError, MimeDb};
use serde::Serialize;

use crate::windows::{blocking, wire_error};

/// Kern's desktop file ID (the desktop entry is installed under this name).
pub const DEFAULT_FM_DESKTOP_ID: &str = "io.github.verycareful.kern.desktop";
/// The MIME type a file manager handles.
pub const DIRECTORY_MIME: &str = "inode/directory";

/// Who is the default file manager.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DefaultFm {
    pub is_default: bool,
    /// The desktop file ID of the current default, if there is one.
    pub current: Option<String>,
}

fn base() -> Result<BaseDirs, WireError> {
    base_dirs().ok_or_else(|| {
        wire_error(
            "NoHome",
            "HOME is unset, empty or not absolute, so the default applications cannot be found",
            None,
        )
    })
}

/// The current default for `inode/directory` under `base`.
pub fn status_in(base: &BaseDirs) -> Result<DefaultFm, WireError> {
    let registry = AppRegistry::load(base)?;
    // `inode/directory` has no parent type, so the lookup needs no MIME
    // database.
    let current = registry
        .default_for(DIRECTORY_MIME, &MimeDb::default())
        .map(|e| e.id.clone());
    Ok(DefaultFm {
        is_default: current.as_deref() == Some(DEFAULT_FM_DESKTOP_ID),
        current,
    })
}

/// Makes Kern the default under `base` with `setter` (`xdg-mime default`),
/// then reads the status again. Refused, with nothing run, when Kern's
/// desktop entry is not installed: the setting would name an application
/// that does not exist.
pub fn make_default_in(
    base: &BaseDirs,
    setter: &dyn Fn(&str, &str) -> Result<(), AppsError>,
) -> Result<DefaultFm, WireError> {
    let registry = AppRegistry::load(base)?;
    if registry.get(DEFAULT_FM_DESKTOP_ID).is_none() {
        return Err(wire_error(
            "UnknownApp",
            format!("{DEFAULT_FM_DESKTOP_ID} is not installed, so it cannot be made the default"),
            None,
        ));
    }
    setter(DEFAULT_FM_DESKTOP_ID, DIRECTORY_MIME)?;
    status_in(base)
}

#[tauri::command]
pub async fn default_fm_status() -> Result<DefaultFm, WireError> {
    blocking(|| status_in(&base()?)).await
}

#[tauri::command]
pub async fn make_default_fm() -> Result<DefaultFm, WireError> {
    blocking(|| make_default_in(&base()?, &set_default)).await
}
