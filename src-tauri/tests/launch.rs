// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Launches handled by the running instance, and page reloads, through the
//! mock runtime.

mod common;

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::time::Duration;

use common::{env, wait_for, wp};
use kern_lib::instance::{Invocation, Launches};
use kern_lib::windows::{handle_launch, page_reloading, EVENT_OPEN, EVENT_OPEN_ERROR};
use serde_json::json;
use tauri::{Manager, WebviewWindowBuilder};

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

#[test]
fn a_bare_double_dash_is_a_launch_without_arguments() {
    let e = env(Duration::from_secs(5));
    let inv = Invocation {
        argv: vec![OsString::from("--")],
        cwd: e.files.clone(),
        activation_token: String::new(),
    };
    tauri::async_runtime::block_on(handle_launch(&e.handle, inv));
    let q = e.take("main");
    assert_eq!(q.len(), 1);
    assert_eq!(q[0]["payload"], json!({"kind": "home_tab"}));
}

#[test]
fn an_answered_launch_keeps_the_app_through_its_last_window_closing() {
    let e = env(Duration::from_secs(5));
    let launches = e.handle.state::<Launches>().inner().clone();
    // A launch the bus already answered, not yet handled.
    assert!(launches.begin());
    let log = e.run_log.clone();
    let seen = log.clone();
    e.run(move |ctx| {
        // The probe is the only window: destroying it asks the app to exit.
        ctx.handle
            .get_webview_window("probe")
            .unwrap()
            .destroy()
            .unwrap();
        let after_request = || {
            let l = seen.lock().unwrap();
            l.iter()
                .position(|n| *n == "exit_requested")
                .and_then(|i| l.get(i + 1).copied())
        };
        wait_for("the event after the exit request", || {
            after_request().is_some()
        });
        // The loop went on to another turn: the exit was prevented.
        assert_eq!(after_request(), Some("cleared"));
        assert_eq!(launches.finish(), 0);
        // A window for the run to end on once the test is done with it.
        WebviewWindowBuilder::new(&ctx.handle, "last", Default::default())
            .build()
            .unwrap();
    });
    // With nothing pending, closing the last window ends the app.
    let l = log.lock().unwrap();
    assert_eq!(l.iter().filter(|n| **n == "exit_requested").count(), 2);
    assert_eq!(l.last(), Some(&"exit"));
}
