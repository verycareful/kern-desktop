// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Which file a path leads to: the device and inode stat(2) reports after
//! following links (POSIX.1-2017, `<sys/stat.h>` `st_dev` and `st_ino`). Two
//! paths with the same identity are one file or folder. The folder tree asks
//! this to tell a symlink that points back to a folder it is already inside.
//!
//! An inode number can exceed 2^53, which a JSON number cannot carry exactly,
//! so both parts travel as decimal strings.

use std::os::unix::fs::MetadataExt;
use std::path::Path;

use kernkraft_tauri::{WireError, WirePath};
use serde::Serialize;

use crate::windows::{blocking, io_error};

/// The answer for one path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Identity {
    /// The device and inode, as decimal strings.
    Known { dev: String, ino: String },
    /// Why the path could not be looked at.
    Failed { error: WireError },
}

/// The identity of what `path` leads to (links followed).
pub fn identity_of(path: &Path) -> Identity {
    match std::fs::metadata(path) {
        Ok(m) => Identity::Known {
            dev: m.dev().to_string(),
            ino: m.ino().to_string(),
        },
        Err(e) => Identity::Failed {
            error: io_error(path, &e),
        },
    }
}

/// The identity of each path, in order. A path that cannot be decoded or
/// looked at is a `Failed` of its own and does not stop the others.
#[tauri::command]
pub async fn file_identity(paths: Vec<WirePath>) -> Result<Vec<Identity>, WireError> {
    blocking(move || {
        Ok(paths
            .iter()
            .map(|wp| match wp.to_path_buf() {
                Ok(p) => identity_of(&p),
                Err(e) => Identity::Failed {
                    error: WireError::from(e),
                },
            })
            .collect())
    })
    .await
}
