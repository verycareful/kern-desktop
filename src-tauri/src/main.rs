// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Hides the console window in release builds on Windows-style targets; a
// no-op on Linux but the Tauri template's convention.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kern_lib::run();
}
