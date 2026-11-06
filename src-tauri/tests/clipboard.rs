// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The clipboard formats: `x-special/gnome-copied-files` (the GNOME
//! convention: an operation line, then one `file://` URI per line),
//! `text/uri-list` (RFC 2483, section 5: CRLF line ends, `#` comment lines)
//! and the plain-text target. The GTK calls around them are checked by hand.

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;

use kern_lib::clipboard::{
    clear_plan, decode_gnome_copied, decode_uri_list, encode_gnome_copied, encode_uri_list,
    encode_utf8_text, holds_exactly, kde_cut_data, offered_targets, refuse_dot_segments,
    require_focus, try_decode_gnome_copied, try_decode_uri_list, uri_list_op, Clear, ClipOp,
    Ownership, TARGET_GNOME, TARGET_KDE_CUT, TARGET_URI_LIST,
};

fn raw(bytes: &[u8]) -> PathBuf {
    PathBuf::from(OsString::from_vec(bytes.to_vec()))
}

/// A space, a percent sign, a query and a fragment character, and a byte
/// that is not UTF-8.
fn awkward() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/home/a b/x.txt"),
        raw(b"/tmp/\xff\xfe.bin"),
        PathBuf::from("/srv/100%/#x?y"),
        PathBuf::from("/plain"),
    ]
}

#[test]
fn gnome_copied_round_trip() {
    let paths = awkward();
    for op in [ClipOp::Copy, ClipOp::Cut] {
        let bytes = encode_gnome_copied(op, &paths);
        assert_eq!(decode_gnome_copied(&bytes), Some((op, paths.clone())));
    }
    // The operation line, one URI per line, no trailing newline; every
    // byte outside the unreserved set and '/' is escaped (RFC 3986 2.3).
    let want = "copy\n\
                file:///home/a%20b/x.txt\n\
                file:///tmp/%FF%FE.bin\n\
                file:///srv/100%25/%23x%3Fy\n\
                file:///plain";
    assert_eq!(
        encode_gnome_copied(ClipOp::Copy, &paths),
        want.as_bytes().to_vec()
    );
}

#[test]
fn cut_and_copy_are_told_apart() {
    let one = [PathBuf::from("/a")];
    assert!(encode_gnome_copied(ClipOp::Cut, &one).starts_with(b"cut\n"));
    assert!(encode_gnome_copied(ClipOp::Copy, &one).starts_with(b"copy\n"));
    assert_eq!(
        decode_gnome_copied(b"cut\nfile:///a"),
        Some((ClipOp::Cut, vec![PathBuf::from("/a")]))
    );
    assert_eq!(
        decode_gnome_copied(b"copy\nfile:///a"),
        Some((ClipOp::Copy, vec![PathBuf::from("/a")]))
    );
}

#[test]
fn gnome_copied_tolerates_a_trailing_newline_and_crlf() {
    assert_eq!(
        decode_gnome_copied(b"cut\r\nfile:///a\r\nfile:///b\r\n"),
        Some((ClipOp::Cut, vec![PathBuf::from("/a"), PathBuf::from("/b")]))
    );
}

#[test]
fn uri_list_crlf_and_comments() {
    let input = b"# a comment\r\nfile:///a%20b\r\n\r\n# another\r\nfile:///c\r\n";
    assert_eq!(
        decode_uri_list(input),
        Some(vec![PathBuf::from("/a b"), PathBuf::from("/c")])
    );
    // A list from a sender that ends lines with a bare LF is read too.
    assert_eq!(
        decode_uri_list(b"file:///a\nfile:///b"),
        Some(vec![PathBuf::from("/a"), PathBuf::from("/b")])
    );
    let paths = awkward();
    let bytes = encode_uri_list(&paths);
    // Every line, the last included, ends CRLF (RFC 2483, section 5).
    assert!(bytes.ends_with(b"\r\n"));
    assert_eq!(bytes.iter().filter(|&&b| b == b'\n').count(), paths.len());
    assert_eq!(
        bytes.windows(2).filter(|w| w == b"\r\n").count(),
        paths.len()
    );
    assert_eq!(decode_uri_list(&bytes), Some(paths));
}

#[test]
fn utf8_text_target_is_paths() {
    let paths = [PathBuf::from("/home/a b/x.txt"), PathBuf::from("/tmp/y")];
    assert_eq!(
        encode_utf8_text(&paths),
        b"/home/a b/x.txt\n/tmp/y".to_vec()
    );
    // A name that is not UTF-8 cannot be exact text: it shows U+FFFD.
    assert_eq!(
        encode_utf8_text(&[raw(b"/t/\xff")]),
        "/t/\u{FFFD}".as_bytes().to_vec()
    );
}

#[test]
fn remote_host_uris_are_refused() {
    assert_eq!(decode_gnome_copied(b"copy\nfile://otherhost/x"), None);
    assert_eq!(decode_uri_list(b"file://otherhost/x\r\n"), None);
    let e = try_decode_gnome_copied(b"copy\nfile:///ok\nfile://otherhost/x").unwrap_err();
    assert!(e.to_string().contains("otherhost"), "{e}");
    assert!(
        e.to_string().contains("x-special/gnome-copied-files"),
        "{e}"
    );
    let e = try_decode_uri_list(b"file://otherhost/x").unwrap_err();
    assert!(e.to_string().contains("text/uri-list"), "{e}");
    // `localhost` is this host (RFC 8089, section 3).
    assert_eq!(
        decode_uri_list(b"file://localhost/x"),
        Some(vec![PathBuf::from("/x")])
    );
}

#[test]
fn empty_or_malformed_payloads_are_errors_naming_the_target() {
    for bad in [
        &b""[..],
        b"copy\n",
        b"copy",
        b"paste\nfile:///a",
        b"file:///a",
        b"copy\nhttp://example.org/a",
        b"cut\n\xff\xfe",
    ] {
        assert_eq!(decode_gnome_copied(bad), None, "{bad:?}");
        let e = try_decode_gnome_copied(bad).unwrap_err();
        assert!(
            e.to_string().contains("x-special/gnome-copied-files"),
            "{e}"
        );
    }
    for bad in [
        &b""[..],
        b"# only a comment\r\n",
        b"/not/a/uri\r\n",
        b"ftp://h/a",
    ] {
        assert_eq!(decode_uri_list(bad), None, "{bad:?}");
        let e = try_decode_uri_list(bad).unwrap_err();
        assert!(e.to_string().contains("text/uri-list"), "{e}");
    }
}

#[test]
fn kde_cut_target_is_offered_on_cut_only() {
    // KIO's setClipboardDataCut writes "1" under application/x-kde-cutselection
    // for a cut and "0" (or nothing) for a copy; Kern offers it for a cut only.
    assert_eq!(kde_cut_data(ClipOp::Cut), Some(&b"1"[..]));
    assert_eq!(kde_cut_data(ClipOp::Copy), None);
    assert!(offered_targets(ClipOp::Cut).contains(&TARGET_KDE_CUT));
    assert!(!offered_targets(ClipOp::Copy).contains(&TARGET_KDE_CUT));
    for op in [ClipOp::Copy, ClipOp::Cut] {
        let t = offered_targets(op);
        assert!(t.contains(&TARGET_GNOME) && t.contains(&TARGET_URI_LIST));
        // Every text variant an X11 client may ask for (GTK's text targets).
        for name in ["STRING", "TEXT", "text/plain", "UTF8_STRING"] {
            assert!(t.contains(&name), "{name}");
        }
    }
}

#[test]
fn uri_list_is_a_cut_only_with_the_kde_marker() {
    assert_eq!(uri_list_op(Some(b"1")), ClipOp::Cut);
    assert_eq!(uri_list_op(Some(b"0")), ClipOp::Copy);
    assert_eq!(uri_list_op(Some(b"")), ClipOp::Copy);
    assert_eq!(uri_list_op(None), ClipOp::Copy);
}

#[test]
fn clipboard_use_needs_a_focused_window() {
    assert!(require_focus(true).is_ok());
    let e = require_focus(false).unwrap_err();
    assert_eq!(e.kind, "NoFocus");
    assert!(e.message.contains("focus"), "{}", e.message);
}

#[test]
fn dot_segments_are_refused_with_the_path_named() {
    assert!(refuse_dot_segments(&awkward()).is_ok());
    for bad in ["/a/./b", "/a/../b", "/a/..", "/./a", "/a/b/."] {
        let e = refuse_dot_segments(&[PathBuf::from("/ok"), PathBuf::from(bad)]).unwrap_err();
        assert_eq!(e.kind, "BadPath", "{bad}");
        assert!(e.message.contains(bad), "{}", e.message);
    }
    // A name that merely contains dots is fine.
    assert!(refuse_dot_segments(&[PathBuf::from("/a/.hidden/..x/y..")]).is_ok());
}

#[test]
fn kde_marker_with_a_uri_list_round_trips_as_cut() {
    let paths = awkward();
    let list = encode_uri_list(&paths);
    assert_eq!(decode_uri_list(&list), Some(paths));
    assert_eq!(uri_list_op(kde_cut_data(ClipOp::Cut)), ClipOp::Cut);
    assert_eq!(uri_list_op(kde_cut_data(ClipOp::Copy)), ClipOp::Copy);
}

#[test]
fn a_cut_is_held_exactly_when_the_operation_and_every_path_in_order_are_the_same() {
    let paths = awkward();
    let held = Some((ClipOp::Cut, paths.clone()));
    assert!(holds_exactly(held.as_ref(), ClipOp::Cut, &paths));
}

#[test]
fn a_copy_is_not_the_cut_that_was_pasted() {
    let paths = awkward();
    let held = Some((ClipOp::Copy, paths.clone()));
    assert!(!holds_exactly(held.as_ref(), ClipOp::Cut, &paths));
}

#[test]
fn another_selection_is_not_the_cut_that_was_pasted() {
    let paths = awkward();
    // One path more, one fewer, a different one, and the same ones in another order.
    let mut more = paths.clone();
    more.push(PathBuf::from("/extra"));
    let fewer = paths[..2].to_vec();
    let mut other = paths.clone();
    other[3] = PathBuf::from("/other");
    let mut reordered = paths.clone();
    reordered.reverse();
    for held in [more, fewer, other, reordered] {
        let held = Some((ClipOp::Cut, held));
        assert!(!holds_exactly(held.as_ref(), ClipOp::Cut, &paths));
    }
}

#[test]
fn an_empty_clipboard_holds_nothing() {
    assert!(!holds_exactly(None, ClipOp::Cut, &awkward()));
}

#[test]
fn paths_that_differ_only_in_bytes_that_are_not_utf8_are_different() {
    let held = Some((ClipOp::Cut, vec![raw(b"/tmp/\xff.bin")]));
    assert!(holds_exactly(
        held.as_ref(),
        ClipOp::Cut,
        &[raw(b"/tmp/\xff.bin")]
    ));
    assert!(!holds_exactly(
        held.as_ref(),
        ClipOp::Cut,
        &[raw(b"/tmp/\xfe.bin")]
    ));
}

// ---- clearing a cut that was pasted ----

#[test]
fn a_clipboard_that_is_not_the_pasted_cut_is_left_alone_whoever_owns_it() {
    for kern_owns in [true, false] {
        for changed in [true, false] {
            assert_eq!(clear_plan(false, changed, kern_owns, false), Clear::Keep);
        }
    }
}

#[test]
fn a_clipboard_that_changed_since_it_was_read_is_left_alone() {
    // The cut was read, then something else was copied before the clear: that copy is kept.
    assert_eq!(clear_plan(true, true, true, false), Clear::Keep);
    assert_eq!(clear_plan(true, true, false, false), Clear::Keep);
}

#[test]
fn kerns_own_offer_is_released_and_not_replaced_by_empty_text() {
    assert_eq!(clear_plan(true, false, true, false), Clear::Release);
}

#[test]
fn another_applications_cut_is_taken_over_since_it_cannot_be_released() {
    assert_eq!(clear_plan(true, false, false, false), Clear::TakeOver);
}

#[test]
fn a_clear_the_page_was_told_failed_never_happens() {
    // The command timed out and said so; the clipboard that answers later is left as it is.
    for kern_owns in [true, false] {
        assert_eq!(clear_plan(true, false, kern_owns, true), Clear::Keep);
    }
}

#[test]
fn nothing_is_offered_before_the_first_claim() {
    static O: Ownership = Ownership::new();
    assert_eq!(O.current(), 0);
}

#[test]
fn a_claimed_offer_is_current_until_it_is_dropped() {
    static O: Ownership = Ownership::new();
    let offer = O.offer();
    // Made but not yet accepted by GTK: not current.
    assert_eq!(O.current(), 0);
    O.claim(offer.id());
    assert_eq!(O.current(), offer.id());
    drop(offer);
    assert_eq!(O.current(), 0);
}

#[test]
fn an_older_offer_dropped_after_a_newer_one_was_claimed_leaves_the_newer_current() {
    static O: Ownership = Ownership::new();
    let old = O.offer();
    O.claim(old.id());
    let new = O.offer();
    O.claim(new.id());
    assert_ne!(old.id(), new.id());
    assert_eq!(O.current(), new.id());
    drop(old);
    assert_eq!(O.current(), new.id());
    drop(new);
    assert_eq!(O.current(), 0);
}

#[test]
fn an_offer_that_was_never_claimed_does_not_clear_the_one_that_is() {
    static O: Ownership = Ownership::new();
    let kept = O.offer();
    O.claim(kept.id());
    let refused = O.offer();
    drop(refused);
    assert_eq!(O.current(), kept.id());
    drop(kept);
}
