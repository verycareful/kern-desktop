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
    decode_gnome_copied, decode_uri_list, encode_gnome_copied, encode_uri_list, encode_utf8_text,
    kde_cut_data, offered_targets, refuse_dot_segments, require_focus, try_decode_gnome_copied,
    try_decode_uri_list, uri_list_op, ClipOp, TARGET_GNOME, TARGET_KDE_CUT, TARGET_URI_LIST,
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
fn drop_payload_carries_paths_losslessly_and_the_position() {
    use kern_lib::dnd::drop_payload;
    use kernkraft_tauri::WirePath;

    let p = drop_payload(&awkward(), 12.5, 7.0);
    assert_eq!(p.paths.len(), 4);
    assert_eq!(p.paths[0], WirePath::Utf8("/home/a b/x.txt".to_owned()));
    // The name that is not UTF-8 travels as bytes and decodes to itself.
    assert!(matches!(p.paths[1], WirePath::Bytes(_)));
    assert_eq!(p.paths[1].to_path_buf().unwrap(), awkward()[1]);
    let json = serde_json::to_value(&p).unwrap();
    assert_eq!(json["position"]["x"], 12.5);
    assert_eq!(json["position"]["y"], 7.0);
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
