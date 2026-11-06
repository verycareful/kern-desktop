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
use std::path::{Path, PathBuf};

use kernkraft_tauri::{WireError, WirePath};
use serde::Serialize;

use crate::windows::{blocking, io_error, wire_error};

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

/// How many links are followed before a chain is called a loop: `MAXSYMLINKS`, the limit Linux
/// puts on the links one path resolution follows (path_resolution(7)).
const MAX_LINK_HOPS: usize = 40;

/// The path the link at `path` leads to: its contents (readlink(2)), a relative one taken from
/// the folder of the link that holds it, and, while that is a link again, the contents of that one,
/// up to [`MAX_LINK_HOPS`] links. The path found is not looked at further, so it may be one that
/// is not there; it is not normalised, so the kernel reads its `..` and folder links as it would
/// for the link itself. An error when `path` is not a link, cannot be read, or the chain loops.
/// Reads only.
pub fn link_target_of(path: &Path) -> Result<PathBuf, WireError> {
    let mut at = path.to_path_buf();
    for _ in 0..MAX_LINK_HOPS {
        let held = std::fs::read_link(&at).map_err(|e| io_error(&at, &e))?;
        let next = if held.is_absolute() {
            held
        } else {
            at.parent().unwrap_or_else(|| Path::new("/")).join(held)
        };
        match std::fs::symlink_metadata(&next) {
            Ok(m) if m.file_type().is_symlink() => at = next,
            // Not there, or not a link: the end of the chain. A look that failed for another
            // reason ends it as well; the write that follows reports that reason.
            _ => return Ok(next),
        }
    }
    Err(wire_error(
        "TooManyLinks",
        format!(
            "{} leads through more than {MAX_LINK_HOPS} links, which is a loop",
            path.display()
        ),
        Some(path),
    ))
}

/// Where the link at `path` leads ([`link_target_of`]); the editor asks it before creating the
/// file a link to nothing points to.
#[tauri::command]
pub async fn link_target(path: WirePath) -> Result<WirePath, WireError> {
    blocking(move || {
        let p = path.to_path_buf().map_err(WireError::from)?;
        Ok(WirePath::from(&link_target_of(&p)?))
    })
    .await
}
