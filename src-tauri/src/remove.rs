// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Moving given items to the Trash, or deleting them for good, for a page that is not granted
//! kernkraft's `start_op`. That command takes the operation's kind as text, and an access control
//! cannot look at an argument, so granting it would also grant emptying the Trash and purging
//! what is in it. [`remove_start_op`] starts only the two operations on the paths it is given.
//! The question before a delete for good is the page's, as it is for `start_op`.

use kernkraft_tauri::{KernkraftExt, OpId, WireError, WirePath};
use serde::Deserialize;
use tauri::{Runtime, WebviewWindow};

use crate::windows::blocking;

/// What [`remove_start_op`] may start; any other kind fails to deserialize.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoveKind {
    Trash,
    Delete,
}

impl RemoveKind {
    /// The name kernkraft's `start_op` knows the operation by.
    pub fn as_str(self) -> &'static str {
        match self {
            RemoveKind::Trash => "trash",
            RemoveKind::Delete => "delete",
        }
    }
}

/// Starts moving `sources` to the Trash, or deleting them for good, as kernkraft's `start_op`
/// does for the calling window (closing that window cancels it), and returns its id.
#[tauri::command]
pub async fn remove_start_op<R: Runtime>(
    window: WebviewWindow<R>,
    kind: RemoveKind,
    sources: Vec<WirePath>,
) -> Result<OpId, WireError> {
    let kk = window.kernkraft();
    let origin = Some(window.label().to_owned());
    blocking(move || kk.start_op(kind.as_str(), sources, None, origin)).await
}
