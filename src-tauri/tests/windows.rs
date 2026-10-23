// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The window commands through Tauri's mock runtime: routing effects,
//! queued directives, adoption and closing.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use kern_lib::windows::{
    WindowState, EVENT_ADOPT_CANCELLED, EVENT_ADOPT_DOC, EVENT_CLOSE_REQUESTED, EVENT_OPEN,
};
use kernkraft_tauri::WirePath;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::utils::acl::ExecutionContext;
use tauri::utils::config::WindowConfig;
use tauri::webview::InvokeRequest;
use tauri::{App, AppHandle, Listener, Manager, WebviewWindowBuilder};

/// How long a test waits to be sure something does not happen.
const QUIET: Duration = Duration::from_millis(300);

const COMMANDS: [&str; 8] = [
    "open_paths",
    "doc_opened",
    "doc_closed",
    "open_pending_take",
    "detach_doc",
    "move_doc_to_main",
    "adopted",
    "confirm_close",
];

/// What a test drives the app with; it can move to a thread.
#[derive(Clone)]
struct Ctx {
    files: PathBuf,
    handle: AppHandle<MockRuntime>,
}

struct Env {
    _tmp: tempfile::TempDir,
    app: App<MockRuntime>,
    ctx: Ctx,
}

impl std::ops::Deref for Env {
    type Target = Ctx;
    fn deref(&self) -> &Ctx {
        &self.ctx
    }
}

impl Env {
    /// Runs the mock event loop on this thread, which is the only way a
    /// close or destroy takes effect, while `driver` plays the frontend on
    /// another. The loop ends when every window is gone, so the driver's
    /// windows are destroyed after it returns, panic or not.
    fn run(self, driver: impl FnOnce(Ctx) + Send + 'static) {
        let ctx = self.ctx.clone();
        let t = std::thread::spawn(move || {
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| driver(ctx.clone())));
            for w in ctx.handle.webview_windows().values() {
                let _ = w.destroy();
            }
            r
        });
        self.app.run_return(|_, _| {});
        if let Err(p) = t.join().unwrap() {
            std::panic::resume_unwind(p);
        }
    }
}

fn env(adopt_timeout: Duration) -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let files = tmp.path().canonicalize().unwrap().join("files");
    fs::create_dir(&files).unwrap();
    let mut ctx = mock_context(noop_assets());
    ctx.config_mut().app.windows.push(WindowConfig {
        label: "main".to_owned(),
        create: false,
        ..Default::default()
    });
    for cmd in COMMANDS {
        ctx.runtime_authority_mut()
            .__allow_command(cmd.to_owned(), ExecutionContext::Local);
    }
    let app = mock_builder()
        .plugin(kernkraft_tauri::init())
        .manage(WindowState::new(adopt_timeout))
        .on_window_event(kern_lib::windows::on_window_event)
        .invoke_handler(tauri::generate_handler![
            kern_lib::windows::open_paths,
            kern_lib::windows::doc_opened,
            kern_lib::windows::doc_closed,
            kern_lib::windows::open_pending_take,
            kern_lib::windows::detach_doc,
            kern_lib::windows::move_doc_to_main,
            kern_lib::windows::adopted,
            kern_lib::windows::confirm_close,
        ])
        .build(ctx)
        .unwrap();
    // A window to call from that is neither main nor a document.
    WebviewWindowBuilder::new(&app, "probe", Default::default())
        .build()
        .unwrap();
    let handle = app.handle().clone();
    Env {
        _tmp: tmp,
        app,
        ctx: Ctx { files, handle },
    }
}

impl Ctx {
    fn call_from(&self, label: &str, cmd: &str, args: Value) -> Result<Value, Value> {
        invoke(&self.handle, label, cmd, args)
    }

    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        self.call_from("probe", cmd, args)
    }

    /// Opens `paths` and returns the outcomes.
    fn open(&self, paths: &[&Path], origin: &str, gesture: &str) -> Vec<Value> {
        let paths: Vec<Value> = paths.iter().map(|p| wp(p)).collect();
        let out = self
            .call(
                "open_paths",
                json!({"paths": paths, "origin": origin, "gesture": gesture}),
            )
            .unwrap();
        out.as_array().unwrap().clone()
    }

    fn take(&self, label: &str) -> Vec<Value> {
        self.call_from(label, "open_pending_take", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }

    fn exists(&self, label: &str) -> bool {
        self.handle.get_webview_window(label).is_some()
    }

    fn text(&self, name: &str) -> PathBuf {
        let p = self.files.join(name);
        fs::write(&p, "plain text\n").unwrap();
        p
    }
}

fn invoke(
    app: &AppHandle<MockRuntime>,
    label: &str,
    cmd: &str,
    args: Value,
) -> Result<Value, Value> {
    let w = app.get_webview_window(label).unwrap();
    let request = InvokeRequest {
        cmd: cmd.to_owned(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(&w, request).map(|b| b.deserialize::<Value>().unwrap())
}

fn wp(p: &Path) -> Value {
    serde_json::to_value(WirePath::from(p)).unwrap()
}

fn wait_for(what: &str, f: impl Fn() -> bool) {
    let end = Instant::now() + Duration::from_secs(30);
    while !f() {
        assert!(Instant::now() < end, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn outside_text_opens_a_doc_window_once() {
    let e = env(Duration::from_secs(5));
    let f = e.text("a.txt");
    let out = e.open(&[&f], "outside", "default");
    assert_eq!(out[0]["action"], json!("doc_window"));
    assert_eq!(
        out[0]["location"],
        json!({"kind": "window", "label": "doc-1"})
    );
    assert!(e.exists("doc-1"));
    assert!(!e.exists("main"));
    // The directive waited for the window to ask.
    let q = e.take("doc-1");
    assert_eq!(q.len(), 1);
    assert_eq!(q[0]["event"], json!(EVENT_OPEN));
    assert_eq!(q[0]["payload"], json!({"kind": "load_doc", "path": wp(&f)}));
    // Opened again: focus, no second window.
    let again = e.open(&[&f], "outside", "default");
    assert_eq!(again[0]["action"], json!("focus"));
    assert!(!e.exists("doc-2"));
}

#[test]
fn folder_from_outside_creates_main_with_a_folder_tab() {
    let e = env(Duration::from_secs(5));
    let out = e.open(&[&e.files], "outside", "default");
    assert_eq!(out[0]["action"], json!("folder_tab"));
    assert!(e.exists("main"));
    let q = e.take("main");
    assert_eq!(
        q[0]["payload"],
        json!({"kind": "folder_tab", "path": wp(&e.files)})
    );
}

#[test]
fn inside_text_is_a_tab_and_ctrl_click_a_window() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    let b = e.text("b.txt");
    assert_eq!(
        e.open(&[&a], "inside", "default")[0]["action"],
        json!("doc_tab")
    );
    assert_eq!(
        e.open(&[&b], "inside", "new_window")[0]["action"],
        json!("doc_window")
    );
    let q = e.take("main");
    assert_eq!(q[0]["payload"], json!({"kind": "doc_tab", "path": wp(&a)}));
}

#[test]
fn registered_tab_is_focused_not_reopened() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    e.open(&[&e.files], "outside", "default");
    e.take("main");
    e.call(
        "doc_opened",
        json!({"path": wp(&a), "location": {"kind": "tab", "tab_id": "t7"}}),
    )
    .unwrap();
    let out = e.open(&[&a], "outside", "default");
    assert_eq!(out[0]["action"], json!("focus"));
    // `main` is ready now, so the directive was emitted, not queued.
    assert!(e.take("main").is_empty());
    e.call("doc_closed", json!({"path": wp(&a)})).unwrap();
    assert_eq!(
        e.open(&[&a], "outside", "default")[0]["action"],
        json!("doc_window")
    );
}

#[test]
fn missing_path_is_reported_not_dropped() {
    let e = env(Duration::from_secs(5));
    let gone = e.files.join("gone.txt");
    let out = e.open(&[&gone], "outside", "default");
    assert_eq!(out[0]["action"], json!("failed"));
    assert_eq!(out[0]["error"]["kind"], json!("NotFound"));
    let rel = e.call(
        "open_paths",
        json!({"paths": [{"k": "Utf8", "v": "rel.txt"}], "origin": "outside", "gesture": "default"}),
    );
    assert_eq!(rel.unwrap()[0]["error"]["kind"], json!("NotAbsolute"));
}

#[test]
fn doc_window_labels_are_not_reused() {
    env(Duration::from_secs(5)).run(|e| {
        let (a, b, c) = (e.text("a.txt"), e.text("b.txt"), e.text("c.txt"));
        e.open(&[&a], "outside", "default");
        e.call("confirm_close", json!({"label": "doc-1"})).unwrap();
        e.open(&[&b], "outside", "default");
        assert!(e.exists("doc-2"));
        e.call(
            "doc_opened",
            json!({"path": wp(&c), "location": {"kind": "tab", "tab_id": "t1"}}),
        )
        .unwrap();
        let label = e
            .call("detach_doc", json!({"tabId": "t1", "path": wp(&c)}))
            .unwrap();
        assert_eq!(label, json!("doc-3"));
        // The wrong tab id is refused.
        e.call(
            "doc_opened",
            json!({"path": wp(&a), "location": {"kind": "tab", "tab_id": "t2"}}),
        )
        .unwrap();
        let err = e
            .call("detach_doc", json!({"tabId": "t9", "path": wp(&a)}))
            .unwrap_err();
        assert_eq!(err["kind"], json!("TabMismatch"));
    });
}

#[test]
fn close_request_reaches_the_frontend_and_confirm_destroys() {
    let e = env(Duration::from_secs(5));
    let (tx, rx) = std::sync::mpsc::channel();
    e.handle.listen_any(EVENT_CLOSE_REQUESTED, move |_| {
        let _ = tx.send(());
    });
    e.run(move |e| {
        let f = e.text("a.txt");
        e.open(&[&f], "outside", "default");
        e.take("doc-1");
        // The mock runtime does not deliver CloseRequested to window event
        // handlers, so the part after the prevention is driven directly.
        let wv = e.handle.get_webview_window("doc-1").unwrap();
        kern_lib::windows::ask_to_close(
            &AsRef::<tauri::Webview<MockRuntime>>::as_ref(&wv).window(),
        );
        rx.recv_timeout(Duration::from_secs(30)).unwrap();
        e.call("confirm_close", json!({"label": "doc-1"})).unwrap();
    });
}

#[test]
fn move_to_main_closes_the_window_only_after_adopted() {
    env(Duration::from_secs(30)).run(|e| {
        let f = e.text("a.txt");
        e.open(&[&f], "outside", "default");
        std::thread::scope(|s| {
            let handle = e.handle.clone();
            let mover = s.spawn(move || {
                invoke(
                    &handle,
                    "probe",
                    "move_doc_to_main",
                    json!({"label": "doc-1", "textState": {"dirty": "unsaved"}}),
                )
            });
            wait_for("main to be created", || e.exists("main"));
            // The adopt directive is queued for the new main.
            let q = e.take("main");
            assert_eq!(q[0]["payload"], json!({"kind": "home_tab"}));
            assert_eq!(q[1]["event"], json!(EVENT_ADOPT_DOC));
            assert_eq!(
                q[1]["payload"],
                json!({"path": wp(&f), "text_state": {"dirty": "unsaved"}, "from": "doc-1"})
            );
            std::thread::sleep(QUIET);
            assert!(!mover.is_finished(), "returns only after main acknowledges");
            e.call_from(
                "main",
                "doc_opened",
                json!({"path": wp(&f), "location": {"kind": "tab", "tab_id": "t1"}}),
            )
            .unwrap();
            // Only main may acknowledge.
            let denied = e.call("adopted", json!({"label": "doc-1"})).unwrap_err();
            assert_eq!(denied["kind"], json!("Denied"));
            e.call_from("main", "adopted", json!({"label": "doc-1"}))
                .unwrap();
            assert_eq!(mover.join().unwrap().unwrap(), Value::Null);
        });
        // The path now belongs to the tab: opening it focuses, not reopens.
        assert_eq!(
            e.open(&[&f], "outside", "default")[0]["action"],
            json!("focus")
        );
    });
}

#[test]
fn a_destroyed_window_is_forgotten() {
    let e = env(Duration::from_secs(5));
    let f = e.text("a.txt");
    e.open(&[&f], "outside", "default");
    // The mock runtime sends no Destroyed event, so deliver it.
    let wv = e.handle.get_webview_window("doc-1").unwrap();
    let w = AsRef::<tauri::Webview<MockRuntime>>::as_ref(&wv).window();
    kern_lib::windows::on_window_event(&w, &tauri::WindowEvent::Destroyed);
    let again = e.open(&[&f], "outside", "default");
    assert_eq!(again[0]["action"], json!("doc_window"));
    assert_eq!(again[0]["location"]["label"], json!("doc-2"));
}

#[test]
fn move_to_main_without_an_answer_keeps_the_window() {
    let e = env(Duration::from_millis(300));
    let f = e.text("a.txt");
    e.open(&[&f], "outside", "default");
    let err = e
        .call(
            "move_doc_to_main",
            json!({"label": "doc-1", "textState": null}),
        )
        .unwrap_err();
    assert_eq!(err["kind"], json!("AdoptTimeout"));
    assert!(e.exists("doc-1"));
    // Main is told to drop the tab, and a late answer is refused.
    let q = e.take("main");
    assert_eq!(q.last().unwrap()["event"], json!(EVENT_ADOPT_CANCELLED));
    let late = e
        .call_from("main", "adopted", json!({"label": "doc-1"}))
        .unwrap_err();
    assert_eq!(late["kind"], json!("NoAdoption"));
}
