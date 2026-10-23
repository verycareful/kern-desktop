// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! A mock-runtime app with the window commands, shared by the window tests.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use kern_lib::windows::WindowState;
use kernkraft_tauri::WirePath;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::utils::acl::ExecutionContext;
use tauri::utils::config::WindowConfig;
use tauri::webview::InvokeRequest;
use tauri::{App, AppHandle, Manager, WebviewWindowBuilder};

/// How long a test waits to be sure something does not happen.
pub const QUIET: Duration = Duration::from_millis(300);

pub const COMMANDS: [&str; 8] = [
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
pub struct Ctx {
    pub files: PathBuf,
    pub handle: AppHandle<MockRuntime>,
}

pub struct Env {
    _tmp: tempfile::TempDir,
    pub app: App<MockRuntime>,
    pub ctx: Ctx,
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
    pub fn run(self, driver: impl FnOnce(Ctx) + Send + 'static) {
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

pub fn env(adopt_timeout: Duration) -> Env {
    env_with(adopt_timeout, None)
}

/// [`env`] plus a plugin of the test's own, e.g. to hold a window's creation.
pub fn env_with(
    adopt_timeout: Duration,
    extra: Option<tauri::plugin::TauriPlugin<MockRuntime>>,
) -> Env {
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
    let mut builder = mock_builder();
    if let Some(p) = extra {
        builder = builder.plugin(p);
    }
    let app = builder
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
    pub fn call_from(&self, label: &str, cmd: &str, args: Value) -> Result<Value, Value> {
        invoke(&self.handle, label, cmd, args)
    }

    pub fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        self.call_from("probe", cmd, args)
    }

    /// Opens `paths` and returns the outcomes.
    pub fn open(&self, paths: &[&Path], origin: &str, gesture: &str) -> Vec<Value> {
        let paths: Vec<Value> = paths.iter().map(|p| wp(p)).collect();
        let out = self
            .call(
                "open_paths",
                json!({"paths": paths, "origin": origin, "gesture": gesture}),
            )
            .unwrap();
        out.as_array().unwrap().clone()
    }

    pub fn take(&self, label: &str) -> Vec<Value> {
        self.call_from(label, "open_pending_take", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }

    pub fn exists(&self, label: &str) -> bool {
        self.handle.get_webview_window(label).is_some()
    }

    pub fn text(&self, name: &str) -> PathBuf {
        let p = self.files.join(name);
        fs::write(&p, "plain text\n").unwrap();
        p
    }
}

pub fn invoke(
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

pub fn wp(p: &Path) -> Value {
    serde_json::to_value(WirePath::from(p)).unwrap()
}

pub fn wait_for(what: &str, f: impl Fn() -> bool) {
    let end = Instant::now() + Duration::from_secs(30);
    while !f() {
        assert!(Instant::now() < end, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}
