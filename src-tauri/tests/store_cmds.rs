// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The store commands through Tauri's mock runtime: results, events to every
//! window, and the queue of corrupt-file reports.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use kern_lib::store::Store;
use kern_lib::store_cmds::{
    StoreState, EVENT_PINS_CHANGED, EVENT_RECENTS_CHANGED, EVENT_SETTINGS_CHANGED,
    EVENT_STORE_ERROR,
};
use kernkraft_tauri::WirePath;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::utils::acl::ExecutionContext;
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, WebviewWindow, WebviewWindowBuilder};

/// Longest a test waits for an event that must arrive; only a hang guard.
const WAIT: Duration = Duration::from_secs(30);
/// How long a test waits to be sure an event does not arrive.
const QUIET: Duration = Duration::from_millis(300);

const COMMANDS: [&str; 10] = [
    "settings_get",
    "settings_set",
    "pins_get",
    "pin",
    "unpin",
    "pins_reorder",
    "recents_get",
    "recent_touch",
    "prune",
    "store_errors_take",
];

struct Env {
    _tmp: tempfile::TempDir,
    config: PathBuf,
    state: PathBuf,
    files: PathBuf,
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    events: Receiver<(String, Value)>,
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let (config, state, files) = (root.join("config"), root.join("state"), root.join("files"));
    fs::create_dir(&files).unwrap();
    let mut ctx = mock_context(noop_assets());
    for cmd in COMMANDS {
        ctx.runtime_authority_mut()
            .__allow_command(cmd.to_owned(), ExecutionContext::Local);
    }
    let app = mock_builder()
        .manage(StoreState::new(Store::new(config.clone(), state.clone())))
        .invoke_handler(tauri::generate_handler![
            kern_lib::store_cmds::settings_get,
            kern_lib::store_cmds::settings_set,
            kern_lib::store_cmds::pins_get,
            kern_lib::store_cmds::pin,
            kern_lib::store_cmds::unpin,
            kern_lib::store_cmds::pins_reorder,
            kern_lib::store_cmds::recents_get,
            kern_lib::store_cmds::recent_touch,
            kern_lib::store_cmds::prune,
            kern_lib::store_cmds::store_errors_take,
        ])
        .build(ctx)
        .unwrap();
    let (tx, events) = mpsc::channel();
    for name in [
        EVENT_SETTINGS_CHANGED,
        EVENT_PINS_CHANGED,
        EVENT_RECENTS_CHANGED,
        EVENT_STORE_ERROR,
    ] {
        let tx = tx.clone();
        app.listen_any(name, move |e| {
            let _ = tx.send((name.to_owned(), serde_json::from_str(e.payload()).unwrap()));
        });
    }
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    Env {
        _tmp: tmp,
        config,
        state,
        files,
        _app: app,
        window,
        events,
    }
}

impl Env {
    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        let request = InvokeRequest {
            cmd: cmd.to_owned(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        get_ipc_response(&self.window, request).map(|b| b.deserialize::<Value>().unwrap())
    }

    /// The next event, which must be `name`.
    fn expect(&self, name: &str) -> Value {
        let (got, payload) = self.events.recv_timeout(WAIT).expect("no event arrived");
        assert_eq!(got, name);
        payload
    }

    fn expect_quiet(&self) {
        assert!(self.events.recv_timeout(QUIET).is_err(), "unexpected event");
    }
}

fn wp(p: &Path) -> Value {
    serde_json::to_value(WirePath::from(p)).unwrap()
}

#[test]
fn pin_and_unpin_emit_only_on_change() {
    let e = env();
    let p = e.files.join("a");
    let out = e.call("pin", json!({"path": wp(&p)})).unwrap();
    assert_eq!(out["entries"], json!([wp(&p)]));
    assert_eq!(e.expect(EVENT_PINS_CHANGED)["entries"], json!([wp(&p)]));

    e.call("pin", json!({"path": wp(&p)})).unwrap();
    e.expect_quiet();

    e.call("unpin", json!({"path": wp(&p)})).unwrap();
    assert_eq!(e.expect(EVENT_PINS_CHANGED)["entries"], json!([]));
    e.call("pins_reorder", json!({"paths": []})).unwrap();
    e.expect_quiet();
}

#[test]
fn settings_and_recents_emit_their_events() {
    let e = env();
    let out = e
        .call("settings_set", json!({"patch": {"word_wrap": true}}))
        .unwrap();
    assert_eq!(out["word_wrap"], json!(true));
    assert_eq!(e.expect(EVENT_SETTINGS_CHANGED)["word_wrap"], json!(true));
    // A refused patch errors and sends nothing.
    let err = e
        .call("settings_set", json!({"patch": {"nope": 1}}))
        .unwrap_err();
    assert_eq!(err["kind"], json!("InvalidArgument"));
    e.expect_quiet();

    let p = e.files.join("doc.txt");
    e.call("recent_touch", json!({"path": wp(&p)})).unwrap();
    let ev = e.expect(EVENT_RECENTS_CHANGED);
    assert_eq!(ev["entries"][0]["path"], wp(&p));
    let got = e.call("recents_get", json!({})).unwrap();
    assert_eq!(got["entries"].as_array().unwrap().len(), 1);
    e.expect_quiet();
}

#[test]
fn corrupt_file_is_emitted_queued_and_taken_once() {
    let e = env();
    fs::create_dir_all(&e.state).unwrap();
    fs::write(e.state.join("pins.json"), "{ broken").unwrap();
    let got = e.call("pins_get", json!({})).unwrap();
    assert_eq!(got["entries"], json!([]));
    // The report goes out, then the reset value (the file was replaced by
    // defaults, so every window refreshes).
    let report = e.expect(EVENT_STORE_ERROR);
    assert_eq!(report["file"], json!("pins.json"));
    assert!(report["moved_to"].is_object());
    assert_eq!(e.expect(EVENT_PINS_CHANGED)["entries"], json!([]));

    let taken = e.call("store_errors_take", json!({})).unwrap();
    assert_eq!(taken, json!([report]));
    assert_eq!(e.call("store_errors_take", json!({})).unwrap(), json!([]));
}

#[test]
fn unreadable_setting_is_reported_without_a_reset_event() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::write(
        e.config.join("settings.json"),
        r#"{"accent":"from-the-future"}"#,
    )
    .unwrap();
    e.call("settings_get", json!({})).unwrap();
    let report = e.expect(EVENT_STORE_ERROR);
    assert_eq!(report["field"], json!("accent"));
    assert!(report["moved_to"].is_null());
    e.expect_quiet();
    assert_eq!(
        e.call("store_errors_take", json!({})).unwrap(),
        json!([report])
    );
}

#[test]
fn prune_emits_changed_stores_and_returns_the_report() {
    let e = env();
    let gone = e.files.join("gone");
    let kept = e.files.join("kept");
    fs::write(&kept, b"x").unwrap();
    for p in [&gone, &kept] {
        e.call("pin", json!({"path": wp(p)})).unwrap();
        e.expect(EVENT_PINS_CHANGED);
    }
    let report = e.call("prune", json!({})).unwrap();
    assert_eq!(report["pins_removed"], json!([wp(&gone)]));
    assert_eq!(report["pins"]["entries"], json!([wp(&kept)]));
    assert_eq!(e.expect(EVENT_PINS_CHANGED)["entries"], json!([wp(&kept)]));
    // Nothing was removed from recents: no recents event.
    e.expect_quiet();
}

#[test]
fn prune_reports_a_corrupt_file_it_met() {
    let e = env();
    fs::create_dir_all(&e.state).unwrap();
    fs::write(e.state.join("recents.json"), "nonsense").unwrap();
    let report = e.call("prune", json!({})).unwrap();
    assert_eq!(report["corrupt"][0]["file"], json!("recents.json"));
    assert_eq!(e.expect(EVENT_STORE_ERROR)["file"], json!("recents.json"));
    assert_eq!(e.expect(EVENT_PINS_CHANGED)["entries"], json!([]));
    assert_eq!(e.expect(EVENT_RECENTS_CHANGED)["entries"], json!([]));
}
