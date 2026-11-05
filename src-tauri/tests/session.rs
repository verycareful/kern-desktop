// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The windows kept in `session.json` and opened again at launch, through
//! the mock runtime.

mod common;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use common::{env, wait_for, wp, Ctx, Env};
use kern_lib::instance::Invocation;
use kern_lib::session::launch;
use kern_lib::windows::{handle_launch, EVENT_OPEN, EVENT_OPEN_ERROR};
use kernkraft_tauri::KernkraftExt;
use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::{Listener, Manager};

fn session_file(c: &Ctx) -> PathBuf {
    c.state.join("session.json")
}

fn session(c: &Ctx) -> Value {
    serde_json::from_slice(&fs::read(session_file(c)).unwrap()).unwrap()
}

fn labels(c: &Ctx) -> Vec<String> {
    session(c)["windows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["label"].as_str().unwrap().to_owned())
        .collect()
}

fn write_session(c: &Ctx, windows: Value) {
    fs::create_dir_all(&c.state).unwrap();
    fs::write(session_file(c), json!({ "windows": windows }).to_string()).unwrap();
}

fn closed_file(c: &Ctx) -> PathBuf {
    c.state.join("closed-session.json")
}

fn write_settings(c: &Ctx, settings: Value) {
    let dir = c.state.parent().unwrap().join("config");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("settings.json"), settings.to_string()).unwrap();
}

fn folder(p: &Path) -> Value {
    json!({"kind": "folder", "path": wp(p)})
}

fn doc(p: &Path) -> Value {
    json!({"kind": "doc", "path": wp(p)})
}

fn put(
    c: &Ctx,
    label: &str,
    root: Option<&Path>,
    tabs: Value,
    active: Value,
) -> Result<Value, Value> {
    c.call_from(
        label,
        "session_put",
        json!({"root": root.map(wp), "tabs": tabs, "active": active}),
    )
}

/// The payloads of the open directives queued for `label`.
fn directives(c: &Ctx, label: &str) -> Vec<Value> {
    c.take(label)
        .into_iter()
        .filter(|q| q["event"] == json!(EVENT_OPEN))
        .map(|q| q["payload"].clone())
        .collect()
}

fn editor(c: &Ctx, root: &Path) -> String {
    c.call_from("main", "open_editor", json!({"root": wp(root)}))
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}

/// Closes window `label` as the frontend does, then delivers the Destroyed event the mock runtime
/// does not send.
fn close(c: &Ctx, label: &str) {
    let wv = c.handle.get_webview_window(label).unwrap();
    c.call_from(label, "confirm_close", json!({})).unwrap();
    let w = AsRef::<tauri::Webview<MockRuntime>>::as_ref(&wv).window();
    kern_lib::windows::on_window_event(&w, &tauri::WindowEvent::Destroyed);
}

fn quiet_env() -> Env {
    env(Duration::from_secs(5))
}

#[test]
fn each_kind_of_window_keeps_its_tabs_and_settings_or_a_foreign_window_may_not() {
    let e = quiet_env();
    e.with_main();
    let notes = e.text("notes.txt");
    put(
        &e,
        "main",
        None,
        json!([folder(&e.files), doc(&notes), {"kind": "trash"}, {"kind": "documents"}]),
        json!(1),
    )
    .unwrap();
    let ed = editor(&e, &e.files);
    put(&e, &ed, Some(&e.files), json!([doc(&notes)]), json!(0)).unwrap();
    let w = session(&e);
    assert_eq!(
        w["windows"][0],
        json!({"label": "main", "tabs": [folder(&e.files), doc(&notes), {"kind": "trash"}, {"kind": "documents"}], "active": 1})
    );
    assert_eq!(
        w["windows"][1],
        json!({"label": ed, "root": wp(&e.files), "tabs": [doc(&notes)], "active": 0})
    );

    // A window Kern does not make, Settings, an editor without its folder, the main window
    // with one, and a document window with more than its document are refused.
    let denied = |r: Result<Value, Value>| assert_eq!(r.unwrap_err()["kind"], json!("Denied"));
    denied(put(&e, "probe", None, json!([]), Value::Null));
    e.call_from("main", "open_settings", json!({"section": null}))
        .unwrap();
    denied(put(&e, "settings", None, json!([]), Value::Null));
    denied(put(&e, &ed, None, json!([]), Value::Null));
    denied(put(&e, "main", Some(&e.files), json!([]), Value::Null));
    let other = e.text("other.txt");
    e.open(&[&other], "outside", "default");
    assert!(e.exists("doc-1"));
    denied(put(
        &e,
        "doc-1",
        None,
        json!([folder(&e.files)]),
        Value::Null,
    ));
    denied(put(
        &e,
        "doc-1",
        None,
        json!([doc(&other), doc(&notes)]),
        Value::Null,
    ));
    put(&e, "doc-1", None, json!([doc(&other)]), json!(0)).unwrap();
    assert_eq!(labels(&e), ["main", ed.as_str(), "doc-1"]);
}

#[test]
fn closing_one_of_two_windows_forgets_it_and_the_last_one_is_kept() {
    let e = quiet_env();
    e.with_main();
    e.run(|c| {
        let ed = editor(&c, &c.files);
        put(&c, "main", None, json!([folder(&c.files)]), json!(0)).unwrap();
        put(&c, &ed, Some(&c.files), json!([]), Value::Null).unwrap();
        close(&c, &ed);
        wait_for("the editor to be forgotten", || labels(&c) == ["main"]);
        // The probe window is not one Kern keeps, so main is the last kept window.
        close(&c, "main");
        std::thread::sleep(common::QUIET);
        assert_eq!(labels(&c), ["main"]);
    });
}

#[test]
fn windows_closed_for_a_restart_are_kept_and_forgotten_when_it_does_not_happen() {
    let e = quiet_env();
    e.with_main();
    e.run(|c| {
        let ed = editor(&c, &c.files);
        put(&c, "main", None, json!([folder(&c.files)]), json!(0)).unwrap();
        put(&c, &ed, Some(&c.files), json!([]), Value::Null).unwrap();
        c.call_from("main", "open_settings", json!({"section": null}))
            .unwrap();
        c.call_from("settings", "restart_request", json!({}))
            .unwrap();
        close(&c, &ed);
        std::thread::sleep(common::QUIET);
        assert_eq!(labels(&c), ["main", ed.as_str()]);
        // main stays open: the restart is off, and the editor that closed goes.
        c.call_from("main", "restart_abandon", json!({})).unwrap();
        wait_for("the closed editor to be forgotten", || {
            labels(&c) == ["main"]
        });
    });
}

#[test]
fn a_restart_opens_every_kept_window_again_with_its_tabs() {
    let e = quiet_env();
    let notes = e.text("notes.txt");
    let todo = e.text("todo.txt");
    let gone = e.files.join("gone");
    write_session(
        &e,
        json!([
            {"label": "doc-4", "tabs": [doc(&todo)], "active": 0},
            {"label": "editor-3", "root": wp(&gone), "tabs": [doc(&notes)], "active": 0},
            {"label": "main", "tabs": [folder(&e.files), {"kind": "trash"}], "active": 1}
        ]),
    );
    let first = tauri::async_runtime::block_on(launch(&e.handle, true));
    assert_eq!(first.as_deref(), Some("main"));
    assert_eq!(
        directives(&e, "main"),
        [json!({"kind": "restore", "tabs": [folder(&e.files), {"kind": "trash"}], "active": 1})]
    );
    // A folder that is gone still gets its window, whose tree says so.
    assert_eq!(
        directives(&e, "editor-3"),
        [
            json!({"kind": "editor_root", "path": wp(&gone)}),
            json!({"kind": "restore", "tabs": [doc(&notes)], "active": 0})
        ]
    );
    assert_eq!(
        directives(&e, "doc-4"),
        [json!({"kind": "load_doc", "path": wp(&todo)})]
    );
    // The kept entries stay until the windows report again.
    assert_eq!(labels(&e), ["doc-4", "editor-3", "main"]);
    // A new editor window does not take a restored label.
    let fresh = e.files.join("fresh");
    fs::create_dir(&fresh).unwrap();
    assert_eq!(editor(&e, &fresh), "editor-1");
}

#[test]
fn a_restart_in_the_editor_layout_gives_the_main_window_no_folder_tabs() {
    let e = quiet_env();
    let notes = e.text("notes.txt");
    write_settings(&e, json!({"default_layout": "editor"}));
    write_session(
        &e,
        json!([{"label": "main", "tabs": [folder(&e.files), doc(&notes), folder(&e.files)], "active": 1}]),
    );
    tauri::async_runtime::block_on(launch(&e.handle, true));
    assert_eq!(
        directives(&e, "main"),
        [json!({"kind": "restore", "tabs": [doc(&notes)], "active": 0})]
    );
}

#[test]
fn a_kept_window_that_cannot_be_opened_again_is_said_and_forgotten() {
    let e = quiet_env();
    write_session(
        &e,
        json!([
            {"label": "settings", "tabs": [], "active": null},
            {"label": "editor-1", "tabs": [], "active": null},
            {"label": "probe", "tabs": [], "active": null},
            {"label": "doc-3", "tabs": [], "active": null},
            {"label": "doc-2", "tabs": [doc(&e.files.join("a.txt"))], "active": 0}
        ]),
    );
    let first = tauri::async_runtime::block_on(launch(&e.handle, true));
    assert_eq!(first.as_deref(), Some("doc-2"));
    assert!(!e.exists("editor-1"));
    assert!(!e.exists("settings"));
    let errors: Vec<Value> = e
        .take("main")
        .into_iter()
        .filter(|q| q["event"] == json!(EVENT_OPEN_ERROR))
        .collect();
    assert!(!e.exists("doc-3"));
    assert_eq!(errors.len(), 4);
    assert!(errors.iter().all(|q| q["payload"]["message"]
        .as_str()
        .unwrap()
        .contains("was not opened again")));
    assert_eq!(labels(&e), ["doc-2"]);
}

#[test]
fn a_launch_after_a_restart_brings_it_forward_or_opens_its_path_on_top() {
    let e = quiet_env();
    let notes = e.text("notes.txt");
    write_session(
        &e,
        json!([{"label": "main", "tabs": [doc(&notes)], "active": 0}]),
    );
    let first = tauri::async_runtime::block_on(launch(&e.handle, true));
    let plain = Invocation {
        argv: vec![],
        cwd: e.files.clone(),
        activation_token: String::new(),
    };
    tauri::async_runtime::block_on(handle_launch(&e.handle, plain, first));
    // No Home on top of the restored tabs.
    assert_eq!(
        directives(&e, "main"),
        [json!({"kind": "restore", "tabs": [doc(&notes)], "active": 0})]
    );
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let log = seen.clone();
    e.handle.listen_any(EVENT_OPEN, move |ev| {
        log.lock()
            .unwrap()
            .push(serde_json::from_str(ev.payload()).unwrap());
    });
    // main took its queue above, so the folder of this launch arrives as an event.
    let docs = e.files.join("docs");
    fs::create_dir(&docs).unwrap();
    let again = Invocation {
        argv: vec![docs.clone().into_os_string()],
        cwd: e.files.clone(),
        activation_token: String::new(),
    };
    tauri::async_runtime::block_on(handle_launch(&e.handle, again, Some("main".to_owned())));
    wait_for("the folder tab", || {
        seen.lock()
            .unwrap()
            .contains(&json!({"kind": "folder_tab", "path": wp(&docs)}))
    });
}

#[test]
fn a_launch_that_is_not_a_restart_opens_nothing_and_sets_the_last_run_aside() {
    let e = quiet_env();
    let main = json!([{"label": "main", "tabs": [folder(&e.files)], "active": 0}]);
    write_session(&e, main.clone());
    let first = tauri::async_runtime::block_on(launch(&e.handle, false));
    assert_eq!(first, None);
    assert!(!e.exists("main"));
    assert!(!session_file(&e).exists());
    let closed: Value = serde_json::from_slice(&fs::read(closed_file(&e)).unwrap()).unwrap();
    assert_eq!(closed["windows"], main);
    // A plain launch then opens Home, as without a session.
    let plain = Invocation {
        argv: vec![],
        cwd: e.files.clone(),
        activation_token: String::new(),
    };
    tauri::async_runtime::block_on(handle_launch(&e.handle, plain, first));
    assert_eq!(directives(&e, "main"), [json!({"kind": "home_tab"})]);
    assert_eq!(
        e.call_from("main", "session_closed_get", json!({}))
            .unwrap(),
        json!(1)
    );
}

#[test]
fn a_restart_drops_the_older_closed_set() {
    let e = quiet_env();
    fs::create_dir_all(&e.state).unwrap();
    fs::write(closed_file(&e), r#"{"windows": []}"#).unwrap();
    write_session(&e, json!([{"label": "main", "tabs": [], "active": null}]));
    tauri::async_runtime::block_on(launch(&e.handle, true));
    assert!(!closed_file(&e).exists());
}

/// Sets `windows` aside as the last run's, with `main` open at Home as a plain launch leaves it.
fn last_run(e: &Env, windows: Value) {
    write_session(e, windows);
    tauri::async_runtime::block_on(launch(&e.handle, false));
    e.with_main();
    e.take("main");
}

#[test]
fn only_the_main_window_offers_the_last_run_and_with_none_there_is_nothing_to_restore() {
    let e = quiet_env();
    e.with_main();
    assert_eq!(
        e.call_from("main", "session_closed_get", json!({}))
            .unwrap(),
        json!(0)
    );
    let none = e
        .call_from("main", "session_restore_closed", json!({}))
        .unwrap_err();
    assert_eq!(none["kind"], json!("NothingToRestore"));
    for cmd in [
        "session_closed_get",
        "session_restore_closed",
        "session_closed_dismiss",
    ] {
        assert_eq!(
            e.call(cmd, json!({})).unwrap_err()["kind"],
            json!("Denied"),
            "{cmd}"
        );
    }
}

#[test]
fn restore_opens_the_last_run_beside_this_one_and_drops_the_set() {
    let e = quiet_env();
    let notes = e.text("notes.txt");
    let todo = e.text("todo.txt");
    let proj = e.files.join("proj");
    let other = e.files.join("other");
    fs::create_dir(&proj).unwrap();
    fs::create_dir(&other).unwrap();
    last_run(
        &e,
        json!([
            {"label": "main", "tabs": [folder(&e.files), {"kind": "trash"}], "active": 0},
            {"label": "editor-1", "root": wp(&proj), "tabs": [doc(&notes)], "active": 0},
            {"label": "editor-2", "root": wp(&other), "tabs": [], "active": null},
            {"label": "doc-1", "tabs": [doc(&todo)], "active": 0}
        ]),
    );
    // This run already has an editor on `other`, labelled editor-1.
    assert_eq!(editor(&e, &other), "editor-1");
    e.take("editor-1");
    assert_eq!(
        e.call_from("main", "session_closed_get", json!({}))
            .unwrap(),
        json!(4)
    );
    e.call_from("main", "session_restore_closed", json!({}))
        .unwrap();
    // main took its queue above: its tabs arrive as an event, so they are looked at in the
    // queue of a window that has not taken one yet. The editor on `proj` gets the next free label.
    let proj_label = "editor-2";
    assert_eq!(
        directives(&e, proj_label),
        [
            json!({"kind": "editor_root", "path": wp(&proj)}),
            json!({"kind": "restore", "tabs": [doc(&notes)], "active": 0})
        ]
    );
    assert_eq!(
        directives(&e, "doc-1"),
        [json!({"kind": "load_doc", "path": wp(&todo)})]
    );
    assert!(!e.exists("editor-3"));
    assert!(!closed_file(&e).exists());
    assert_eq!(
        e.call_from("main", "session_closed_get", json!({}))
            .unwrap(),
        json!(0)
    );
}

#[test]
fn an_editor_of_the_last_run_on_a_folder_open_now_gives_its_tabs_to_that_window() {
    let e = quiet_env();
    let notes = e.text("notes.txt");
    let proj = e.files.join("proj");
    fs::create_dir(&proj).unwrap();
    last_run(
        &e,
        json!([{"label": "editor-4", "root": wp(&proj), "tabs": [doc(&notes)], "active": 0}]),
    );
    let open = editor(&e, &proj);
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let log = seen.clone();
    e.handle.listen_any(EVENT_OPEN, move |ev| {
        log.lock()
            .unwrap()
            .push(serde_json::from_str(ev.payload()).unwrap());
    });
    e.take(&open);
    e.call_from("main", "session_restore_closed", json!({}))
        .unwrap();
    wait_for("the tabs", || {
        seen.lock()
            .unwrap()
            .contains(&json!({"kind": "restore", "tabs": [doc(&notes)], "active": 0}))
    });
    assert!(!e.exists("editor-4"));
    assert!(!seen
        .lock()
        .unwrap()
        .iter()
        .any(|d| d["kind"] == "editor_root"));
}

#[test]
fn dismissing_the_last_run_drops_it_unopened() {
    let e = quiet_env();
    last_run(
        &e,
        json!([{"label": "doc-1", "tabs": [doc(&e.text("a.txt"))], "active": 0}]),
    );
    e.call_from("main", "session_closed_dismiss", json!({}))
        .unwrap();
    assert!(!closed_file(&e).exists());
    assert!(!e.exists("doc-1"));
    assert_eq!(
        e.call_from("main", "session_closed_get", json!({}))
            .unwrap(),
        json!(0)
    );
}

#[test]
fn a_last_run_of_only_a_main_window_at_the_folder_a_launch_opens_is_not_offered() {
    let e = quiet_env();
    let start = e.files.join("start");
    fs::create_dir(&start).unwrap();
    write_settings(&e, json!({"new_tab_folder": wp(&start)}));
    last_run(
        &e,
        json!([{"label": "main", "tabs": [folder(&start)], "active": 0}]),
    );
    assert_eq!(
        e.call_from("main", "session_closed_get", json!({}))
            .unwrap(),
        json!(0)
    );
    let none = e
        .call_from("main", "session_restore_closed", json!({}))
        .unwrap_err();
    assert_eq!(none["kind"], json!("NothingToRestore"));
}

#[test]
fn with_no_new_tab_folder_the_folder_a_launch_opens_is_home() {
    let e = quiet_env();
    let home = e.handle.kernkraft().user_dirs().unwrap().home;
    let home = home.to_path_buf().unwrap();
    last_run(
        &e,
        json!([{"label": "main", "tabs": [folder(&home)], "active": 0}]),
    );
    assert_eq!(
        e.call_from("main", "session_closed_get", json!({}))
            .unwrap(),
        json!(0)
    );
}

#[test]
fn a_main_window_with_more_than_the_start_folder_or_another_window_is_offered() {
    let e = quiet_env();
    let start = e.files.join("start");
    let proj = e.files.join("proj");
    fs::create_dir(&start).unwrap();
    fs::create_dir(&proj).unwrap();
    write_settings(&e, json!({"new_tab_folder": wp(&start)}));
    // Home with another tab, or moved to another folder, counts.
    for tabs in [
        json!([folder(&start), {"kind": "trash"}]),
        json!([folder(&proj)]),
    ] {
        write_session(&e, json!([{"label": "main", "tabs": tabs, "active": 0}]));
        tauri::async_runtime::block_on(launch(&e.handle, false));
        e.with_main();
        assert_eq!(
            e.call_from("main", "session_closed_get", json!({}))
                .unwrap(),
            json!(1)
        );
    }
    // A main window at the start folder beside an editor: only the editor is offered and opened.
    write_session(
        &e,
        json!([
            {"label": "main", "tabs": [folder(&start)], "active": 0},
            {"label": "editor-1", "root": wp(&proj), "tabs": [], "active": null}
        ]),
    );
    tauri::async_runtime::block_on(launch(&e.handle, false));
    assert_eq!(
        e.call_from("main", "session_closed_get", json!({}))
            .unwrap(),
        json!(1)
    );
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::<Value>::new()));
    let log = seen.clone();
    e.take("main");
    e.handle.listen_any(EVENT_OPEN, move |ev| {
        log.lock()
            .unwrap()
            .push(serde_json::from_str(ev.payload()).unwrap());
    });
    e.call_from("main", "session_restore_closed", json!({}))
        .unwrap();
    assert!(e.exists("editor-1"));
    // The editor took no queue yet, so its directives wait there; main, which took its queue,
    // would get them as events, and gets none.
    assert_eq!(
        directives(&e, "editor-1"),
        [
            json!({"kind": "editor_root", "path": wp(&proj)}),
            json!({"kind": "restore", "tabs": [], "active": null})
        ]
    );
    std::thread::sleep(common::QUIET);
    assert!(
        seen.lock().unwrap().is_empty(),
        "sent {:?}",
        seen.lock().unwrap()
    );
}
