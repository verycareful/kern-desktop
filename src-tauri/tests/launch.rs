// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Launches handled by the running instance, and page reloads, through the
//! mock runtime.

mod common;

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::time::Duration;

use common::{env, wp};
use kern_lib::instance::Invocation;
use kern_lib::windows::{handle_launch, page_reloading, EVENT_OPEN, EVENT_OPEN_ERROR};
use serde_json::json;
use tauri::Manager;

#[test]
fn forwarded_launch_with_unknown_cwd_opens_absolute_and_reports_relative() {
    let e = env(Duration::from_secs(5));
    let f = e.text("a.txt");
    let inv = Invocation {
        argv: vec![f.clone().into_os_string(), OsString::from("rel.txt")],
        cwd: PathBuf::new(),
        activation_token: "token-1".to_owned(),
    };
    tauri::async_runtime::block_on(handle_launch(&e.handle, inv));
    assert!(e.handle.get_webview_window("doc-1").is_some());
    let q = e.take("doc-1");
    assert_eq!(q[0]["payload"], json!({"kind": "load_doc", "path": wp(&f)}));
    // The relative one is reported in main, which was made for it.
    let q = e.take("main");
    assert_eq!(q[0]["event"], json!(EVENT_OPEN_ERROR));
    assert_eq!(q[0]["payload"]["kind"], json!("BadArgument"));
}

#[test]
fn forwarded_non_utf8_path_reaches_the_window_with_its_bytes() {
    let e = env(Duration::from_secs(5));
    let name = OsString::from_vec(b"caf\xe9.txt".to_vec());
    let f = e.files.join(&name);
    std::fs::write(&f, "x").unwrap();
    let inv = Invocation {
        argv: vec![name],
        cwd: e.files.clone(),
        activation_token: String::new(),
    };
    tauri::async_runtime::block_on(handle_launch(&e.handle, inv));
    let q = e.take("doc-1");
    assert_eq!(q[0]["payload"]["path"], wp(&f));
}

#[test]
fn a_reloaded_page_gets_its_directives_queued_again() {
    let e = env(Duration::from_secs(5));
    e.open(&[&e.files], "outside", "default");
    assert_eq!(e.take("main").len(), 1);
    // Ready: the next directive is emitted, not queued.
    e.open(&[&e.files], "outside", "default");
    assert!(e.take("main").is_empty());
    page_reloading(&e.handle, "main");
    e.open(&[&e.files], "outside", "default");
    let q = e.take("main");
    assert_eq!(q.len(), 1);
    assert_eq!(q[0]["event"], json!(EVENT_OPEN));
}
