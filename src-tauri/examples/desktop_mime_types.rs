// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Prints the `MimeType=` line of Kern's desktop entry.
//!
//! Kern opens a folder in the file manager and a file in the editor when
//! kernkraft's MIME database says it is text, so the entry claims
//! `inode/directory` and every type in the database's `mime/types` list that
//! [`MimeDb::is_text`] accepts. The list comes from that same function, so
//! the entry cannot claim a type the editor refuses or miss one it opens.
//!
//! `mime/types` is the one-type-per-line list `update-mime-database` writes
//! beside `globs2`, `subclasses` and `aliases`. Only the system data
//! directory is read (default `/usr/share`, or the first argument), never a
//! user's own, because the output is committed and installed for everyone.
//!
//! Run with `cargo run --example desktop_mime_types [data_dir]`.

use std::path::PathBuf;
use std::process::ExitCode;

use kernkraft_xdg_apps::MimeDb;

const DEFAULT_DATA_DIR: &str = "/usr/share";
const DIRECTORY: &str = "inode/directory";

fn main() -> ExitCode {
    let data_dir = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_DATA_DIR));
    let types_path = data_dir.join("mime").join("types");
    let listed = match std::fs::read_to_string(&types_path) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("cannot read {}: {e}", types_path.display());
            return ExitCode::FAILURE;
        }
    };
    let db = match MimeDb::load(std::slice::from_ref(&data_dir)) {
        Ok(db) => db,
        Err(e) => {
            eprintln!(
                "cannot load the MIME database in {}: {e}",
                data_dir.display()
            );
            return ExitCode::FAILURE;
        }
    };
    let mut text: Vec<&str> = listed
        .lines()
        .map(str::trim)
        .filter(|mime| !mime.is_empty() && db.is_text(mime))
        .collect();
    if text.is_empty() {
        eprintln!("{} lists no text type", types_path.display());
        return ExitCode::FAILURE;
    }
    text.sort_unstable();
    text.dedup();
    let mut line = format!("MimeType={DIRECTORY};");
    for mime in text {
        line.push_str(mime);
        line.push(';');
    }
    println!("{line}");
    ExitCode::SUCCESS
}
