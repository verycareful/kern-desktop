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

#[test]
fn a_driver_failing_while_a_launch_holds_the_app_fails_the_run() {
    const FAILURE: &str = "the driver fails on purpose";
    // The run happens on a thread of its own so that a run that never ends
    // fails this test at the bound instead of holding the binary.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let e = env(Duration::from_secs(5));
        assert!(e.handle.state::<Launches>().begin());
        let seen = e.run_log.clone();
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            e.run(move |ctx| {
                // The last window goes while the launch is pending, so the
                // exit is prevented and nothing is left to close.
                ctx.handle
                    .get_webview_window("probe")
                    .unwrap()
                    .destroy()
                    .unwrap();
                wait_for("the exit request", || {
                    seen.lock().unwrap().contains(&"exit_requested")
                });
                panic!("{FAILURE}");
            })
        }));
        let _ = tx.send(r.map_err(|p| panic_message(p.as_ref())));
    });
    let r = rx
        .recv_timeout(RUN_BOUND)
        .expect("the run ends once its driver fails");
    assert_eq!(r, Err(Some(FAILURE.to_owned())));
}

/// How long a run whose driver failed may take to end. Ending takes one
/// loop turn per window the harness destroys, at most the probe and its own
/// here, and the mock runtime sleeps 1 s per turn (tauri 2.12.4
/// `MockRuntime::run`). The bound is [`wait_for`]'s 30 s, the longest these
/// tests let anything take.
const RUN_BOUND: Duration = Duration::from_secs(30);

fn panic_message(p: &(dyn std::any::Any + Send)) -> Option<String> {
    p.downcast_ref::<String>()
        .cloned()
        .or_else(|| p.downcast_ref::<&str>().map(|s| (*s).to_owned()))
}
