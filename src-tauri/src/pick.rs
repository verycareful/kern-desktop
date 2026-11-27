// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The system's file chooser, for the PDF operations that name files: the files Merge joins, the
//! folder Split writes into, and where Extract and Merge write.
//!
//! The chooser is the `dialog` plugin's builder, called from Kern's own commands and not through
//! the plugin's `open` and `save` commands. Those two add every file and folder they return to the
//! asset protocol's scope for the rest of the run, so the webview could read each one as a picture;
//! the builder itself does not. No window holds a `dialog:*` permission, so the plugin's commands
//! are refused everywhere (tests/acl.rs pins it).
//!
//! The answer is a [`WirePath`], so a name that is not UTF-8 reaches the page unchanged. A chooser
//! that is closed answers `None`. Nothing here creates or writes a file: the chooser may offer to
//! replace a file, and the operation that then writes (kernkraft's merge, extract, split) refuses
//! a file that exists.

use std::path::PathBuf;

use kernkraft_tauri::{WireError, WirePath};
use tauri::{Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::windows::wire_error;

/// The extension the chooser's filter offers.
const PDF_EXTENSIONS: &[&str] = &["pdf", "PDF"];

fn path_of(picked: FilePath) -> Result<PathBuf, WireError> {
    picked.into_path().map_err(|e| {
        wire_error(
            "BadPath",
            format!("the file chooser answered with something that is not a path: {e}"),
            None,
        )
    })
}

fn start_in<R: Runtime>(
    window: &WebviewWindow<R>,
    title: &str,
    folder: &Option<WirePath>,
) -> Result<tauri_plugin_dialog::FileDialogBuilder<R>, WireError> {
    let mut builder = window.dialog().file().set_parent(window).set_title(title);
    if let Some(folder) = folder {
        builder = builder.set_directory(folder.to_path_buf().map_err(WireError::from)?);
    }
    Ok(builder)
}

/// Asks for one or more PDF files. `None` when the chooser is closed.
#[tauri::command]
pub async fn pick_pdfs<R: Runtime>(
    window: WebviewWindow<R>,
    title: String,
    folder: Option<WirePath>,
) -> Result<Option<Vec<WirePath>>, WireError> {
    let builder = start_in(&window, &title, &folder)?.add_filter("PDF", PDF_EXTENSIONS);
    let Some(picked) = builder.blocking_pick_files() else {
        return Ok(None);
    };
    picked
        .into_iter()
        .map(|p| Ok(WirePath::from(path_of(p)?.as_path())))
        .collect::<Result<Vec<_>, WireError>>()
        .map(Some)
}

/// Asks for a folder. `None` when the chooser is closed.
#[tauri::command]
pub async fn pick_folder<R: Runtime>(
    window: WebviewWindow<R>,
    title: String,
    folder: Option<WirePath>,
) -> Result<Option<WirePath>, WireError> {
    let builder = start_in(&window, &title, &folder)?;
    match builder.blocking_pick_folder() {
        Some(p) => Ok(Some(WirePath::from(path_of(p)?.as_path()))),
        None => Ok(None),
    }
}

/// Asks where to write a PDF, starting in `folder` with the name `file_name`. `None` when the
/// chooser is closed.
#[tauri::command]
pub async fn pick_save_pdf<R: Runtime>(
    window: WebviewWindow<R>,
    title: String,
    folder: Option<WirePath>,
    file_name: Option<String>,
) -> Result<Option<WirePath>, WireError> {
    let mut builder = start_in(&window, &title, &folder)?.add_filter("PDF", PDF_EXTENSIONS);
    if let Some(name) = file_name {
        builder = builder.set_file_name(name);
    }
    match builder.blocking_save_file() {
        Some(p) => Ok(Some(WirePath::from(path_of(p)?.as_path()))),
        None => Ok(None),
    }
}
