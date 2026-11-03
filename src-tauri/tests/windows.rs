// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The window commands through Tauri's mock runtime: routing effects,
//! queued directives, adoption and closing.

mod common;

use std::time::Duration;

use common::{env, env_with, invoke, tab, wait_for, wp, Answer, QUIET};
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
    e.call_from(
        "main",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("main", "t7")}),
    )
    .unwrap();
    let out = e.open(&[&a], "outside", "default");
    assert_eq!(out[0]["action"], json!("focus"));
    assert_eq!(out[0]["location"], tab("main", "t7"));
    // `main` is ready now, so the directive was emitted, not queued.
    assert!(e.take("main").is_empty());
    e.call_from(
        "main",
        "doc_closed",
        json!({"path": wp(&a), "location": tab("main", "t7")}),
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
            json!({"path": wp(&c), "location": tab("probe", "t1")}),
        )
        .unwrap();
        let label = e
            .detach("probe", "t1", &c, Value::Null, "doc-3", Answer::Holds)
            .unwrap();
        assert_eq!(label, json!("doc-3"));
        // The wrong tab id is refused.
        let d = e.text("d.txt");
        e.call(
            "doc_opened",
            json!({"path": wp(&d), "location": tab("probe", "t2")}),
        )
        .unwrap();
        let err = e
            .call("detach_doc", json!({"tabId": "t9", "path": wp(&d)}))
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
                json!({"path": wp(&f), "location": tab("main", "t1"), "adoptingFrom": "doc-1"}),
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
    let tab = tab("probe", "t1");
    e.call("doc_opened", json!({"path": wp(&f), "location": tab}))
        .unwrap();
    let label = e
        .detach("probe", "t1", &f, Value::Null, "doc-1", Answer::Holds)
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
fn detach_hands_the_tab_state_to_the_window_untouched() {
    let e = env(Duration::from_secs(5));
    let f = e.text("a.txt");
    let tab = tab("probe", "t1");
    e.call("doc_opened", json!({"path": wp(&f), "location": tab}))
        .unwrap();
    let state = json!({"text": "unsaved", "saved": "as opened", "stamp": "s"});
    let label = e
        .detach("probe", "t1", &f, state.clone(), "doc-1", Answer::Holds)
        .unwrap();
    let label = label.as_str().unwrap();
    let queued = e.call_from(label, "open_pending_take", json!({})).unwrap();
    // The window is asked to answer once it holds the document.
    assert_eq!(
        queued,
        json!([{"event": "kern://open", "payload":
            {"kind": "load_doc", "path": wp(&f), "text_state": state, "ack": true}}])
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
            json!({"path": wp(&f), "location": tab("main", "t1"), "adoptingFrom": "doc-1"}),
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

#[test]
fn a_refused_adoption_ends_at_once_with_the_reason_and_the_window_keeps_it() {
    // Long enough that only the refusal can end the move in time.
    let e = env(Duration::from_secs(30));
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
        let refused = || {
            e.call_from(
                "main",
                "refuse_adoption",
                json!({"label": "doc-1", "reason": "it is already open in a tab"}),
            )
        };
        wait_for("the move to wait for an answer", || refused().is_ok());
        let err = mover.join().unwrap().unwrap_err();
        assert_eq!(err["kind"], json!("AdoptRefused"));
        assert_eq!(err["message"], json!("it is already open in a tab"));
    });
    let out = e.open(&[&f], "outside", "default");
    assert_eq!(
        out[0]["location"],
        json!({"kind": "window", "label": "doc-1"})
    );
    // Only main answers for itself.
    assert_eq!(
        e.call_from(
            "doc-1",
            "refuse_adoption",
            json!({"label": "doc-1", "reason": "x"})
        )
        .unwrap_err()["kind"],
        json!("Denied")
    );
}

#[test]
fn a_window_is_built_outside_the_gate_so_a_second_open_focuses_it() {
    use std::sync::mpsc;
    // A plugin that holds the creation of doc-1 until told to go on.
    let (started_tx, started_rx) = mpsc::channel::<()>();
    let (go_tx, go_rx) = mpsc::channel::<()>();
    let started_tx = std::sync::Mutex::new(started_tx);
    let go_rx = std::sync::Mutex::new(go_rx);
    let hold = tauri::plugin::Builder::<MockRuntime>::new("hold")
        .on_window_ready(move |w| {
            if w.label() == "doc-1" {
                started_tx.lock().unwrap().send(()).unwrap();
                go_rx
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(30))
                    .unwrap();
            }
        })
        .build();
    let e = env_with(Duration::from_secs(5), Some(hold));
    let f = e.text("a.txt");
    let (first, second) = std::thread::scope(|s| {
        let h = e.handle.clone();
        let fp = f.clone();
        let first = s.spawn(move || {
            invoke(
                &h,
                "probe",
                "open_paths",
                json!({"paths": [wp(&fp)], "origin": "outside", "gesture": "default"}),
            )
            .unwrap()
        });
        started_rx.recv_timeout(Duration::from_secs(30)).unwrap();
        // doc-1 is mid-creation. A second open has to finish now: with the
        // gate held through creation it would wait for the first.
        let h = e.handle.clone();
        let second = invoke(
            &h,
            "probe",
            "open_paths",
            json!({"paths": [wp(&f)], "origin": "outside", "gesture": "default"}),
        )
        .unwrap();
        go_tx.send(()).unwrap();
        (first.join().unwrap(), second)
    });
    assert_eq!(second[0]["action"], json!("focus"));
    assert_eq!(
        second[0]["location"],
        json!({"kind": "window", "label": "doc-1"})
    );
    assert_eq!(first[0]["action"], json!("doc_window"));
    assert!(!e.exists("doc-2"));
}

// ---- editor windows and the registry that spans every window ----

/// An editor window rooted at `e.files`, opened from `main`.
fn editor(e: &common::Ctx) -> String {
    e.with_main();
    let label = e
        .call_from("main", "open_editor", json!({"root": wp(&e.files)}))
        .unwrap();
    label.as_str().unwrap().to_owned()
}

#[test]
fn open_as_editor_makes_editor_window() {
    let e = env(Duration::from_secs(5));
    let label = editor(&e);
    assert_eq!(label, "editor-1");
    assert!(e.exists("editor-1"));
    // The window is told its root, once it asks.
    let q = e.take("editor-1");
    assert_eq!(q.len(), 1);
    assert_eq!(q[0]["event"], json!(EVENT_OPEN));
    assert_eq!(
        q[0]["payload"],
        json!({"kind": "editor_root", "path": wp(&e.files)})
    );
    // A second one is another window; the label is not reused.
    let second = e
        .call_from("main", "open_editor", json!({"root": wp(&e.files)}))
        .unwrap();
    assert_eq!(second, json!("editor-2"));
}

#[test]
fn open_as_editor_wants_a_folder_and_a_window_that_may_ask() {
    let e = env(Duration::from_secs(5));
    e.with_main();
    let f = e.text("a.txt");
    let err = e
        .call_from("main", "open_editor", json!({"root": wp(&f)}))
        .unwrap_err();
    assert_eq!(err["kind"], json!("NotAFolder"));
    let gone = e
        .call_from(
            "main",
            "open_editor",
            json!({"root": wp(&e.files.join("gone"))}),
        )
        .unwrap_err();
    assert_eq!(gone["kind"], json!("NotFound"));
    assert!(!e.exists("editor-1"));
    // A window that is neither main nor an editor window may not.
    let denied = e
        .call("open_editor", json!({"root": wp(&e.files)}))
        .unwrap_err();
    assert_eq!(denied["kind"], json!("Denied"));
    // A link to a folder is a folder.
    let link = e.files.join("link");
    std::os::unix::fs::symlink(&e.files, &link).unwrap();
    e.call_from("main", "open_editor", json!({"root": wp(&link)}))
        .unwrap();
    assert!(e.exists("editor-1"));
}

#[test]
fn file_open_twice_focuses_across_windows() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    editor(&e);
    // The editor window holds a tab on the file.
    e.call_from(
        "editor-1",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("editor-1", "t1")}),
    )
    .unwrap();
    // The main window opens it: the editor window is focused, no tab is made in main.
    let out = e
        .call_from(
            "main",
            "open_paths",
            json!({"paths": [wp(&a)], "origin": "inside", "gesture": "default"}),
        )
        .unwrap();
    assert_eq!(out[0]["action"], json!("focus"));
    assert_eq!(out[0]["location"], tab("editor-1", "t1"));
    // The directive went to the window that holds the tab (after the one that gave it its root),
    // and main was told nothing but the folder it was made for.
    let q = e.take("editor-1");
    assert_eq!(q.len(), 2, "{q:?}");
    assert_eq!(
        q[1]["payload"],
        json!({"kind": "focus_tab", "tab_id": "t1"})
    );
    assert_eq!(e.take("main").len(), 1);
    // And so does a launch from outside, and a Ctrl+double-click.
    for (origin, gesture) in [("outside", "default"), ("inside", "new_window")] {
        let again = e.open(&[&a], origin, gesture);
        assert_eq!(again[0]["action"], json!("focus"), "{origin} {gesture}");
        assert_eq!(again[0]["location"], tab("editor-1", "t1"));
    }
    assert!(!e.exists("doc-1"));
}

#[test]
fn a_file_open_in_main_is_focused_from_an_editor_window() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    editor(&e);
    e.call_from(
        "main",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("main", "t5")}),
    )
    .unwrap();
    let out = e
        .call_from(
            "editor-1",
            "open_paths",
            json!({"paths": [wp(&a)], "origin": "inside", "gesture": "default"}),
        )
        .unwrap();
    assert_eq!(out[0]["action"], json!("focus"));
    assert_eq!(out[0]["location"], tab("main", "t5"));
    // After the folder tab main was made for.
    assert_eq!(
        e.take("main")[1]["payload"],
        json!({"kind": "focus_tab", "tab_id": "t5"})
    );
}

#[test]
fn a_text_file_opened_inside_an_editor_window_opens_a_tab_there() {
    let e = env(Duration::from_secs(5));
    let (a, b) = (e.text("a.txt"), e.text("b.txt"));
    editor(&e);
    let out = e
        .call_from(
            "editor-1",
            "open_paths",
            json!({"paths": [wp(&a)], "origin": "inside", "gesture": "default"}),
        )
        .unwrap();
    assert_eq!(out[0]["action"], json!("doc_tab"));
    let q = e.take("editor-1");
    assert_eq!(q[1]["payload"], json!({"kind": "doc_tab", "path": wp(&a)}));
    // From the main window the same click is a tab of main, as D4.3 says.
    e.call_from(
        "main",
        "open_paths",
        json!({"paths": [wp(&b)], "origin": "inside", "gesture": "default"}),
    )
    .unwrap();
    assert_eq!(
        e.take("main")[1]["payload"],
        json!({"kind": "doc_tab", "path": wp(&b)})
    );
    // A launch from outside still gets a window of its own.
    let c = e.text("c.txt");
    assert_eq!(
        e.open(&[&c], "outside", "default")[0]["action"],
        json!("doc_window")
    );
}

#[test]
fn a_closed_editor_window_forgets_its_own_tabs_and_main_keeps_its_own() {
    let e = env(Duration::from_secs(5));
    let (a, b) = (e.text("a.txt"), e.text("b.txt"));
    editor(&e);
    e.call_from(
        "main",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("main", "t1")}),
    )
    .unwrap();
    e.call_from(
        "editor-1",
        "doc_opened",
        json!({"path": wp(&b), "location": tab("editor-1", "t1")}),
    )
    .unwrap();
    // The mock runtime sends no Destroyed event, so deliver it.
    let wv = e.handle.get_webview_window("editor-1").unwrap();
    let w = AsRef::<tauri::Webview<MockRuntime>>::as_ref(&wv).window();
    kern_lib::windows::on_window_event(&w, &tauri::WindowEvent::Destroyed);
    // b is open nowhere now; a is still in main.
    let held = |p: &std::path::Path| {
        e.call_from(
            "main",
            "doc_open_elsewhere",
            json!({"path": wp(p), "own": tab("main", "t9")}),
        )
        .unwrap()
    };
    assert_eq!(held(&b), json!({"state": "free"}));
    assert_eq!(
        held(&a),
        json!({"state": "elsewhere", "location": tab("main", "t1")})
    );
}

#[test]
fn a_window_registers_only_its_own_places() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    editor(&e);
    for (from, location) in [
        ("editor-1", tab("main", "t1")),
        ("main", tab("editor-1", "t1")),
        ("main", json!({"kind": "window", "label": "doc-1"})),
    ] {
        let err = e
            .call_from(
                from,
                "doc_opened",
                json!({"path": wp(&a), "location": location}),
            )
            .unwrap_err();
        assert_eq!(err["kind"], json!("Denied"), "{from} {location}");
        let err = e
            .call_from(
                from,
                "doc_closed",
                json!({"path": wp(&a), "location": location}),
            )
            .unwrap_err();
        assert_eq!(err["kind"], json!("Denied"), "{from} {location}");
        let err = e
            .call_from(
                from,
                "doc_open_elsewhere",
                json!({"path": wp(&a), "own": location}),
            )
            .unwrap_err();
        assert_eq!(err["kind"], json!("Denied"), "{from} {location}");
    }
    // Nothing was registered.
    assert_eq!(
        e.open(&[&a], "outside", "default")[0]["action"],
        json!("doc_window")
    );
}

#[test]
fn the_same_file_under_another_name_is_focused_not_opened_again() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    let hard = e.files.join("hard.txt");
    let soft = e.files.join("soft.txt");
    std::fs::hard_link(&a, &hard).unwrap();
    std::os::unix::fs::symlink(&a, &soft).unwrap();
    editor(&e);
    e.call_from(
        "editor-1",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("editor-1", "t1")}),
    )
    .unwrap();
    for other in [&hard, &soft] {
        let out = e.open(&[other], "outside", "default");
        assert_eq!(out[0]["action"], json!("focus"), "{other:?}");
        assert_eq!(out[0]["location"], tab("editor-1", "t1"));
    }
    assert!(!e.exists("doc-1"));
}

#[test]
fn save_as_into_a_document_open_elsewhere_is_refused_across_windows() {
    let e = env(Duration::from_secs(5));
    let (a, b, free) = (e.text("a.txt"), e.text("b.txt"), e.files.join("new.txt"));
    let hard = e.files.join("hard.txt");
    let soft = e.files.join("soft.txt");
    std::fs::hard_link(&b, &hard).unwrap();
    std::os::unix::fs::symlink(&b, &soft).unwrap();
    editor(&e);
    // The main window has a.txt in tab t1; the editor window has b.txt in tab t2.
    e.call_from(
        "main",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("main", "t1")}),
    )
    .unwrap();
    e.call_from(
        "editor-1",
        "doc_opened",
        json!({"path": wp(&b), "location": tab("editor-1", "t2")}),
    )
    .unwrap();
    let ask = |from: &str, own: Value, path: &std::path::Path| {
        e.call_from(
            from,
            "doc_open_elsewhere",
            json!({"path": wp(path), "own": own}),
        )
        .unwrap()
    };
    let there = json!({"state": "elsewhere", "location": tab("editor-1", "t2")});
    // From main's tab: b.txt, by its own name and by a hard and a symbolic link, is open in the editor window.
    for target in [&b, &hard, &soft] {
        assert_eq!(ask("main", tab("main", "t1"), target), there, "{target:?}");
    }
    // Its own file is its own, under any name; an unused name is free.
    assert_eq!(ask("main", tab("main", "t1"), &a), json!({"state": "own"}));
    assert_eq!(
        ask("main", tab("main", "t1"), &free),
        json!({"state": "free"})
    );
    // The other way round: the editor window's tab asks about a.txt.
    assert_eq!(
        ask("editor-1", tab("editor-1", "t2"), &a),
        json!({"state": "elsewhere", "location": tab("main", "t1")})
    );
    assert_eq!(
        ask("editor-1", tab("editor-1", "t2"), &hard),
        json!({"state": "own"})
    );
    // A document window is asked the same way.
    e.open(&[&e.text("w.txt")], "outside", "default");
    assert_eq!(
        ask("doc-1", json!({"kind": "window", "label": "doc-1"}), &b),
        there
    );
}

// ---- a tab's move to a new window is acknowledged ----

#[test]
fn the_tab_is_given_up_only_when_the_new_window_answers() {
    env(Duration::from_secs(30)).run(|e| {
        let f = e.text("a.txt");
        e.call(
            "doc_opened",
            json!({"path": wp(&f), "location": tab("probe", "t1")}),
        )
        .unwrap();
        std::thread::scope(|s| {
            let handle = e.handle.clone();
            let args = json!({"tabId": "t1", "path": wp(&f), "textState": null});
            let call = s.spawn(move || invoke(&handle, "probe", "detach_doc", args));
            wait_for("the new window", || e.exists("doc-1"));
            std::thread::sleep(QUIET);
            assert!(!call.is_finished(), "returns only after the window answers");
            // Only the window itself answers for itself.
            let denied = e.call("detached", json!({"label": "doc-1"})).unwrap_err();
            assert_eq!(denied["kind"], json!("Denied"));
            assert!(!call.is_finished());
            e.call_from("doc-1", "detached", json!({"label": "doc-1"}))
                .unwrap();
            assert_eq!(call.join().unwrap().unwrap(), json!("doc-1"));
        });
        // The window owns the file; the tab's own release leaves that alone.
        e.call(
            "doc_closed",
            json!({"path": wp(&f), "location": tab("probe", "t1")}),
        )
        .unwrap();
        let out = e.open(&[&f], "outside", "default");
        assert_eq!(
            out[0]["location"],
            json!({"kind": "window", "label": "doc-1"})
        );
    });
}

#[test]
fn a_refused_move_keeps_the_tab_and_closes_the_half_made_window() {
    env(Duration::from_secs(30)).run(|e| {
        let f = e.text("a.txt");
        e.call(
            "doc_opened",
            json!({"path": wp(&f), "location": tab("probe", "t1")}),
        )
        .unwrap();
        let err = e
            .detach(
                "probe",
                "t1",
                &f,
                json!({"text": "unsaved"}),
                "doc-1",
                Answer::Refuses("the text did not arrive"),
            )
            .unwrap_err();
        assert_eq!(err["kind"], json!("DetachRefused"));
        assert_eq!(err["message"], json!("the text did not arrive"));
        // The tab still owns the file. (The mock runtime keeps a destroyed window in its
        // list, so the closing of the half-made window is not observable here.)
        let held = e
            .call(
                "doc_open_elsewhere",
                json!({"path": wp(&f), "own": tab("probe", "t9")}),
            )
            .unwrap();
        assert_eq!(
            held,
            json!({"state": "elsewhere", "location": tab("probe", "t1")})
        );
        // The label is not reused by the next window.
        let g = e.text("b.txt");
        e.open(&[&g], "outside", "default");
        assert!(e.exists("doc-2"));
    });
}

#[test]
fn a_move_nobody_answers_times_out_and_keeps_the_tab() {
    env(Duration::from_millis(400)).run(|e| {
        let f = e.text("a.txt");
        e.call(
            "doc_opened",
            json!({"path": wp(&f), "location": tab("probe", "t1")}),
        )
        .unwrap();
        let err = e
            .detach("probe", "t1", &f, Value::Null, "doc-1", Answer::Silent)
            .unwrap_err();
        assert_eq!(err["kind"], json!("DetachTimeout"));
        // A late answer finds no move waiting.
        let late = e.call("detached", json!({"label": "probe"})).unwrap_err();
        assert_eq!(late["kind"], json!("NoDetach"));
        let held = e
            .call(
                "doc_open_elsewhere",
                json!({"path": wp(&f), "own": tab("probe", "t9")}),
            )
            .unwrap();
        assert_eq!(
            held,
            json!({"state": "elsewhere", "location": tab("probe", "t1")})
        );
    });
}

#[test]
fn a_new_window_closed_before_it_answers_ends_the_move() {
    env(Duration::from_secs(30)).run(|e| {
        let f = e.text("a.txt");
        e.call(
            "doc_opened",
            json!({"path": wp(&f), "location": tab("probe", "t1")}),
        )
        .unwrap();
        let err = std::thread::scope(|s| {
            let handle = e.handle.clone();
            let args = json!({"tabId": "t1", "path": wp(&f), "textState": null});
            let call = s.spawn(move || invoke(&handle, "probe", "detach_doc", args));
            wait_for("the new window", || e.exists("doc-1"));
            let wv = e.handle.get_webview_window("doc-1").unwrap();
            let w = AsRef::<tauri::Webview<MockRuntime>>::as_ref(&wv).window();
            kern_lib::windows::on_window_event(&w, &tauri::WindowEvent::Destroyed);
            call.join().unwrap().unwrap_err()
        });
        assert_eq!(err["kind"], json!("DetachRefused"));
        let held = e
            .call(
                "doc_open_elsewhere",
                json!({"path": wp(&f), "own": tab("probe", "t9")}),
            )
            .unwrap();
        assert_eq!(
            held,
            json!({"state": "elsewhere", "location": tab("probe", "t1")})
        );
    });
}

#[test]
fn a_tab_of_another_window_is_not_detached_by_this_one() {
    let e = env(Duration::from_secs(5));
    let f = e.text("a.txt");
    editor(&e);
    e.call_from(
        "editor-1",
        "doc_opened",
        json!({"path": wp(&f), "location": tab("editor-1", "t1")}),
    )
    .unwrap();
    let err = e
        .call_from("main", "detach_doc", json!({"tabId": "t1", "path": wp(&f)}))
        .unwrap_err();
    assert_eq!(err["kind"], json!("TabMismatch"));
    assert!(!e.exists("doc-1"));
}

// ---- a late registration after a taken-back move ----

#[test]
fn a_late_registration_after_a_taken_back_move_is_refused() {
    let e = env(Duration::from_millis(300));
    let f = e.text("a.txt");
    e.open(&[&f], "outside", "default");
    // The move times out before main registers its tab.
    let err = e
        .call(
            "move_doc_to_main",
            json!({"label": "doc-1", "textState": null}),
        )
        .unwrap_err();
    assert_eq!(err["kind"], json!("AdoptTimeout"));
    // Main's registration of the tab it made arrives now: refused.
    let late = e
        .call_from(
            "main",
            "doc_opened",
            json!({"path": wp(&f), "location": tab("main", "t1"), "adoptingFrom": "doc-1"}),
        )
        .unwrap_err();
    assert_eq!(late["kind"], json!("AdoptionOver"));
    // The window's registration stands; main dropping its tab leaves it.
    e.call_from(
        "main",
        "doc_closed",
        json!({"path": wp(&f), "location": tab("main", "t1")}),
    )
    .unwrap();
    let out = e.open(&[&f], "outside", "default");
    assert_eq!(out[0]["action"], json!("focus"));
    assert_eq!(
        out[0]["location"],
        json!({"kind": "window", "label": "doc-1"})
    );
}

#[test]
fn a_registration_for_a_move_that_is_waiting_is_accepted() {
    let e = env(Duration::from_secs(30));
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
        let register = || {
            e.call_from(
                "main",
                "doc_opened",
                json!({"path": wp(&f), "location": tab("main", "t1"), "adoptingFrom": "doc-1"}),
            )
        };
        wait_for("the move to wait", || register().is_ok());
        // A move that names no waiting window is over.
        let other = e
            .call_from(
                "main",
                "doc_opened",
                json!({"path": wp(&f), "location": tab("main", "t2"), "adoptingFrom": "doc-9"}),
            )
            .unwrap_err();
        assert_eq!(other["kind"], json!("AdoptionOver"));
        e.call_from("main", "adopted", json!({"label": "doc-1"}))
            .unwrap();
        mover.join().unwrap().unwrap();
    });
}

// ---- a path is held for the tab it was routed to ----

fn inside(e: &common::Ctx, from: &str, f: &std::path::Path) -> Value {
    e.call_from(
        from,
        "open_paths",
        json!({"paths": [wp(f)], "origin": "inside", "gesture": "default"}),
    )
    .unwrap()[0]
        .clone()
}

fn opening(window: &str) -> Value {
    json!({"kind": "opening", "window": window})
}

#[test]
fn a_text_file_is_held_for_its_window_until_the_tab_registers_so_a_second_open_is_focused() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    let hard = e.files.join("hard.txt");
    std::fs::hard_link(&a, &hard).unwrap();
    editor(&e);
    // main and editor-1 open the same file one after the other, before either tab registered.
    let first = inside(&e, "main", &a);
    assert_eq!(first["action"], json!("doc_tab"));
    for name in [&a, &hard] {
        let second = inside(&e, "editor-1", name);
        assert_eq!(second["action"], json!("focus"), "{name:?}");
        assert_eq!(second["location"], opening("main"));
    }
    // Only one tab was asked for.
    let asked = |label: &str| {
        e.take(label)
            .iter()
            .filter(|q| q["payload"]["kind"] == json!("doc_tab"))
            .count()
    };
    assert_eq!((asked("main"), asked("editor-1")), (1, 0));
    // The tab registers: the hold becomes its place.
    e.call_from(
        "main",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("main", "t1")}),
    )
    .unwrap();
    assert_eq!(inside(&e, "editor-1", &hard)["location"], tab("main", "t1"));
}

#[test]
fn two_windows_opening_one_file_at_once_make_one_tab() {
    let e = env(Duration::from_secs(5));
    editor(&e);
    for n in 0..12 {
        let f = e.text(&format!("race{n}.txt"));
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let results: Vec<Value> = std::thread::scope(|s| {
            ["main", "editor-1"]
                .map(|from| {
                    let (h, b, f) = (e.handle.clone(), barrier.clone(), f.clone());
                    s.spawn(move || {
                        b.wait();
                        invoke(
                            &h,
                            from,
                            "open_paths",
                            json!({"paths": [wp(&f)], "origin": "inside", "gesture": "default"}),
                        )
                        .unwrap()[0]
                            .clone()
                    })
                })
                .into_iter()
                .map(|t| t.join().unwrap())
                .collect()
        });
        let tabs = results
            .iter()
            .filter(|r| r["action"] == json!("doc_tab"))
            .count();
        let focuses = results
            .iter()
            .filter(|r| r["action"] == json!("focus"))
            .count();
        assert_eq!((tabs, focuses), (1, 1), "round {n}: {results:?}");
    }
}

#[test]
fn a_registration_for_a_file_open_at_another_place_is_refused_and_unseats_nothing() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    editor(&e);
    e.call_from(
        "editor-1",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("editor-1", "t1")}),
    )
    .unwrap();
    let err = e
        .call_from(
            "main",
            "doc_opened",
            json!({"path": wp(&a), "location": tab("main", "t9")}),
        )
        .unwrap_err();
    assert_eq!(err["kind"], json!("AlreadyOpen"));
    assert_eq!(
        err["message"],
        json!("this file is already open in a tab of an editor window")
    );
    // The editor window's tab is still the place.
    assert_eq!(inside(&e, "main", &a)["location"], tab("editor-1", "t1"));
    // The same place registering again (after a save, say) is not a conflict.
    e.call_from(
        "editor-1",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("editor-1", "t1")}),
    )
    .unwrap();
}

#[test]
fn a_tab_that_never_registers_lets_go_of_the_path_it_was_held_for() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    e.with_main();
    assert_eq!(inside(&e, "main", &a)["action"], json!("doc_tab"));
    assert_eq!(inside(&e, "main", &a)["action"], json!("focus"));
    // The file could not be opened, and its tab went: it releases what was held for it.
    e.call_from(
        "main",
        "doc_closed",
        json!({"path": wp(&a), "location": tab("main", "t1")}),
    )
    .unwrap();
    assert_eq!(inside(&e, "main", &a)["action"], json!("doc_tab"));
}

#[test]
fn a_hold_goes_with_its_window() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    editor(&e);
    assert_eq!(inside(&e, "editor-1", &a)["action"], json!("doc_tab"));
    let wv = e.handle.get_webview_window("editor-1").unwrap();
    let w = AsRef::<tauri::Webview<MockRuntime>>::as_ref(&wv).window();
    kern_lib::windows::on_window_event(&w, &tauri::WindowEvent::Destroyed);
    assert_eq!(inside(&e, "main", &a)["action"], json!("doc_tab"));
}

#[test]
fn save_as_holds_its_target_so_an_open_in_between_is_focused_and_a_failed_save_lets_go() {
    let e = env(Duration::from_secs(5));
    let (a, target) = (e.text("a.txt"), e.files.join("target.txt"));
    e.with_main();
    let own = tab("main", "t1");
    e.call_from(
        "main",
        "doc_opened",
        json!({"path": wp(&a), "location": own}),
    )
    .unwrap();
    let ask = |from: &str, own: &Value, reserve: bool| {
        e.call_from(
            from,
            "doc_open_elsewhere",
            json!({"path": wp(&target), "own": own, "reserve": reserve}),
        )
        .unwrap()
    };
    assert_eq!(ask("main", &own, true), json!({"state": "free"}));
    // Held for the tab: a window opening the file meanwhile is sent to it, and another Save As is refused.
    std::fs::write(&target, "x").unwrap();
    assert_eq!(inside(&e, "main", &target)["action"], json!("focus"));
    editor(&e);
    let other = tab("editor-1", "t5");
    assert_eq!(
        ask("editor-1", &other, true),
        json!({"state": "elsewhere", "location": own})
    );
    // The save did not happen: the tab lets go, and the file is free again.
    e.call_from(
        "main",
        "doc_closed",
        json!({"path": wp(&target), "location": own}),
    )
    .unwrap();
    assert_eq!(ask("editor-1", &other, false), json!({"state": "free"}));
    // A check that does not reserve holds nothing.
    assert_eq!(inside(&e, "main", &target)["action"], json!("doc_tab"));
}

#[test]
fn save_as_through_a_dangling_link_finds_a_document_deleted_on_disk() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    e.with_main();
    e.call_from(
        "main",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("main", "t1")}),
    )
    .unwrap();
    // The file is deleted under its open document, and a link to where it was dangles.
    std::fs::remove_file(&a).unwrap();
    let link = e.files.join("link.txt");
    std::os::unix::fs::symlink(&a, &link).unwrap();
    editor(&e);
    let held = e
        .call_from(
            "editor-1",
            "doc_open_elsewhere",
            json!({"path": wp(&link), "own": tab("editor-1", "t2")}),
        )
        .unwrap();
    assert_eq!(
        held,
        json!({"state": "elsewhere", "location": tab("main", "t1")})
    );
}

#[test]
fn a_file_replaced_by_a_save_is_still_found_by_a_hard_link_made_after() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    editor(&e);
    e.call_from(
        "editor-1",
        "doc_opened",
        json!({"path": wp(&a), "location": tab("editor-1", "t1")}),
    )
    .unwrap();
    // A save replaces the file by rename: a new inode.
    let tmp = e.files.join(".a.txt.tmp");
    std::fs::write(&tmp, "saved").unwrap();
    std::fs::rename(&tmp, &a).unwrap();
    let link = e.files.join("after.txt");
    std::fs::hard_link(&a, &link).unwrap();
    let out = e.open(&[&link], "outside", "default");
    assert_eq!(out[0]["action"], json!("focus"));
    assert_eq!(out[0]["location"], tab("editor-1", "t1"));
}

// ---- who may call what ----

#[test]
fn only_main_registers_a_move_homes_tab_and_only_the_holder_detaches() {
    let e = env(Duration::from_secs(5));
    let (a, b) = (e.text("a.txt"), e.text("b.txt"));
    editor(&e);
    let denied = e
        .call_from(
            "editor-1",
            "doc_opened",
            json!({"path": wp(&a), "location": tab("editor-1", "t1"), "adoptingFrom": "doc-1"}),
        )
        .unwrap_err();
    assert_eq!(denied["kind"], json!("Denied"));
    // A path no tab registered cannot be detached by whoever asks.
    for from in ["main", "editor-1"] {
        let err = e
            .call_from(from, "detach_doc", json!({"tabId": "t1", "path": wp(&b)}))
            .unwrap_err();
        assert_eq!(err["kind"], json!("NotRegistered"), "{from}");
    }
    assert!(!e.exists("doc-1"));
}

#[test]
fn a_document_window_may_not_open_an_editor_window_and_each_window_answers_only_for_itself() {
    let e = env(Duration::from_secs(5));
    let a = e.text("a.txt");
    e.open(&[&a], "outside", "default");
    assert!(e.exists("doc-1"));
    let denied = e
        .call_from("doc-1", "open_editor", json!({"root": wp(&e.files)}))
        .unwrap_err();
    assert_eq!(denied["kind"], json!("Denied"));
    for (cmd, args) in [
        ("detached", json!({"label": "doc-9"})),
        ("refuse_detach", json!({"label": "doc-9", "reason": "x"})),
    ] {
        let err = e.call_from("doc-1", cmd, args).unwrap_err();
        assert_eq!(err["kind"], json!("Denied"), "{cmd}");
    }
}

// ---- Move to new window from an editor window ----

#[test]
fn a_tab_of_an_editor_window_moves_to_a_new_window_once_that_window_answers() {
    env(Duration::from_secs(30)).run(|e| {
        let f = e.text("a.txt");
        let label = editor(&e);
        e.call_from(
            &label,
            "doc_opened",
            json!({"path": wp(&f), "location": tab(&label, "t1")}),
        )
        .unwrap();
        std::thread::scope(|s| {
            let handle = e.handle.clone();
            let args = json!({"tabId": "t1", "path": wp(&f), "textState": {"text": "unsaved"}});
            let from = label.clone();
            let call = s.spawn(move || invoke(&handle, &from, "detach_doc", args));
            wait_for("the new window", || e.exists("doc-1"));
            std::thread::sleep(QUIET);
            assert!(!call.is_finished(), "returns only after the window answers");
            e.call_from("doc-1", "detached", json!({"label": "doc-1"}))
                .unwrap();
            assert_eq!(call.join().unwrap().unwrap(), json!("doc-1"));
        });
        // The window owns the file; the editor tab releasing its registration leaves that alone.
        e.call_from(
            &label,
            "doc_closed",
            json!({"path": wp(&f), "location": tab(&label, "t1")}),
        )
        .unwrap();
        let out = e.open(&[&f], "outside", "default");
        assert_eq!(
            out[0]["location"],
            json!({"kind": "window", "label": "doc-1"})
        );
    });
}

#[test]
fn a_move_from_an_editor_window_that_is_refused_or_unanswered_keeps_the_tab() {
    env(Duration::from_millis(400)).run(|e| {
        let (f, g) = (e.text("a.txt"), e.text("b.txt"));
        let label = editor(&e);
        for (path, tab_id) in [(&f, "t1"), (&g, "t2")] {
            e.call_from(
                &label,
                "doc_opened",
                json!({"path": wp(path), "location": tab(&label, tab_id)}),
            )
            .unwrap();
        }
        let refused = e
            .detach(
                &label,
                "t1",
                &f,
                json!({"text": "unsaved"}),
                "doc-1",
                Answer::Refuses("the text did not arrive"),
            )
            .unwrap_err();
        assert_eq!(refused["kind"], json!("DetachRefused"));
        let silent = e
            .detach(&label, "t2", &g, Value::Null, "doc-2", Answer::Silent)
            .unwrap_err();
        assert_eq!(silent["kind"], json!("DetachTimeout"));
        // Both tabs still hold their files.
        for (path, tab_id) in [(&f, "t1"), (&g, "t2")] {
            assert_eq!(inside(&e, "main", path)["location"], tab(&label, tab_id));
        }
    });
}
