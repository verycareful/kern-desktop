// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if the Tauri runtime cannot start, which leaves nothing to recover.
pub fn run() {
    tauri::Builder::default()
        .plugin(kernkraft_tauri::init())
        .run(tauri::generate_context!())
        .expect("error while running Kern");
}
