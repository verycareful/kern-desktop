// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Commands through Tauri's access control with the application's own
//! context: the capabilities in `capabilities/main.json` and the permission
//! manifests of the plugin and of Kern's commands, as the real app loads
//! them. A plugin invoked under a name its permissions are not filed under,
//! or a command no capability grants, is refused here.

use std::fs;

use kern_lib::store::Store;
use kern_lib::store_cmds::StoreState;
use kern_lib::windows::WindowState;
use kern_lib::zoom;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

struct Env {
    _tmp: tempfile::TempDir,
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
}

/// An app built from `generate_context!`, with the kernkraft plugin and the
/// store command registered as the real app does, and a `label` window.
fn env(label: &str) -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let (config, state) = (root.join("config"), root.join("state"));
    fs::create_dir_all(&config).unwrap();
    fs::create_dir_all(&state).unwrap();
    let app = mock_builder()
        .plugin(kernkraft_tauri::init())
        .plugin(zoom::plugin())
        .manage(StoreState::new(Store::new(config, state)))
        .manage(WindowState::default())
        .invoke_handler(tauri::generate_handler![
            kern_lib::store_cmds::settings_get,
            kern_lib::store_cmds::settings_set,
            kern_lib::windows::open_pending_take,
            kern_lib::clipboard::clip_clear_if,
        ])
        .build(tauri::generate_context!())
        .unwrap();
    let window = WebviewWindowBuilder::new(&app, label, Default::default())
        .build()
        .unwrap();
    Env {
        _tmp: tmp,
        app,
        window,
    }
}

fn invoke(env: &Env, cmd: &str, args: Value) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: cmd.to_string(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(&env.window, request).map(|body| body.deserialize::<Value>().unwrap())
}

/// The command string the frontend sends for a kernkraft command.
fn kernkraft(cmd: &str) -> String {
    format!("plugin:{}|{cmd}", kernkraft_tauri::PLUGIN_NAME)
}

#[test]
fn a_kernkraft_command_is_allowed_by_the_main_capability() {
    let e = env("main");
    invoke(&e, &kernkraft("user_dirs"), json!({})).unwrap();
}

#[test]
fn a_kern_command_is_allowed_by_the_main_capability() {
    let e = env("main");
    invoke(&e, "settings_get", json!({})).unwrap();
}

#[test]
fn the_interface_size_needs_no_permission_beyond_the_settings_commands() {
    // The zoom is set from the backend when the setting changes, so the
    // window's capability grants settings_set and nothing else for it.
    let e = env("main");
    invoke(
        &e,
        "settings_set",
        json!({"patch": {"interface_size": 125}}),
    )
    .unwrap();
    assert_eq!(zoom::current(e.app.handle()), 125);
    assert_eq!(zoom::applied(e.app.handle())["main"], 1.25);
}

#[test]
fn the_main_window_may_take_what_was_queued_for_it() {
    // The command the main window's frontend calls to receive its queued
    // directives; without the grant they would stay queued forever.
    let e = env("main");
    assert_eq!(
        invoke(&e, "open_pending_take", json!({})).unwrap(),
        json!([])
    );
}

#[test]
fn a_window_the_capability_does_not_name_is_refused() {
    let e = env("stranger");
    for cmd in [
        kernkraft("user_dirs"),
        "settings_get".to_string(),
        "open_pending_take".to_string(),
    ] {
        let err = invoke(&e, &cmd, json!({})).unwrap_err();
        assert!(
            err.as_str().unwrap().contains("not allowed"),
            "{cmd}: {err}"
        );
    }
}

#[test]
fn a_command_no_capability_grants_is_refused() {
    let e = env("main");
    let err = invoke(&e, &kernkraft("no_such_command"), json!({})).unwrap_err();
    assert!(err.as_str().unwrap().contains("not allowed"), "{err}");
}

#[test]
fn the_main_window_may_clear_the_clipboard_if_it_still_holds_a_cut() {
    // Reached: the command refuses a path with a dot segment before it looks at the clipboard,
    // and that refusal is the command's own error, not the access control's.
    let e = env("main");
    let err = invoke(
        &e,
        "clip_clear_if",
        json!({"op": "cut", "paths": [{"k": "Utf8", "v": "/a/../b"}]}),
    )
    .unwrap_err();
    assert_eq!(err["kind"], "BadPath", "{err}");
}

#[test]
fn a_window_the_capability_does_not_name_may_not_clear_the_clipboard() {
    let e = env("stranger");
    let err = invoke(
        &e,
        "clip_clear_if",
        json!({"op": "cut", "paths": [{"k": "Utf8", "v": "/a/b"}]}),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().contains("not allowed"), "{err}");
}
