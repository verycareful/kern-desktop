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
            kern_lib::identity::file_identity,
            kern_lib::windows::doc_opened,
            kern_lib::windows::doc_closed,
            kern_lib::windows::doc_open_elsewhere,
            kern_lib::windows::detach_doc,
            kern_lib::windows::detached,
            kern_lib::windows::refuse_detach,
            kern_lib::windows::open_editor,
            kern_lib::windows::move_doc_to_main,
            kern_lib::windows::adopted,
            kern_lib::windows::refuse_adoption,
            kern_lib::clipboard::clip_get,
            kern_lib::clipboard::clip_clear_if,
            kern_lib::dnd::dnd_target,
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

#[test]
fn the_main_window_may_say_where_a_drag_is() {
    // Reached: the command refuses a path with a dot segment before it looks for a drag, and
    // that refusal is the command's own error, not the access control's.
    let e = env("main");
    let err = invoke(
        &e,
        "dnd_target",
        json!({"drag": 1, "target": {"state": "folder", "path": {"k": "Utf8", "v": "/a/../b"}}}),
    )
    .unwrap_err();
    assert_eq!(err["kind"], "BadPath", "{err}");
}

#[test]
fn a_window_the_capability_does_not_name_may_not_say_where_a_drag_is() {
    let e = env("stranger");
    let err = invoke(
        &e,
        "dnd_target",
        json!({"drag": 1, "target": {"state": "refused", "reason": "x"}}),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().contains("not allowed"), "{err}");
}

/// What an editor window's page calls: it opens documents into tabs of its own, asks where a
/// file is open, takes its queue and closes itself after the close question.
const EDITOR_COMMANDS: [&str; 6] = [
    "open_pending_take",
    "doc_opened",
    "doc_closed",
    "doc_open_elsewhere",
    "open_editor",
    "settings_get",
];

/// What only the main window (or a document window) needs: moving a tab or a document between
/// windows, and the clipboard of the file manager. An editor window has none of these.
const NOT_FOR_EDITORS: [&str; 7] = [
    "detach_doc",
    "detached",
    "refuse_detach",
    "move_doc_to_main",
    "adopted",
    "refuse_adoption",
    "clip_get",
];

#[test]
fn an_editor_window_is_granted_what_its_page_calls() {
    let e = env("editor-1");
    for cmd in EDITOR_COMMANDS {
        // Reached or refused by the command itself, never by the access control.
        if let Err(err) = invoke(&e, cmd, json!({"path": {"k": "Utf8", "v": "/a"}})) {
            assert!(
                !err.as_str().is_some_and(|s| s.contains("not allowed")),
                "{cmd}: {err}"
            );
        }
    }
    invoke(&e, &kernkraft("user_dirs"), json!({})).unwrap();
    invoke(
        &e,
        &kernkraft("list_dir"),
        json!({"path": {"k": "Utf8", "v": "/"}, "hidden": false}),
    )
    .unwrap();
}

#[test]
fn an_editor_window_is_refused_what_only_the_main_window_needs() {
    let e = env("editor-1");
    for cmd in NOT_FOR_EDITORS {
        let err = invoke(&e, cmd, json!({})).unwrap_err();
        assert!(
            err.as_str().unwrap().contains("not allowed"),
            "{cmd}: {err}"
        );
    }
}

#[test]
fn the_main_window_and_document_windows_are_granted_the_window_commands() {
    for label in ["main", "doc-1"] {
        let e = env(label);
        for cmd in ["detached", "refuse_detach", "doc_open_elsewhere"] {
            // Reached: the command refuses a window that answers for another, which is its own error.
            if let Err(err) = invoke(
                &e,
                cmd,
                json!({"label": "x", "reason": "r", "path": {"k": "Utf8", "v": "/a"}, "own": {"kind": "window", "label": "x"}}),
            ) {
                assert!(
                    !err.as_str().is_some_and(|s| s.contains("not allowed")),
                    "{label} {cmd}: {err}"
                );
            }
        }
    }
}

#[test]
fn an_editor_window_registers_its_own_tabs_and_not_another_windows() {
    let e = env("editor-1");
    let path = json!({"k": "Utf8", "v": "/no/such/file.txt"});
    invoke(
        &e,
        "doc_opened",
        json!({"path": path, "location": {"kind": "tab", "window": "editor-1", "tab_id": "t"}}),
    )
    .unwrap();
    let err = invoke(
        &e,
        "doc_opened",
        json!({"path": path, "location": {"kind": "tab", "window": "main", "tab_id": "t"}}),
    )
    .unwrap_err();
    assert_eq!(err["kind"], "Denied", "{err}");
}

#[test]
fn the_main_and_editor_windows_may_ask_for_a_files_identity_and_a_stranger_may_not() {
    for label in ["main", "editor-1"] {
        let e = env(label);
        let out = invoke(
            &e,
            "file_identity",
            json!({"paths": [{"k": "Utf8", "v": "/"}]}),
        )
        .unwrap();
        assert_eq!(out[0]["state"], "known", "{label}");
    }
    let e = env("stranger");
    let err = invoke(&e, "file_identity", json!({"paths": []})).unwrap_err();
    assert!(err.as_str().unwrap().contains("not allowed"), "{err}");
}
