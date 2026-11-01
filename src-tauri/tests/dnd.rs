// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The pieces of the drop from another application that do not need a
//! display: which actions are reported, the payload sent to the window, and
//! the data read from the drag. The GTK signals around them are checked by
//! hand; what is answered to a drag is in `drop_rule.rs`.

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;

use gtk::gdk::DragAction;
use kern_lib::dnd::{action_names, drop_payload, offers_files, uri_list_paths, DropGeometry};
use kernkraft_tauri::WirePath;

fn raw(bytes: &[u8]) -> PathBuf {
    PathBuf::from(OsString::from_vec(bytes.to_vec()))
}

fn geometry() -> DropGeometry {
    DropGeometry {
        x: 12.5,
        y: 7.0,
        width: 1280.0,
        height: 800.0,
    }
}

// ---- the actions ----

#[test]
fn offered_actions_are_named_in_a_fixed_order() {
    let all = DragAction::LINK | DragAction::MOVE | DragAction::COPY | DragAction::ASK;
    assert_eq!(action_names(all), ["copy", "move", "link", "ask"]);
    assert_eq!(
        action_names(DragAction::MOVE | DragAction::COPY),
        ["copy", "move"]
    );
    assert_eq!(action_names(DragAction::MOVE), ["move"]);
}

#[test]
fn no_actions_have_no_names() {
    assert!(action_names(DragAction::empty()).is_empty());
}

#[test]
fn only_a_uri_list_is_a_drop_of_files() {
    assert!(offers_files(["text/plain", "text/uri-list"]));
    assert!(!offers_files(["text/plain", "text/html"]));
    assert!(!offers_files(Vec::<&str>::new()));
}

// ---- the payload ----

#[test]
fn the_payload_carries_paths_losslessly_and_where_and_how_big() {
    let paths = vec![PathBuf::from("/home/a b/x.txt"), raw(b"/tmp/\xff\xfe.bin")];
    let p = drop_payload(
        &paths,
        geometry(),
        DragAction::COPY | DragAction::MOVE,
        Some("move"),
        7,
    );
    assert_eq!(p.paths[0], WirePath::Utf8("/home/a b/x.txt".to_owned()));
    // The name that is not UTF-8 travels as bytes and decodes to itself.
    assert!(matches!(p.paths[1], WirePath::Bytes(_)));
    assert_eq!(p.paths[1].to_path_buf().unwrap(), paths[1]);
    let json = serde_json::to_value(&p).unwrap();
    assert_eq!(json["position"]["x"], 12.5);
    assert_eq!(json["position"]["y"], 7.0);
    assert_eq!(json["view"]["width"], 1280.0);
    assert_eq!(json["view"]["height"], 800.0);
    assert_eq!(json["offered"], serde_json::json!(["copy", "move"]));
    assert_eq!(json["modifier"], "move");
    assert_eq!(json["drag"], 7);
}

#[test]
fn no_modifier_is_null() {
    let p = drop_payload(
        &[PathBuf::from("/a")],
        geometry(),
        DragAction::COPY,
        None,
        1,
    );
    assert_eq!(
        serde_json::to_value(&p).unwrap()["modifier"],
        serde_json::Value::Null
    );
}

// ---- the data ----

#[test]
fn the_uri_list_of_a_drag_decodes_to_the_exact_paths() {
    let bytes = b"# a comment\r\nfile:///home/a%20b/x.txt\r\nfile:///tmp/%FF%FE.bin\r\n";
    let paths = uri_list_paths(bytes).unwrap();
    assert_eq!(
        paths,
        [PathBuf::from("/home/a b/x.txt"), raw(b"/tmp/\xff\xfe.bin")]
    );
}

#[test]
fn a_uri_that_is_not_a_local_file_is_an_error_that_says_so() {
    let e = uri_list_paths(b"https://example.org/a.png\r\n").unwrap_err();
    assert_eq!(e.kind, "Drop");
    assert!(e.message.contains("text/uri-list"), "{}", e.message);
}

#[test]
fn a_drag_that_names_no_file_is_an_error() {
    let e = uri_list_paths(b"# nothing\r\n\r\n").unwrap_err();
    assert_eq!(e.kind, "Drop");
}

#[test]
fn a_dot_segment_in_a_dropped_uri_is_refused_as_it_is_for_the_clipboard() {
    // The application that made the list may have meant the path RFC 3986 section 5.2.4 gives,
    // while a symbolic link would make the filesystem mean another one. Neither is guessed.
    for list in [
        &b"file:///home/u/../v/x\r\n"[..],
        b"file:///home/u/./x\r\n",
        b"file:///home/ok\r\nfile:///a/%2E%2E/b\r\n",
    ] {
        let e = uri_list_paths(list).unwrap_err();
        assert_eq!(e.kind, "BadPath", "{}", String::from_utf8_lossy(list));
        assert!(e.message.contains("segment"), "{}", e.message);
    }
}

// ---- Kern takes the drop itself ----

#[test]
fn tauris_own_drag_and_drop_handling_is_off_for_the_main_window() {
    let context: tauri::Context<tauri::test::MockRuntime> = tauri::generate_context!();
    let main = context
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .expect("the main window is configured");
    assert!(
        !main.drag_drop_enabled,
        "Tauri's handler would take the drop before Kern's own handler sees its action"
    );
}
