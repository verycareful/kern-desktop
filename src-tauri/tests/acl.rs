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
        // Focus through Tauri only: the mock runtime has no GTK window.
        .manage(WindowState::new(kern_lib::windows::ADOPT_TIMEOUT))
        .invoke_handler(tauri::generate_handler![
            kern_lib::store_cmds::settings_get,
            kern_lib::store_cmds::settings_set,
            kern_lib::store_cmds::layout_get,
            kern_lib::store_cmds::layout_set,
            kern_lib::windows::open_pending_take,
            kern_lib::identity::file_identity,
            kern_lib::identity::link_target,
            kern_lib::windows::doc_opened,
            kern_lib::windows::doc_closed,
            kern_lib::windows::doc_open_elsewhere,
            kern_lib::windows::detach_doc,
            kern_lib::windows::detached,
            kern_lib::windows::refuse_detach,
            kern_lib::windows::open_editor,
            kern_lib::windows::open_settings,
            kern_lib::restart::restart_request,
            kern_lib::restart::restart_abandon,
            kern_lib::windows::move_doc_to_main,
            kern_lib::windows::adopted,
            kern_lib::windows::refuse_adoption,
            kern_lib::clipboard::clip_get,
            kern_lib::clipboard::clip_set,
            kern_lib::clipboard::clip_text,
            kern_lib::clipboard::clip_clear_if,
            kern_lib::dnd::drag_out,
            kern_lib::filemanager1::fm1_status,
            kern_lib::default_fm::default_fm_status,
            kern_lib::default_fm::make_default_fm,
            kern_lib::dnd::dnd_target,
            kern_lib::dnd::drop_start_op,
            kern_lib::remove::remove_start_op,
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

/// What `capabilities/editor.json` grants to editor windows, read from the file the application is
/// built from: the commands of kernkraft's plugin and Kern's own, by name. (That the page asks for
/// nothing else is checked where the page is run, `src/shell/editor-grants.test.tsx`, against this
/// same file; here every grant is checked against Tauri's access control as the application loads it.)
fn granted_to_editors() -> (Vec<String>, Vec<String>) {
    granted("editor.json", "editor-*")
}

/// What the capability file `name` grants to the windows `windows`: the commands of kernkraft's
/// plugin and Kern's own, by name.
fn granted(name: &str, windows: &str) -> (Vec<String>, Vec<String>) {
    let file = format!("{}/capabilities/{name}", env!("CARGO_MANIFEST_DIR"));
    let json: Value = serde_json::from_str(&fs::read_to_string(file).unwrap()).unwrap();
    assert_eq!(json["windows"], json!([windows]));
    let (mut kernkraft_cmds, mut kern_cmds) = (Vec::new(), Vec::new());
    for permission in json["permissions"].as_array().unwrap() {
        let permission = permission.as_str().unwrap();
        if permission.starts_with("core:") {
            continue;
        }
        let prefix = format!("{}:allow-", kernkraft_tauri::PLUGIN_NAME);
        if let Some(name) = permission.strip_prefix(&prefix) {
            kernkraft_cmds.push(name.replace('-', "_"));
        } else {
            let name = permission
                .strip_prefix("allow-")
                .unwrap_or_else(|| panic!("{permission}: not a grant of one command"));
            kern_cmds.push(name.replace('-', "_"));
        }
    }
    (kernkraft_cmds, kern_cmds)
}

/// Every command of Kern's own that only the main window (or a document window) needs, each
/// refused to an editor window by its capability: moving a document Home, answering for a
/// document window, drags out of the file manager, the default file manager, the stored layout.
const NOT_FOR_EDITORS: [&str; 8] = [
    "detached",
    "refuse_detach",
    "move_doc_to_main",
    "drag_out",
    "fm1_status",
    "default_fm_status",
    "make_default_fm",
    "layout_set",
];

/// The kernkraft commands that the editor window's page does not send: the Trash's own (its
/// listing, restore and purge), undo and redo (they are a folder tab's), volumes changed,
/// applications launched or made defaults, the theme's preferences, the Documents scan. `start_op`
/// is among them: it takes the kind of operation as a string, a capability cannot look at an
/// argument, and so granting it would let the page empty the Trash. The page copies or moves
/// through `drop_start_op`, which takes only those two, and trashes or deletes given items through
/// `remove_start_op`, which takes only those two (see `EDITOR_DROP_GRANTS`).
const KERNKRAFT_NOT_FOR_EDITORS: [&str; 13] = [
    "start_op",
    "trash_purge",
    "trash_restore",
    "trash_list",
    "undo",
    "redo",
    "volume_mount",
    "volume_unmount",
    "volume_eject",
    "launch_app",
    "set_default_app",
    "theme_set_prefs",
    "documents",
];

#[test]
fn an_editor_window_is_granted_every_command_its_capability_names() {
    let e = env("editor-1");
    let (kernkraft_cmds, kern_cmds) = granted_to_editors();
    // The page needs at least the commands of its tabs, its tree and its text.
    for needed in ["list_dir", "text_open", "text_save", "mime_of", "watch_dir"] {
        assert!(kernkraft_cmds.iter().any(|c| c == needed), "{needed}");
    }
    for needed in ["doc_opened", "doc_closed", "detach_doc", "confirm_close"] {
        assert!(kern_cmds.iter().any(|c| c == needed), "{needed}");
    }
    for cmd in &kern_cmds {
        // Reached or refused by the command itself, never by the access control.
        if let Err(err) = invoke(&e, cmd, json!({"path": {"k": "Utf8", "v": "/a"}})) {
            assert!(
                !err.as_str().is_some_and(|s| s.contains("not allowed")),
                "{cmd}: {err}"
            );
        }
    }
    for cmd in &kernkraft_cmds {
        if let Err(err) = invoke(&e, &kernkraft(cmd), json!({})) {
            assert!(
                !err.as_str().is_some_and(|s| s.contains("not allowed")),
                "{cmd}: {err}"
            );
        }
    }
    // What the grants are for is reachable: the listing of a folder answers.
    invoke(&e, &kernkraft("user_dirs"), json!({})).unwrap();
    invoke(
        &e,
        &kernkraft("list_dir"),
        json!({"path": {"k": "Utf8", "v": "/"}, "hidden": false}),
    )
    .unwrap();
    // And what is refused is not among them.
    for cmd in KERNKRAFT_NOT_FOR_EDITORS {
        assert!(!kernkraft_cmds.iter().any(|c| c == cmd), "{cmd}");
    }
    for cmd in NOT_FOR_EDITORS {
        assert!(!kern_cmds.iter().any(|c| c == cmd), "{cmd}");
    }
}

#[test]
fn an_editor_window_has_no_file_operation_of_kernkraft() {
    let e = env("editor-1");
    for cmd in KERNKRAFT_NOT_FOR_EDITORS {
        let err = invoke(&e, &kernkraft(cmd), json!({})).unwrap_err();
        assert!(
            err.as_str().unwrap().contains("not allowed"),
            "{cmd}: {err}"
        );
    }
    // The main window has them: the same calls are not refused there.
    let main = env("main");
    for cmd in [
        "trash_purge",
        "rename",
        "create_dir",
        "volume_unmount",
        "launch_app",
        "set_default_app",
    ] {
        if let Err(err) = invoke(&main, &kernkraft(cmd), json!({})) {
            assert!(
                !err.as_str().is_some_and(|s| s.contains("not allowed")),
                "{cmd}: {err}"
            );
        }
    }
}

/// What an editor window is granted so that a file dropped on its tree is copied or moved with
/// the progress, the conflict question and the report of any other operation, and so that the
/// pointer can be told where the drop would land.
const EDITOR_DROP_GRANTS: [(&str, bool); 7] = [
    ("same_filesystem", true),
    ("drop_start_op", false),
    ("remove_start_op", false),
    ("cancel_op", true),
    ("answer_conflict", true),
    ("undo_state", true),
    ("dnd_target", false),
];

#[test]
fn an_editor_window_is_granted_what_a_drop_on_its_tree_needs() {
    let (kernkraft_cmds, kern_cmds) = granted_to_editors();
    for (cmd, in_kernkraft) in EDITOR_DROP_GRANTS {
        let list = if in_kernkraft {
            &kernkraft_cmds
        } else {
            &kern_cmds
        };
        assert!(list.iter().any(|c| c == cmd), "{cmd}");
    }
    // Reached, not refused by the access control: the command's own answer to an empty call.
    let e = env("editor-1");
    for (cmd, in_kernkraft) in EDITOR_DROP_GRANTS {
        let name = if in_kernkraft {
            kernkraft(cmd)
        } else {
            cmd.to_owned()
        };
        if let Err(err) = invoke(&e, &name, json!({})) {
            assert!(
                !err.as_str().is_some_and(|s| s.contains("not allowed")),
                "{cmd}: {err}"
            );
        }
    }
    // A window the capability does not name still has none of them.
    let stranger = env("stranger");
    for (cmd, in_kernkraft) in EDITOR_DROP_GRANTS {
        let name = if in_kernkraft {
            kernkraft(cmd)
        } else {
            cmd.to_owned()
        };
        let err = invoke(&stranger, &name, json!({})).unwrap_err();
        assert!(
            err.as_str().unwrap().contains("not allowed"),
            "{cmd}: {err}"
        );
    }
}

#[test]
fn an_editor_window_starts_a_copy_or_move_and_no_other_operation() {
    let e = env("editor-1");
    let dest = json!({"k": "Utf8", "v": "/no/such/folder"});
    let source = json!([{"k": "Utf8", "v": "/no/such/file"}]);
    // The general command is refused by the access control, whatever it is asked to do.
    for kind in ["copy", "move", "delete", "empty_trash"] {
        let err = invoke(
            &e,
            &kernkraft("start_op"),
            json!({"kind": kind, "sources": source, "dest": null}),
        )
        .unwrap_err();
        assert!(
            err.as_str().unwrap().contains("not allowed"),
            "{kind}: {err}"
        );
    }
    // The narrow one is reached for a copy or a move: the answer is the operation's own refusal
    // of a destination that is not there, not the access control's and not a bad argument.
    for kind in ["copy", "move"] {
        let err = invoke(
            &e,
            "drop_start_op",
            json!({"kind": kind, "sources": source, "dest": dest}),
        )
        .unwrap_err();
        let text = err.to_string();
        assert!(!text.contains("not allowed"), "{kind}: {text}");
        assert!(!text.contains("invalid args"), "{kind}: {text}");
    }
    // Any other kind is refused before the command runs, by the kind not being one it takes.
    for kind in ["delete", "empty_trash", "trash", "Copy", ""] {
        let err = invoke(
            &e,
            "drop_start_op",
            json!({"kind": kind, "sources": source, "dest": dest}),
        )
        .unwrap_err();
        let text = err.as_str().unwrap();
        assert!(text.contains("invalid args `kind`"), "{kind}: {text}");
    }
    // A window the capability does not name has neither.
    let stranger = env("stranger");
    let err = invoke(
        &stranger,
        "drop_start_op",
        json!({"kind": "copy", "sources": source, "dest": dest}),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().contains("not allowed"), "{err}");
}

#[test]
fn an_editor_window_trashes_or_deletes_given_items_and_empties_nothing() {
    let e = env("editor-1");
    let source = json!([{"k": "Utf8", "v": "/no/such/file"}]);
    // Reached for the two kinds it takes: the operation's own answer, not the access control's and
    // not a bad argument.
    for kind in ["trash", "delete"] {
        let outcome = invoke(
            &e,
            "remove_start_op",
            json!({"kind": kind, "sources": source}),
        );
        if let Err(err) = outcome {
            let text = err.to_string();
            assert!(!text.contains("not allowed"), "{kind}: {text}");
            assert!(!text.contains("invalid args"), "{kind}: {text}");
        }
    }
    // Any other kind is refused before the command runs, by the kind not being one it takes.
    for kind in ["empty_trash", "purge", "copy", "move", "Trash", ""] {
        let err = invoke(
            &e,
            "remove_start_op",
            json!({"kind": kind, "sources": source}),
        )
        .unwrap_err();
        let text = err.as_str().unwrap();
        assert!(text.contains("invalid args `kind`"), "{kind}: {text}");
    }
    // A window the capability does not name has none of it.
    let stranger = env("stranger");
    let err = invoke(
        &stranger,
        "remove_start_op",
        json!({"kind": "trash", "sources": source}),
    )
    .unwrap_err();
    assert!(err.as_str().unwrap().contains("not allowed"), "{err}");
}

#[test]
fn an_editor_window_may_say_where_a_drag_is() {
    // Reached: the command's own refusal of a path with a dot segment, not the access control's.
    let e = env("editor-1");
    let err = invoke(
        &e,
        "dnd_target",
        json!({"drag": 1, "target": {"state": "folder", "path": {"k": "Utf8", "v": "/a/../b"}}}),
    )
    .unwrap_err();
    assert_eq!(err["kind"], "BadPath", "{err}");
    // The document area is a target of its own, with no path.
    invoke(
        &e,
        "dnd_target",
        json!({"drag": 1, "target": {"state": "open"}}),
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

#[test]
fn only_the_main_window_stores_its_layout_and_every_window_that_has_one_may_read_it() {
    let patch = json!({"patch": {"left_width": 300}});
    let main = env("main");
    let stored = invoke(&main, "layout_set", patch.clone()).unwrap();
    assert_eq!(stored["left_width"], 300);
    // An editor window may read it, for the width to start with, and not write it.
    let editor = env("editor-1");
    assert!(invoke(&editor, "layout_get", json!({})).is_ok());
    let err = invoke(&editor, "layout_set", patch.clone()).unwrap_err();
    assert!(err.as_str().unwrap().contains("not allowed"), "{err}");
    // A document window shares the main window's capability, so the write is the command's to refuse.
    let doc = env("doc-1");
    assert_eq!(
        invoke(&doc, "layout_set", patch).unwrap_err()["kind"],
        "Denied"
    );
    let stranger = env("stranger");
    let err = invoke(&stranger, "layout_get", json!({})).unwrap_err();
    assert!(err.as_str().unwrap().contains("not allowed"), "{err}");
}

/// What the Settings window's page has no use for, refused to it by its capability: anything
/// that lists, opens, changes or launches files, and every window and store command beside the
/// settings' own.
const NOT_FOR_SETTINGS: [&str; 10] = [
    "open_paths",
    "doc_opened",
    "open_editor",
    "layout_set",
    "pin",
    "recent_touch",
    "clip_set",
    "drag_out",
    "drop_start_op",
    "open_settings",
];
const KERNKRAFT_NOT_FOR_SETTINGS: [&str; 9] = [
    "list_dir",
    "text_open",
    "text_save",
    "start_op",
    "rename",
    "trash_purge",
    "launch_app",
    "open_terminal",
    "volume_mount",
];

#[test]
fn the_settings_window_is_granted_what_its_capability_names_and_nothing_of_the_files() {
    let e = env("settings");
    let (kernkraft_cmds, kern_cmds) = granted("settings.json", "settings");
    for needed in [
        "settings_get",
        "settings_set",
        "restart_request",
        "confirm_close",
    ] {
        assert!(kern_cmds.iter().any(|c| c == needed), "{needed}");
    }
    for cmd in &kern_cmds {
        if let Err(err) = invoke(&e, cmd, json!({})) {
            assert!(
                !err.as_str().is_some_and(|s| s.contains("not allowed")),
                "{cmd}: {err}"
            );
        }
    }
    for cmd in &kernkraft_cmds {
        if let Err(err) = invoke(&e, &kernkraft(cmd), json!({})) {
            assert!(
                !err.as_str().is_some_and(|s| s.contains("not allowed")),
                "{cmd}: {err}"
            );
        }
    }
    invoke(&e, "settings_get", json!({})).unwrap();
    for cmd in NOT_FOR_SETTINGS {
        let err = invoke(&e, cmd, json!({})).unwrap_err();
        assert!(
            err.as_str().unwrap().contains("not allowed"),
            "{cmd}: {err}"
        );
    }
    for cmd in KERNKRAFT_NOT_FOR_SETTINGS {
        let err = invoke(&e, &kernkraft(cmd), json!({})).unwrap_err();
        assert!(
            err.as_str().unwrap().contains("not allowed"),
            "{cmd}: {err}"
        );
    }
}

#[test]
fn every_kind_of_window_may_open_settings_and_only_the_settings_window_asks_a_restart() {
    for label in ["main", "doc-1", "editor-1"] {
        let e = env(label);
        if let Err(err) = invoke(&e, "open_settings", json!({"section": null})) {
            assert!(
                !err.as_str().is_some_and(|s| s.contains("not allowed")),
                "{label}: {err}"
            );
        }
        let err = invoke(&e, "restart_request", json!({})).unwrap_err();
        assert!(
            err.as_str().unwrap().contains("not allowed"),
            "{label}: {err}"
        );
        // A window kept open when a restart asked it to close calls the restart off.
        invoke(&e, "restart_abandon", json!({})).unwrap();
    }
}
