// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The open rules (design D4.3 to D4.5, D6.1) and command-line parsing.

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use kern_lib::cli::{self, parse_args, parse_args_report, Plan};
use kern_lib::instance::{pack_args, unpack};
use kern_lib::open::{route, FileId, Gesture, Held, Kind, Location, OpenRegistry, Origin, Target};
use kern_lib::prelaunch::{needs_window, status, Class};
use kern_lib::windows::{next_doc_label, next_editor_label, window_kind, WindowKind};

/// `route` with the caller's part done: links resolved from the disk.
fn go(path: &Path, origin: Origin, gesture: Gesture, kind: Kind, reg: &OpenRegistry) -> Target {
    route(path, &FileId::of(path), origin, gesture, kind, reg)
}

/// Registers `path` the way the commands do.
fn register(reg: &OpenRegistry, path: &Path, loc: Location) {
    reg.insert(path, FileId::of(path), loc);
}

fn tab(window: &str, id: &str) -> Location {
    Location::Tab {
        window: window.to_owned(),
        tab_id: id.to_owned(),
    }
}

/// A look at a file that names nothing, for a path asked about by its text alone.
fn none() -> FileId {
    FileId::default()
}

fn os(s: &str) -> OsString {
    OsString::from(s)
}

fn file(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    fs::write(&p, "x").unwrap();
    p
}

#[test]
fn dir_opens_folder_tab() {
    let t = tempfile::tempdir().unwrap();
    let reg = OpenRegistry::new();
    for origin in [Origin::Inside, Origin::Outside] {
        // Whatever the type flag says, a folder is a folder.
        assert_eq!(
            go(t.path(), origin, Gesture::Default, Kind::Folder, &reg),
            Target::FolderTab(t.path().to_path_buf())
        );
    }
}

#[test]
fn symlink_to_folder_opens_as_folder_with_path_as_given() {
    let t = tempfile::tempdir().unwrap();
    let real = t.path().join("real");
    fs::create_dir(&real).unwrap();
    let link = t.path().join("link");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let reg = OpenRegistry::new();
    assert_eq!(
        go(&link, Origin::Outside, Gesture::Default, Kind::Folder, &reg),
        Target::FolderTab(link)
    );
}

#[test]
fn outside_text_gets_window() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let reg = OpenRegistry::new();
    assert_eq!(
        go(&f, Origin::Outside, Gesture::Default, Kind::Text, &reg),
        Target::DocWindow(f)
    );
}

#[test]
fn inside_text_gets_tab() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let reg = OpenRegistry::new();
    assert_eq!(
        go(&f, Origin::Inside, Gesture::Default, Kind::Text, &reg),
        Target::DocTab(f)
    );
}

#[test]
fn ctrl_double_click_gets_window() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let reg = OpenRegistry::new();
    assert_eq!(
        go(&f, Origin::Inside, Gesture::NewWindow, Kind::Text, &reg),
        Target::DocWindow(f)
    );
}

#[test]
fn non_text_goes_default_app() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.pdf");
    let reg = OpenRegistry::new();
    for (origin, gesture) in [
        (Origin::Inside, Gesture::Default),
        (Origin::Inside, Gesture::NewWindow),
        (Origin::Outside, Gesture::Default),
    ] {
        assert_eq!(
            go(&f, origin, gesture, Kind::Other, &reg),
            Target::DefaultApp(f.clone())
        );
    }
}

#[test]
fn already_open_focuses() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let reg = OpenRegistry::new();
    let loc = tab("main", "t1");
    register(&reg, &f, loc.clone());
    assert_eq!(
        go(&f, Origin::Outside, Gesture::Default, Kind::Text, &reg),
        Target::Focus(loc)
    );
    // Closing it makes it routable again.
    reg.remove(&f);
    assert_eq!(
        go(&f, Origin::Outside, Gesture::Default, Kind::Text, &reg),
        Target::DocWindow(f)
    );
}

#[test]
fn already_open_through_a_link_focuses() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let link = t.path().join("l.txt");
    std::os::unix::fs::symlink(&f, &link).unwrap();
    let reg = OpenRegistry::new();
    let loc = Location::Window {
        label: "doc-1".to_owned(),
    };
    register(&reg, &f, loc.clone());
    assert_eq!(
        go(&link, Origin::Inside, Gesture::Default, Kind::Text, &reg),
        Target::Focus(loc)
    );
}

#[test]
fn removing_a_deleted_file_still_forgets_it() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let reg = OpenRegistry::new();
    register(&reg, &f, tab("main", "t"));
    fs::remove_file(&f).unwrap();
    reg.remove(&f);
    assert_eq!(reg.get(&f, &FileId::default()), None);
}

#[test]
fn window_and_tab_cleanup() {
    let reg = OpenRegistry::new();
    register(
        &reg,
        Path::new("/a"),
        Location::Window {
            label: "doc-1".to_owned(),
        },
    );
    register(&reg, Path::new("/b"), tab("main", "t"));
    register(&reg, Path::new("/c"), tab("editor-1", "u"));
    assert_eq!(reg.path_of_window("doc-1"), Some(PathBuf::from("/a")));
    reg.remove_window("doc-1");
    assert_eq!(reg.get(Path::new("/a"), &none()), None);
    assert!(reg.get(Path::new("/b"), &none()).is_some());
    // A window going takes its own tabs and no other window's.
    reg.remove_window("editor-1");
    assert_eq!(reg.get(Path::new("/c"), &none()), None);
    assert!(reg.get(Path::new("/b"), &none()).is_some());
    reg.remove_window("main");
    assert_eq!(reg.get(Path::new("/b"), &none()), None);
}

#[test]
fn relative_args_use_launch_cwd() {
    let cwd = Path::new("/home/u/work");
    let got = parse_args(&[os("a.txt"), os("sub/b.md"), os("."), os("/abs/c")], cwd);
    assert_eq!(
        got,
        vec![
            cwd.join("a.txt"),
            cwd.join("sub/b.md"),
            cwd.to_path_buf(),
            PathBuf::from("/abs/c")
        ]
    );
}

#[test]
fn file_uri_args_decoded() {
    let cwd = Path::new("/w");
    let got = parse_args(
        &[
            os("file:///home/u/a%20b.txt"),
            os("file://localhost/x/y"),
            os("FILE:/z/q%25r"),
            os("file:///p/q%3Fr?query#frag"),
        ],
        cwd,
    );
    assert_eq!(
        got,
        vec![
            PathBuf::from("/home/u/a b.txt"),
            PathBuf::from("/x/y"),
            PathBuf::from("/z/q%r"),
            PathBuf::from("/p/q?r"),
        ]
    );
}

#[test]
fn non_utf8_arg_kept() {
    let cwd = Path::new("/w");
    let name = OsString::from_vec(b"caf\xe9.txt".to_vec());
    let got = parse_args(std::slice::from_ref(&name), cwd);
    assert_eq!(got[0].as_os_str().as_bytes(), b"/w/caf\xe9.txt");
    // A URI with a percent-escaped invalid byte keeps it too.
    let uri = OsString::from_vec(b"file:///d/caf%E9".to_vec());
    assert_eq!(
        parse_args(&[uri], cwd)[0].as_os_str().as_bytes(),
        b"/d/caf\xe9"
    );
}

#[test]
fn nonexistent_path_is_kept() {
    let got = parse_args(&[os("/no/such/file")], Path::new("/w"));
    assert_eq!(got, vec![PathBuf::from("/no/such/file")]);
}

#[test]
fn remote_file_uri_is_refused_and_reported() {
    let parsed = parse_args_report(
        &[os("file://other.host/x"), os("ok"), os(""), os("file:rel")],
        Path::new("/w"),
    );
    assert_eq!(parsed.paths, vec![PathBuf::from("/w/ok")]);
    assert_eq!(parsed.errors.len(), 3);
    assert_eq!(parsed.errors[0].arg, os("file://other.host/x"));
    assert!(parsed.errors[0].reason.contains("other.host"));
}

#[test]
fn only_the_first_double_dash_ends_options() {
    assert_eq!(
        parse_args(&[os("--"), os("--"), os("-x")], Path::new("/w")),
        vec![PathBuf::from("/w/--"), PathBuf::from("/w/-x")]
    );
}

#[test]
fn escaped_slash_in_a_file_uri_is_refused() {
    // RFC 3986 2.2 and 3.3: %2F is data inside a segment, not a separator.
    for uri in ["file:///z%2Fq", "file:///z/a%2fb/c"] {
        let parsed = parse_args_report(&[os(uri)], Path::new("/w"));
        assert!(parsed.paths.is_empty(), "{uri}");
        assert!(parsed.errors[0].reason.contains("slash"), "{uri}");
    }
}

#[test]
fn unknown_cwd_still_opens_absolute_paths() {
    let parsed = parse_args_report(&[os("/abs/a"), os("rel"), os("file:///f")], Path::new(""));
    assert_eq!(
        parsed.paths,
        vec![PathBuf::from("/abs/a"), PathBuf::from("/f")]
    );
    assert_eq!(parsed.errors.len(), 1);
    assert_eq!(parsed.errors[0].arg, os("rel"));
    assert!(parsed.errors[0].reason.contains("unknown"));
}

#[test]
fn windowless_launches_are_decided_before_the_bus() {
    let img = Class::DefaultApp(PathBuf::from("/p/a.png"));
    let text = Class::Window;
    let bad = Class::Failed("/p/gone: not found".to_owned());
    // No arguments: the main window with a Home tab.
    assert!(needs_window(0, &[]));
    // Only files for their default applications: no window.
    assert!(!needs_window(2, &[img.clone(), img.clone()]));
    // One text file or folder among them needs one.
    assert!(needs_window(2, &[img.clone(), text]));
    // Only errors: no window, and the status says they failed.
    assert!(!needs_window(1, std::slice::from_ref(&bad)));
    assert_eq!(status(1), 1);
    assert_eq!(status(0), 0);
    // An error beside a default-app file still needs none.
    assert!(!needs_window(2, &[img, bad]));
}

#[test]
fn remove_if_keeps_a_registration_that_moved() {
    let reg = OpenRegistry::new();
    let p = Path::new("/a");
    let t = tab("main", "t1");
    let win = Location::Window {
        label: "doc-1".to_owned(),
    };
    register(&reg, p, win.clone());
    // The old tab closing must not erase the window's claim.
    reg.remove_if(p, &t);
    assert_eq!(reg.get(p, &none()), Some(win.clone()));
    reg.remove_if(p, &win);
    assert_eq!(reg.get(p, &none()), None);
}

#[test]
fn forward_args_keep_non_utf8() {
    let argv = vec![
        OsString::from_vec(b"a\xff\xfe".to_vec()),
        os("file:///d/caf%E9"),
        os(""),
    ];
    let cwd = PathBuf::from(OsString::from_vec(b"/w\xc3".to_vec()));
    let packed = pack_args(&argv);
    assert_eq!(packed[0], b"a\xff\xfe".to_vec());
    let inv = unpack(
        packed,
        cwd.as_os_str().as_bytes().to_vec(),
        "tok".to_owned(),
    );
    assert_eq!(inv.argv, argv);
    assert_eq!(inv.cwd, cwd);
    assert_eq!(inv.activation_token, "tok");
    // And what the router makes of the unpacked bytes is what it makes of the originals.
    assert_eq!(parse_args(&inv.argv, &inv.cwd), parse_args(&argv, &cwd));
}

#[test]
fn empty_argv_opens_home() {
    assert_eq!(cli::plan(&[], Path::new("/w")), Plan::Home);
    assert!(matches!(
        cli::plan(&[os("a")], Path::new("/w")),
        Plan::Open(_)
    ));
    // Arguments that are all refused are still a request to open, so the
    // refusals get reported instead of silently showing Home.
    assert!(matches!(cli::plan(&[os("")], Path::new("/w")), Plan::Open(p) if p.paths.is_empty()));
}

#[test]
fn doc_labels_never_reuse_an_open_one() {
    let mut n = 1;
    assert_eq!(next_doc_label(&mut n, |_| false), "doc-1");
    // doc-2 is still open: skipped.
    assert_eq!(next_doc_label(&mut n, |l| l == "doc-2"), "doc-3");
    // A closed label is not handed out again either, as the counter only grows.
    assert_eq!(next_doc_label(&mut n, |_| false), "doc-4");
}

#[test]
fn prelaunch_runs_only_what_needs_no_window() {
    use kern_lib::instance::Invocation;
    let t = tempfile::tempdir().unwrap();
    let inv = |argv: Vec<OsString>| Invocation {
        argv,
        cwd: t.path().to_path_buf(),
        activation_token: String::new(),
    };
    // Nothing to open, a folder: the application starts.
    assert_eq!(kern_lib::prelaunch::run(&inv(vec![])), None);
    assert_eq!(
        kern_lib::prelaunch::run(&inv(vec![t.path().as_os_str().to_owned()])),
        None
    );
    // Only a missing path: finished here, failed.
    assert_eq!(
        kern_lib::prelaunch::run(&inv(vec![os("missing.png")])),
        Some(1)
    );
}

#[test]
fn double_dash_alone_opens_home() {
    // `--` only ends the options; with nothing after it the launch has no
    // arguments, so it is Home, as with none at all.
    assert_eq!(cli::plan(&[os("--")], Path::new("/w")), Plan::Home);
    let t = tempfile::tempdir().unwrap();
    let inv = kern_lib::instance::Invocation {
        argv: vec![os("--")],
        cwd: t.path().to_path_buf(),
        activation_token: String::new(),
    };
    // It needs a window, so the application starts.
    assert_eq!(kern_lib::prelaunch::run(&inv), None);
    // `--` followed by a name is that name.
    assert!(matches!(
        cli::plan(&[os("--"), os("a")], Path::new("/w")),
        Plan::Open(p) if p.paths == vec![PathBuf::from("/w/a")]
    ));
}

#[test]
fn exit_waits_for_answered_launches() {
    use kern_lib::instance::{exit_when_drained, may_exit, Launches};
    assert!(may_exit(0));
    assert!(!may_exit(1));
    // Drained with no window left: exit. A window or a launch left: stay.
    assert!(exit_when_drained(0, 0));
    assert!(!exit_when_drained(0, 1));
    assert!(!exit_when_drained(1, 0));

    let l = Launches::default();
    assert!(l.begin());
    assert!(l.begin());
    // Two answered launches pending: the exit is deferred.
    assert!(!l.exit_requested());
    assert_eq!(l.finish(), 1);
    assert!(!l.exit_requested());
    assert_eq!(l.finish(), 0);
    // Drained: the exit goes ahead, and a launch after it is refused
    // rather than accepted and lost.
    assert!(l.exit_requested());
    assert!(!l.begin());
    assert_eq!(l.pending(), 0);
}

#[test]
fn file_uri_dot_segments_are_removed_but_plain_paths_are_not() {
    let cwd = Path::new("/w");
    let got = parse_args(&[os("file:///a/../b"), os("/a/../c")], cwd);
    // Only a URI path is normalised (RFC 3986 section 5.2.4).
    assert_eq!(got, vec![PathBuf::from("/b"), PathBuf::from("/a/../c")]);
}

#[test]
fn a_hard_link_is_the_same_open_file() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let link = t.path().join("hard.txt");
    fs::hard_link(&f, &link).unwrap();
    let reg = OpenRegistry::new();
    let loc = tab("main", "t1");
    register(&reg, &f, loc.clone());
    // A hard link has its own resolved path, so only the file's identity finds it.
    assert_ne!(FileId::of(&f).canonical, FileId::of(&link).canonical);
    assert_eq!(FileId::of(&f).ident, FileId::of(&link).ident);
    assert_eq!(
        go(&link, Origin::Inside, Gesture::Default, Kind::Text, &reg),
        Target::Focus(loc)
    );
}

#[test]
fn a_different_file_is_not_the_open_one() {
    let t = tempfile::tempdir().unwrap();
    let (a, b) = (file(t.path(), "a.txt"), file(t.path(), "b.txt"));
    let reg = OpenRegistry::new();
    register(&reg, &a, tab("main", "t1"));
    assert_eq!(reg.get(&b, &FileId::of(&b)), None);
}

#[test]
fn held_by_tells_own_free_and_elsewhere_by_any_name() {
    let t = tempfile::tempdir().unwrap();
    let (a, b, c) = (
        file(t.path(), "a.txt"),
        file(t.path(), "b.txt"),
        file(t.path(), "c.txt"),
    );
    let (hard, soft) = (t.path().join("hard.txt"), t.path().join("soft.txt"));
    fs::hard_link(&b, &hard).unwrap();
    std::os::unix::fs::symlink(&b, &soft).unwrap();
    let reg = OpenRegistry::new();
    let mine = tab("main", "t1");
    let theirs = tab("editor-1", "t2");
    register(&reg, &a, mine.clone());
    register(&reg, &b, theirs.clone());
    let held = |p: &Path| reg.held_by(p, &FileId::of(p), &mine);
    assert_eq!(held(&a), Held::Own);
    assert_eq!(held(&c), Held::Free);
    // The file another place has open, under its own name and under both kinds of other name.
    let elsewhere = Held::Elsewhere { location: theirs };
    assert_eq!(held(&b), elsewhere);
    assert_eq!(held(&hard), elsewhere);
    assert_eq!(held(&soft), elsewhere);
    // A name that does not exist yet is free.
    assert_eq!(held(&t.path().join("new.txt")), Held::Free);
}

#[test]
fn a_tab_place_names_its_window_on_the_wire() {
    let loc = tab("editor-2", "t9");
    let json = serde_json::to_value(&loc).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"kind": "tab", "window": "editor-2", "tab_id": "t9"})
    );
    assert_eq!(serde_json::from_value::<Location>(json).unwrap(), loc);
    assert_eq!(loc.window(), "editor-2");
    assert_eq!(
        Location::Window {
            label: "doc-3".to_owned()
        }
        .window(),
        "doc-3"
    );
}

#[test]
fn editor_labels_never_reuse_an_open_one() {
    let mut n = 1;
    assert_eq!(next_editor_label(&mut n, |_| false), "editor-1");
    assert_eq!(next_editor_label(&mut n, |l| l == "editor-2"), "editor-3");
    assert_eq!(next_editor_label(&mut n, |_| false), "editor-4");
}

#[test]
fn windows_are_told_apart_by_label() {
    assert_eq!(window_kind("main"), Some(WindowKind::Main));
    assert_eq!(window_kind("doc-12"), Some(WindowKind::Document));
    assert_eq!(window_kind("editor-3"), Some(WindowKind::Editor));
    for other in [
        "", "doc-", "editor-", "editor-x", "doc-1a", "probe", "editor",
    ] {
        assert_eq!(window_kind(other), None, "{other:?}");
    }
}
