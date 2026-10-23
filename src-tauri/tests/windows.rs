// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The window commands through Tauri's mock runtime: routing effects,
//! queued directives, adoption and closing.

mod common;

use std::time::Duration;

use common::{env, invoke, wait_for, wp, QUIET};
use kern_lib::windows::{
    EVENT_ADOPT_CANCELLED, EVENT_ADOPT_DOC, EVENT_CLOSE_REQUESTED, EVENT_OPEN,
};
use serde_json::{json, Value};
use tauri::test::MockRuntime;
use tauri::{Listener, Manager};

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
    e.call(
        "doc_closed",
        json!({"path": wp(&a), "location": {"kind": "tab", "tab_id": "t7"}}),
    )
    .unwrap();
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
        e.call_from("doc-1", "confirm_close", json!({})).unwrap();
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
        e.call_from("doc-1", "confirm_close", json!({})).unwrap();
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

#[test]
fn concurrent_opens_of_one_file_make_one_window() {
    let e = env(Duration::from_secs(5));
    for n in 0..12 {
        let f = e.text(&format!("c{n}.txt"));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let results: Vec<Value> = std::thread::scope(|s| {
            let threads: Vec<_> = (0..2)
                .map(|_| {
                    let (h, b, f) = (e.handle.clone(), barrier.clone(), f.clone());
                    s.spawn(move || {
                        b.wait();
                        invoke(
                            &h,
                            "probe",
                            "open_paths",
                            json!({"paths": [wp(&f)], "origin": "outside", "gesture": "default"}),
                        )
                        .unwrap()[0]
                            .clone()
                    })
                })
                .collect();
            threads.into_iter().map(|t| t.join().unwrap()).collect()
        });
        let windows = results
            .iter()
            .filter(|r| r["action"] == json!("doc_window"))
            .count();
        let focuses = results
            .iter()
            .filter(|r| r["action"] == json!("focus"))
            .count();
        assert_eq!((windows, focuses), (1, 1), "round {n}: {results:?}");
        assert_eq!(results[0]["location"], results[1]["location"]);
    }
}

#[test]
fn old_tab_closing_after_detach_keeps_the_window() {
    let e = env(Duration::from_secs(5));
    let f = e.text("a.txt");
    let tab = json!({"kind": "tab", "tab_id": "t1"});
    e.call("doc_opened", json!({"path": wp(&f), "location": tab}))
        .unwrap();
    let label = e
        .call("detach_doc", json!({"tabId": "t1", "path": wp(&f)}))
        .unwrap();
    // The tab is closed after the window took the document over.
    e.call("doc_closed", json!({"path": wp(&f), "location": tab}))
        .unwrap();
    let out = e.open(&[&f], "outside", "default");
    assert_eq!(out[0]["action"], json!("focus"));
    assert_eq!(
        out[0]["location"],
        json!({"kind": "window", "label": label})
    );
}

#[test]
fn adopt_timeout_gives_the_document_back_to_its_window() {
    let e = env(Duration::from_millis(600));
    let f = e.text("a.txt");
    e.open(&[&f], "outside", "default");
    std::thread::scope(|s| {
        let handle = e.handle.clone();
        let mover = s.spawn(move || {
            invoke(
                &handle,
                "probe",
                "move_doc_to_main",
                json!({"label": "doc-1", "textState": null}),
            )
        });
        wait_for("main to be created", || e.exists("main"));
        // Main registers the tab it made, then never answers.
        e.call_from(
            "main",
            "doc_opened",
            json!({"path": wp(&f), "location": {"kind": "tab", "tab_id": "t1"}}),
        )
        .unwrap();
        assert_eq!(
            mover.join().unwrap().unwrap_err()["kind"],
            json!("AdoptTimeout")
        );
    });
    let out = e.open(&[&f], "outside", "default");
    assert_eq!(
        out[0]["location"],
        json!({"kind": "window", "label": "doc-1"})
    );
}
