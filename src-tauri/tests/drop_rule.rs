// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! What Kern answers a drag from another application with, and when. The GTK
//! signals around these decisions need a display and are checked by hand; the
//! decisions themselves are plain functions.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use gtk::gdk::DragAction;
use kern_lib::drop_rule::{
    navigation_allowed, needs_filesystems, stance, standing, user_modifier, Gate, Listing, Stance,
    Throttle, Verdict, Whereto, HOVER_INTERVAL,
};

const BOTH: DragAction =
    DragAction::from_bits_truncate(DragAction::COPY.bits() | DragAction::MOVE.bits());

fn answers(list: &[Option<bool>]) -> Vec<Result<bool, String>> {
    list.iter()
        .map(|a| a.ok_or_else(|| "no such file".to_owned()))
        .collect()
}

// ---- whose drag it is ----

#[test]
fn a_drag_without_files_is_left_to_the_page() {
    // Text for a field in the page is WebKit's, in every window.
    assert_eq!(stance(true, false, false), Stance::NotOurs);
    assert_eq!(stance(false, false, false), Stance::NotOurs);
}

#[test]
fn the_main_window_takes_a_foreign_drag_of_files() {
    assert_eq!(stance(true, true, false), Stance::Take);
}

#[test]
fn a_drag_whose_source_is_kerns_own_widget_is_refused() {
    // Dragging inside Kern is made of pointer events; the native drag Kern starts when the pointer
    // leaves the window must not be taken when it comes back.
    assert_eq!(stance(true, true, true), Stance::Refuse);
}

#[test]
fn a_document_window_refuses_files() {
    assert_eq!(stance(false, true, false), Stance::Refuse);
    assert_eq!(stance(false, true, true), Stance::Refuse);
}

// ---- what the pointer shows ----

#[test]
fn an_application_that_offers_one_of_copy_and_move_is_obeyed_without_asking_the_filesystems() {
    assert!(!needs_filesystems(DragAction::COPY));
    assert!(!needs_filesystems(DragAction::MOVE | DragAction::LINK));
    assert!(needs_filesystems(BOTH));
    assert!(needs_filesystems(BOTH | DragAction::ASK));
    let copy = verdict_of(DragAction::COPY, &[]);
    assert_eq!(copy.action, DragAction::COPY);
    assert_eq!(copy.refusal, None);
    assert_eq!(verdict_of(DragAction::MOVE, &[]).action, DragAction::MOVE);
}

fn verdict_of(offered: DragAction, same: &[Option<bool>]) -> Verdict {
    kern_lib::drop_rule::verdict(offered, &answers(same))
}

#[test]
fn files_on_the_destinations_filesystem_show_a_move() {
    let v = verdict_of(BOTH, &[Some(true), Some(true)]);
    assert_eq!((v.action, v.moves, v.copies), (DragAction::MOVE, 2, 0));
    assert_eq!(v.refusal, None);
}

#[test]
fn files_on_another_filesystem_show_a_copy() {
    let v = verdict_of(BOTH, &[Some(false)]);
    assert_eq!((v.action, v.moves, v.copies), (DragAction::COPY, 0, 1));
}

#[test]
fn a_mixed_drag_shows_what_most_of_it_does_and_counts_both_halves() {
    let v = verdict_of(BOTH, &[Some(true), Some(true), Some(false)]);
    assert_eq!((v.action, v.moves, v.copies), (DragAction::MOVE, 2, 1));
    let v = verdict_of(BOTH, &[Some(true), Some(false), Some(false)]);
    assert_eq!((v.action, v.moves, v.copies), (DragAction::COPY, 1, 2));
}

#[test]
fn an_even_split_shows_a_copy_because_a_copy_removes_nothing() {
    let v = verdict_of(BOTH, &[Some(true), Some(false)]);
    assert_eq!(v.action, DragAction::COPY);
}

#[test]
fn files_that_could_not_be_judged_are_left_out_of_the_count() {
    let v = verdict_of(BOTH, &[None, Some(true)]);
    assert_eq!((v.action, v.moves, v.copies), (DragAction::MOVE, 1, 0));
    assert_eq!(v.refusal, None);
}

#[test]
fn a_drag_where_nothing_can_be_acted_on_is_refused_with_the_reason() {
    let v = verdict_of(BOTH, &[None, None]);
    assert_eq!(v.action, DragAction::empty());
    let why = v.refusal.expect("a refusal");
    assert!(why.contains("no such file"), "{why}");
}

#[test]
fn a_drag_with_no_files_in_it_is_refused() {
    let v = verdict_of(BOTH, &[]);
    assert_eq!(v.action, DragAction::empty());
    assert!(v.refusal.is_some());
}

#[test]
fn a_drag_that_offers_neither_copy_nor_move_is_refused_and_says_so() {
    for offered in [DragAction::LINK, DragAction::empty(), DragAction::ASK] {
        let v = verdict_of(offered, &[Some(true)]);
        assert_eq!(v.action, DragAction::empty());
        let why = v.refusal.expect("a refusal");
        assert!(why.contains("copy") && why.contains("move"), "{why}");
    }
}

// ---- what is said now ----

fn ready() -> Listing {
    Listing::Ready(vec![PathBuf::from("/a")])
}

fn moves() -> Verdict {
    verdict_of(BOTH, &[Some(true)])
}

#[test]
fn nothing_is_accepted_until_the_list_is_read() {
    let s = standing(
        &Listing::Waiting,
        &Whereto::Folder(PathBuf::from("/d")),
        Some(&moves()),
    );
    assert_eq!(s.action, DragAction::empty());
    assert_eq!(s.refusal, None);
}

#[test]
fn a_list_that_cannot_be_used_refuses_with_its_reason() {
    let s = standing(
        &Listing::Unusable("it names no files".to_owned()),
        &Whereto::Folder(PathBuf::from("/d")),
        Some(&moves()),
    );
    assert_eq!(s.action, DragAction::empty());
    assert_eq!(s.refusal.as_deref(), Some("it names no files"));
}

#[test]
fn nothing_is_accepted_until_the_page_has_said_where_the_pointer_is() {
    let s = standing(&ready(), &Whereto::Unknown, Some(&moves()));
    assert_eq!(s.action, DragAction::empty());
    assert_eq!(s.refusal, None);
}

#[test]
fn a_place_the_page_refuses_is_refused_with_the_pages_reason() {
    let s = standing(&ready(), &Whereto::Refused("not a folder".to_owned()), None);
    assert_eq!(s.action, DragAction::empty());
    assert_eq!(s.refusal.as_deref(), Some("not a folder"));
}

#[test]
fn nothing_is_accepted_while_the_destination_is_still_being_judged() {
    let s = standing(&ready(), &Whereto::Folder(PathBuf::from("/d")), None);
    assert_eq!(s.action, DragAction::empty());
    assert_eq!(s.refusal, None);
}

#[test]
fn a_folder_with_a_verdict_shows_the_verdicts_action() {
    let s = standing(
        &ready(),
        &Whereto::Folder(PathBuf::from("/d")),
        Some(&moves()),
    );
    assert_eq!(s.action, DragAction::MOVE);
    assert_eq!(s.refusal, None);
    let none = verdict_of(BOTH, &[None]);
    let s = standing(&ready(), &Whereto::Folder(PathBuf::from("/d")), Some(&none));
    assert_eq!(s.action, DragAction::empty());
    assert!(s.refusal.is_some());
}

// ---- the user's modifier ----

#[test]
fn an_action_other_than_kerns_answer_is_the_users_modifier() {
    // Kern showed a move; the compositor, with Ctrl held, selected a copy: Ctrl copies.
    assert_eq!(
        user_modifier(DragAction::COPY, DragAction::MOVE),
        Some("copy")
    );
    // Kern showed a copy; with Shift held the compositor selected a move.
    assert_eq!(
        user_modifier(DragAction::MOVE, DragAction::COPY),
        Some("move")
    );
}

#[test]
fn the_action_kern_showed_is_no_modifier() {
    assert_eq!(user_modifier(DragAction::COPY, DragAction::COPY), None);
    assert_eq!(user_modifier(DragAction::MOVE, DragAction::MOVE), None);
}

#[test]
fn a_selected_action_that_is_not_exactly_copy_or_move_is_no_modifier() {
    for selected in [
        DragAction::empty(),
        BOTH,
        DragAction::LINK,
        DragAction::ASK,
        DragAction::DEFAULT,
    ] {
        assert_eq!(
            user_modifier(selected, DragAction::COPY),
            None,
            "{selected:?}"
        );
    }
}

#[test]
fn nothing_is_a_modifier_when_kern_showed_nothing() {
    assert_eq!(user_modifier(DragAction::COPY, DragAction::empty()), None);
}

// ---- the hover rate ----

#[test]
fn the_first_position_goes_at_once_and_a_burst_is_cut_to_one_delayed_position() {
    let t0 = Instant::now();
    let mut t = Throttle::new(HOVER_INTERVAL);
    assert_eq!(t.gate(t0), Gate::Now);
    let a = t0 + Duration::from_millis(5);
    let Gate::Later(wait) = t.gate(a) else {
        panic!("a position inside the interval waits")
    };
    assert_eq!(wait, HOVER_INTERVAL - Duration::from_millis(5));
    // Further positions before it fires are covered by the one waiting.
    assert_eq!(t.gate(t0 + Duration::from_millis(9)), Gate::Skip);
    assert_eq!(t.gate(t0 + Duration::from_millis(20)), Gate::Skip);
    t.fired(t0 + HOVER_INTERVAL);
    assert!(t
        .gate(t0 + HOVER_INTERVAL + Duration::from_millis(1))
        .is_later());
}

#[test]
fn a_position_after_the_interval_goes_at_once() {
    let t0 = Instant::now();
    let mut t = Throttle::new(HOVER_INTERVAL);
    assert_eq!(t.gate(t0), Gate::Now);
    assert_eq!(t.gate(t0 + HOVER_INTERVAL), Gate::Now);
}

#[test]
fn a_new_drag_starts_with_a_fresh_throttle() {
    let t0 = Instant::now();
    let mut t = Throttle::new(HOVER_INTERVAL);
    assert_eq!(t.gate(t0), Gate::Now);
    assert!(t.gate(t0 + Duration::from_millis(1)).is_later());
    t.reset();
    assert_eq!(t.gate(t0 + Duration::from_millis(2)), Gate::Now);
}

// ---- where the page may navigate ----

fn url(s: &str) -> tauri::Url {
    s.parse().unwrap()
}

#[test]
fn the_apps_own_origin_may_be_navigated_to() {
    assert!(navigation_allowed(&url("tauri://localhost/"), None));
    assert!(navigation_allowed(
        &url("tauri://localhost/index.html#x"),
        None
    ));
}

#[test]
fn nothing_else_may_be_navigated_to() {
    for u in [
        "file:///home/a/x.txt",
        "https://example.org/",
        "http://localhost:1420/",
        "tauri://evil.example/",
        "about:blank",
        "data:text/html,hi",
    ] {
        assert!(!navigation_allowed(&url(u), None), "{u}");
    }
}

#[test]
fn the_dev_server_is_allowed_only_when_one_is_configured() {
    let dev = url("http://localhost:1420/");
    assert!(navigation_allowed(
        &url("http://localhost:1420/x"),
        Some(&dev)
    ));
    assert!(!navigation_allowed(
        &url("http://localhost:1421/"),
        Some(&dev)
    ));
    assert!(!navigation_allowed(
        &url("https://localhost:1420/"),
        Some(&dev)
    ));
    assert!(!navigation_allowed(
        &url("http://example.org:1420/"),
        Some(&dev)
    ));
}
