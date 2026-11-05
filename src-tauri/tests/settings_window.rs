// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The Settings window and the restart it asks for: one window at most, its
//! category handed to it, and a restart that asks every window to close and
//! ends when one stays or Kern is opened again meanwhile.

mod common;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::env;
use kern_lib::instance::Invocation;
use kern_lib::windows::{EVENT_CLOSE_REQUESTED, EVENT_OPEN, EVENT_OPEN_ERROR};
use serde_json::{json, Value};
use tauri::{Listener, Manager};

#[test]
fn the_settings_window_opens_once_and_takes_the_category_it_was_opened_at() {
    let e = env(Duration::from_secs(5));
    e.with_main();
    e.call_from("main", "open_settings", json!({"section": null}))
        .unwrap();
    assert!(e.exists("settings"));
    // Opened again, at About: the same window, told the category once it asks.
    e.call_from("main", "open_settings", json!({"section": "about"}))
        .unwrap();
    let windows = e.handle.webview_windows();
    assert_eq!(
        windows.keys().filter(|l| l.starts_with("settings")).count(),
        1
    );
    let q = e.take("settings");
    assert_eq!(q.len(), 1);
    assert_eq!(q[0]["event"], json!(EVENT_OPEN));
    assert_eq!(
        q[0]["payload"],
        json!({"kind": "settings_section", "section": "about"})
    );
}

#[test]
fn a_window_kern_does_not_make_may_not_open_settings() {
    let e = env(Duration::from_secs(5));
    let err = e
        .call("open_settings", json!({"section": null}))
        .unwrap_err();
    assert_eq!(err["kind"], json!("Denied"));
    assert!(!e.exists("settings"));
}

/// The payloads of the close requests every window is sent, collected.
fn close_requests(e: &common::Env) -> Arc<Mutex<Vec<Value>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    e.handle.listen_any(EVENT_CLOSE_REQUESTED, move |ev| {
        log.lock()
            .unwrap()
            .push(serde_json::from_str(ev.payload()).unwrap());
    });
    seen
}

#[test]
fn only_the_settings_window_restarts_and_every_window_is_asked_to_close() {
    let e = env(Duration::from_secs(5));
    e.with_main();
    let seen = close_requests(&e);
    let denied = e
        .call_from("main", "restart_request", json!({}))
        .unwrap_err();
    assert_eq!(denied["kind"], json!("Denied"));
    assert!(!kern_lib::restart::pending(&e.handle));
    assert!(seen.lock().unwrap().is_empty());

    e.call_from("main", "open_settings", json!({"section": null}))
        .unwrap();
    e.call_from("settings", "restart_request", json!({}))
        .unwrap();
    assert!(kern_lib::restart::pending(&e.handle));
    // probe, main and settings: each asked once, as a restart.
    common::wait_for("the close requests", || seen.lock().unwrap().len() == 3);
    assert!(seen
        .lock()
        .unwrap()
        .iter()
        .all(|p| *p == json!({"restart": true})));
}

#[test]
fn a_window_kept_open_ends_the_restart() {
    let e = env(Duration::from_secs(5));
    e.with_main();
    e.call_from("main", "open_settings", json!({"section": null}))
        .unwrap();
    e.call_from("settings", "restart_request", json!({}))
        .unwrap();
    e.call_from("main", "restart_abandon", json!({})).unwrap();
    assert!(!kern_lib::restart::pending(&e.handle));
    // With nothing pending, an exit starts nothing.
    kern_lib::restart::relaunch_if_pending(&e.handle).unwrap();
}

#[test]
fn kern_opened_again_while_a_restart_waits_ends_it_and_main_says_so() {
    let e = env(Duration::from_secs(5));
    e.with_main();
    let errors = Arc::new(Mutex::new(Vec::<Value>::new()));
    let log = errors.clone();
    e.handle.listen_any(EVENT_OPEN_ERROR, move |ev| {
        log.lock()
            .unwrap()
            .push(serde_json::from_str(ev.payload()).unwrap());
    });
    e.take("main");
    e.call_from("main", "open_settings", json!({"section": null}))
        .unwrap();
    e.call_from("settings", "restart_request", json!({}))
        .unwrap();
    let launch = Invocation {
        argv: vec![],
        cwd: PathBuf::from("/"),
        activation_token: String::new(),
    };
    tauri::async_runtime::block_on(kern_lib::windows::handle_launch(&e.handle, launch));
    assert!(!kern_lib::restart::pending(&e.handle));
    common::wait_for("the error in main", || {
        errors
            .lock()
            .unwrap()
            .iter()
            .any(|err| err["kind"] == json!("Restart"))
    });
}
