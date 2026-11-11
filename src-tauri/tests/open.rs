// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The open rules and command-line parsing.

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use kern_lib::cli::{self, parse_args, parse_args_report, Plan};
use kern_lib::instance::{pack_args, unpack};
use kern_lib::open::{
    route, FileId, Gesture, Held, Kind, Location, Moved, OpenRegistry, Origin, Stat, Target,
};
use kern_lib::prelaunch::{needs_window, status, Class};
use kern_lib::windows::{next_doc_label, next_editor_label, window_kind, WindowKind};

/// How long a look at the registered paths may take in these tests.
const BOUND: Duration = Duration::from_secs(5);

/// The look the application makes: each path's file read from the disk.
fn disk() -> Stat {
    Arc::new(FileId::of)
}

/// Where `path`, looked at as `id`, is open.
fn get(reg: &OpenRegistry, path: &Path, id: &FileId) -> Option<Location> {
    reg.survey(path, &disk(), BOUND).lookup(id).location
}

fn held_by(reg: &OpenRegistry, path: &Path, own: &Location) -> Held {
    reg.survey(path, &disk(), BOUND)
        .held_by(&FileId::of(path), own)
        .unwrap()
}

/// `route` with the caller's part done: links resolved from the disk.
fn go(path: &Path, origin: Origin, gesture: Gesture, kind: Kind, reg: &OpenRegistry) -> Target {
    route(
        path,
        get(reg, path, &FileId::of(path)),
        origin,
        gesture,
        kind,
    )
}

/// Registers `path` the way the commands do.
fn register(reg: &OpenRegistry, path: &Path, loc: Location) {
    reg.insert(path, loc);
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
    assert_eq!(get(&reg, &f, &FileId::default()), None);
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
    assert_eq!(get(&reg, Path::new("/a"), &none()), None);
    assert!(get(&reg, Path::new("/b"), &none()).is_some());
    // A window going takes its own tabs and no other window's.
    reg.remove_window("editor-1");
    assert_eq!(get(&reg, Path::new("/c"), &none()), None);
    assert!(get(&reg, Path::new("/b"), &none()).is_some());
    reg.remove_window("main");
    assert_eq!(get(&reg, Path::new("/b"), &none()), None);
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
    assert_eq!(get(&reg, p, &none()), Some(win.clone()));
    reg.remove_if(p, &win);
    assert_eq!(get(&reg, p, &none()), None);
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
    assert_eq!(get(&reg, &b, &FileId::of(&b)), None);
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
    let held = |p: &Path| held_by(&reg, p, &mine);
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

#[test]
fn a_hard_link_made_after_the_file_was_replaced_by_rename_is_the_open_file() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let reg = OpenRegistry::new();
    let loc = tab("main", "t1");
    register(&reg, &f, loc.clone());
    // A name for the file as it was when it was registered.
    let before = t.path().join("before.txt");
    fs::hard_link(&f, &before).unwrap();
    // A save: a temp file renamed over the path, as kernkraft-fs writes, so the path has a new inode.
    let tmp = t.path().join(".a.txt.tmp");
    fs::write(&tmp, "saved").unwrap();
    fs::rename(&tmp, &f).unwrap();
    let after = t.path().join("after.txt");
    fs::hard_link(&f, &after).unwrap();
    assert_ne!(FileId::of(&before).ident, FileId::of(&f).ident);
    let held = |p: &Path| held_by(&reg, p, &tab("editor-1", "t2"));
    // The link to the file as it is now is the open file; the link to the old inode is a different file.
    assert_eq!(
        held(&after),
        Held::Elsewhere {
            location: loc.clone()
        }
    );
    assert_eq!(held(&before), Held::Free);
    assert_eq!(
        go(&after, Origin::Inside, Gesture::Default, Kind::Text, &reg),
        Target::Focus(loc)
    );
}

#[test]
fn a_document_deleted_on_disk_is_found_through_a_link_that_dangles() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let reg = OpenRegistry::new();
    let loc = tab("main", "t1");
    register(&reg, &f, loc.clone());
    fs::remove_file(&f).unwrap();
    let link = t.path().join("link.txt");
    std::os::unix::fs::symlink(&f, &link).unwrap();
    // Neither path exists: the link is resolved to where it points.
    assert_eq!(FileId::of(&link).ident, None);
    assert_eq!(get(&reg, &link, &FileId::of(&link)), Some(loc));
    // A link through a folder that is a link too, to a file that is gone, is another file.
    let other = t.path().join("other.txt");
    std::os::unix::fs::symlink(t.path().join("elsewhere.txt"), &other).unwrap();
    assert_eq!(get(&reg, &other, &FileId::of(&other)), None);
}

#[test]
fn a_loop_of_links_is_given_up_not_followed_for_ever() {
    let t = tempfile::tempdir().unwrap();
    let (a, b) = (t.path().join("a"), t.path().join("b"));
    std::os::unix::fs::symlink(&b, &a).unwrap();
    std::os::unix::fs::symlink(&a, &b).unwrap();
    assert_eq!(FileId::of(&a), FileId::default());
}

#[test]
fn a_hold_for_a_window_is_a_place_found_by_identity_and_goes_with_the_window() {
    let t = tempfile::tempdir().unwrap();
    let f = file(t.path(), "a.txt");
    let hard = t.path().join("hard.txt");
    fs::hard_link(&f, &hard).unwrap();
    let reg = OpenRegistry::new();
    let hold = Location::Opening {
        window: "editor-1".to_owned(),
    };
    register(&reg, &f, hold.clone());
    assert_eq!(
        go(&hard, Origin::Inside, Gesture::Default, Kind::Text, &reg),
        Target::Focus(hold.clone())
    );
    assert_eq!(hold.window(), "editor-1");
    let json = serde_json::to_value(&hold).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"kind": "opening", "window": "editor-1"})
    );
    reg.remove_window("editor-1");
    assert_eq!(get(&reg, &f, &FileId::of(&f)), None);
}

// ---- the generation, the survey and what does not answer ----

#[test]
fn a_window_losing_its_tabs_keeps_its_own_place_and_what_other_windows_hold() {
    let reg = OpenRegistry::new();
    let (a, b, c, d, e, f) = (
        Path::new("/a"),
        Path::new("/b"),
        Path::new("/c"),
        Path::new("/d"),
        Path::new("/e"),
        Path::new("/f"),
    );
    reg.insert(a, tab("editor-1", "t1"));
    // A Save As target held at a tab goes with the tab.
    reg.reserve(b, tab("editor-1", "t2"));
    // Not tabs of the window: its own place, a path held for a tab that has not
    // registered, another window's tab, and a document window.
    reg.insert(
        c,
        Location::Window {
            label: "editor-1".to_owned(),
        },
    );
    reg.insert(
        d,
        Location::Opening {
            window: "editor-1".to_owned(),
        },
    );
    reg.insert(e, tab("main", "t1"));
    reg.insert(
        f,
        Location::Window {
            label: "doc-1".to_owned(),
        },
    );
    let before = reg.generation();
    reg.remove_tabs_of("editor-1");
    assert!(reg.generation() > before);
    let at = |p: &Path| get(&reg, p, &FileId::of(p));
    assert_eq!(at(a), None);
    assert_eq!(at(b), None);
    assert!(matches!(at(c), Some(Location::Window { .. })));
    assert!(matches!(at(d), Some(Location::Opening { .. })));
    assert_eq!(at(e), Some(tab("main", "t1")));
    assert!(matches!(at(f), Some(Location::Window { .. })));
}

#[test]
fn a_window_with_no_tabs_losing_them_changes_nothing_and_says_nothing() {
    let reg = OpenRegistry::new();
    let told = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = Arc::clone(&told);
    reg.on_release(Arc::new(move || {
        seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }));
    reg.insert(Path::new("/a"), tab("main", "t1"));
    let g = reg.generation();
    reg.remove_tabs_of("editor-1");
    reg.remove_tabs_of("nobody");
    assert_eq!(reg.generation(), g);
    assert_eq!(told.load(std::sync::atomic::Ordering::SeqCst), 0);
    // A window that did hold tabs lets go, and the places waiting to retry are told.
    reg.remove_tabs_of("main");
    assert_eq!(told.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn every_change_to_the_registry_moves_its_generation_and_a_no_op_does_not() {
    let reg = OpenRegistry::new();
    let g = |reg: &OpenRegistry| reg.generation();
    let (a, b) = (Path::new("/a"), Path::new("/b"));
    let g0 = g(&reg);
    reg.insert(a, tab("main", "t1"));
    let g1 = g(&reg);
    assert!(g1 > g0);
    reg.reserve(b, tab("main", "t1"));
    let g2 = g(&reg);
    assert!(g2 > g1);
    // Nothing to remove: unchanged.
    reg.remove(Path::new("/c"));
    reg.remove_if(a, &tab("main", "other"));
    reg.remove_tab("main", "nobody");
    reg.remove_window("nobody");
    assert_eq!(g(&reg), g2);
    reg.remove_if(a, &tab("main", "t1"));
    let g3 = g(&reg);
    assert!(g3 > g2);
    reg.remove_tab("main", "t1");
    let g4 = g(&reg);
    assert!(g4 > g3);
    reg.insert(a, tab("editor-1", "t"));
    let g5 = g(&reg);
    reg.remove_window("editor-1");
    assert!(g(&reg) > g5);
    reg.insert(a, tab("main", "t"));
    let g6 = g(&reg);
    reg.remove(a);
    assert!(g(&reg) > g6);
    // A survey carries the number it was taken at.
    reg.insert(b, tab("main", "t"));
    let survey = reg.survey(Path::new("/z"), &disk(), BOUND);
    assert_eq!(survey.generation, reg.generation());
    reg.remove(b);
    assert_ne!(survey.generation, reg.generation());
}

/// A stat that blocks on the paths in `hung` until the returned sender is dropped or sent to, and
/// counts its calls.
fn blocking_stat(
    hung: &[&Path],
) -> (
    Stat,
    std::sync::mpsc::Sender<()>,
    Arc<std::sync::atomic::AtomicUsize>,
) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Mutex};
    let (tx, rx) = mpsc::channel::<()>();
    let rx = Arc::new(Mutex::new(rx));
    let hung: Vec<PathBuf> = hung.iter().map(|p| p.to_path_buf()).collect();
    let calls = Arc::new(AtomicUsize::new(0));
    let c = Arc::clone(&calls);
    let stat: Stat = Arc::new(move |p: &Path| {
        if hung.iter().any(|h| h == p) {
            c.fetch_add(1, Ordering::SeqCst);
            // Returns when the sender is dropped or sent to.
            let _ = rx.lock().unwrap().recv();
        }
        FileId::of(p)
    });
    (stat, tx, calls)
}

#[test]
fn a_survey_waits_at_most_its_bound_for_a_path_that_does_not_answer_and_says_which() {
    let t = tempfile::tempdir().unwrap();
    let (a, b) = (file(t.path(), "a.txt"), file(t.path(), "b.txt"));
    let c = file(t.path(), "c.txt");
    let reg = OpenRegistry::new();
    register(&reg, &a, tab("main", "t1"));
    register(&reg, &b, tab("main", "t2"));
    let (stat, release, _) = blocking_stat(&[&a]);
    let started = std::time::Instant::now();
    let survey = reg.survey(&c, &stat, Duration::from_millis(200));
    // Waited for the bound, not for the stat.
    assert!(started.elapsed() < Duration::from_secs(5));
    let found = survey.lookup(&FileId::of(&c));
    assert_eq!(found.location, None);
    assert_eq!(found.unanswered, vec![a.clone()]);
    // What answered is compared by identity as ever: b.txt's hard link is found.
    let hard = t.path().join("hard-b.txt");
    fs::hard_link(&b, &hard).unwrap();
    assert_eq!(
        survey.lookup(&FileId::of(&hard)).location,
        Some(tab("main", "t2"))
    );
    // A path that did not answer is compared by its text: with the asked path's resolution.
    let link = t.path().join("link-a.txt");
    std::os::unix::fs::symlink(&a, &link).unwrap();
    assert_eq!(
        survey.lookup(&FileId::of(&link)).location,
        Some(tab("main", "t1"))
    );
    // Free is not claimed when something did not answer.
    assert!(survey.held_by(&FileId::of(&c), &tab("main", "t9")).is_err());
    drop(release);
}

#[test]
fn a_places_own_unanswered_file_does_not_make_the_answer_unknown() {
    let t = tempfile::tempdir().unwrap();
    let (a, b, c) = (
        file(t.path(), "a.txt"),
        file(t.path(), "b.txt"),
        file(t.path(), "c.txt"),
    );
    let reg = OpenRegistry::new();
    register(&reg, &a, tab("main", "t1"));
    register(&reg, &b, tab("main", "t2"));
    let (stat, release, _) = blocking_stat(&[&a, &b]);
    let survey = reg.survey(&c, &stat, Duration::from_millis(150));
    let own = tab("main", "t1");
    // Seen from t1, a.txt is its own and need not answer; b.txt is another document's and must.
    assert_eq!(survey.held_by(&FileId::of(&c), &own), Err(vec![b.clone()]));
    // The lookup that is not asked from a place still lists both.
    let mut seen = survey.lookup(&FileId::of(&c)).unanswered;
    seen.sort();
    assert_eq!(seen, vec![a.clone(), b.clone()]);
    drop(release);
    // With only its own file silent, the target is free. (A registry of its own: looks in
    // progress are shared by path within one.)
    let reg = OpenRegistry::new();
    register(&reg, &a, tab("main", "t1"));
    register(&reg, &b, tab("main", "t2"));
    let (stat, release, _) = blocking_stat(&[&a]);
    let alone = reg.survey(&c, &stat, Duration::from_millis(150));
    assert_eq!(alone.held_by(&FileId::of(&c), &own), Ok(Held::Free));
    // A name that is the unanswered file's text is still the place's own file.
    assert_eq!(alone.held_by(&FileId::of(&a), &own), Ok(Held::Own));
    drop(release);
}

#[test]
fn a_look_that_never_returned_is_not_started_again_and_is_not_waited_for_again() {
    let t = tempfile::tempdir().unwrap();
    let (a, c) = (file(t.path(), "a.txt"), file(t.path(), "c.txt"));
    let reg = OpenRegistry::new();
    register(&reg, &a, tab("main", "t1"));
    let (stat, release, calls) = blocking_stat(&[&a]);
    // The first survey waits the whole bound; later ones must not wait for it again, which
    // would take the bound each. Half the bound is the line between them, far from both a
    // survey that returns at once and one that waits, so a loaded machine does not cross it.
    let bound = Duration::from_secs(2);
    let first = reg.survey(&c, &stat, bound);
    assert_eq!(first.lookup(&FileId::of(&c)).unanswered, vec![a.clone()]);
    // Later surveys find the look still going: no second thread, and no wait for it once it has
    // run for the bound.
    for _ in 0..3 {
        let again = std::time::Instant::now();
        let s = reg.survey(&c, &stat, bound);
        assert_eq!(s.lookup(&FileId::of(&c)).unanswered, vec![a.clone()]);
        assert!(
            again.elapsed() < bound / 2,
            "a look that ran its bound is not waited for"
        );
    }
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    // Once the stat returns the path answers again, with a new look.
    drop(release);
    let end = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let s = reg.survey(&c, &stat, Duration::from_millis(500));
        if s.lookup(&FileId::of(&c)).unanswered.is_empty() {
            break;
        }
        assert!(std::time::Instant::now() < end, "the look never finished");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn a_stat_that_panics_leaves_no_look_behind_and_its_path_can_be_looked_at_again() {
    let t = tempfile::tempdir().unwrap();
    let (a, c) = (file(t.path(), "a.txt"), file(t.path(), "c.txt"));
    let reg = OpenRegistry::new();
    register(&reg, &a, tab("main", "t1"));
    let panicking: Stat = {
        let a = a.clone();
        Arc::new(move |p: &Path| {
            assert_ne!(p, a, "this stat cannot look at a.txt");
            FileId::of(p)
        })
    };
    // The panic is an answer of no answer, at once: nothing waits for the bound.
    let started = std::time::Instant::now();
    let survey = reg.survey(&c, &panicking, Duration::from_secs(30));
    assert!(
        started.elapsed() < Duration::from_secs(15),
        "waited for the bound"
    );
    assert_eq!(survey.lookup(&FileId::of(&c)).unanswered, vec![a.clone()]);
    // The look is gone from the registry: the same path answers to the next survey.
    let later = (0..200).find_map(|_| {
        let s = reg.survey(&c, &disk(), BOUND);
        if s.lookup(&FileId::of(&c)).unanswered.is_empty() {
            Some(s)
        } else {
            std::thread::sleep(Duration::from_millis(10));
            None
        }
    });
    assert!(
        later.is_some(),
        "the path stayed unanswered after its stat panicked"
    );
}

#[test]
fn the_asked_path_is_looked_at_like_the_registered_ones_shared_and_bounded() {
    let t = tempfile::tempdir().unwrap();
    let (a, c) = (file(t.path(), "a.txt"), file(t.path(), "c.txt"));
    let reg = OpenRegistry::new();
    register(&reg, &a, tab("main", "t1"));
    let (stat, release, calls) = blocking_stat(&[&c]);
    let bound = Duration::from_millis(150);
    let own = tab("main", "t9");
    // The asked path does not answer: the survey says so, naming it, and does not wait longer.
    let survey = reg.survey(&c, &stat, bound);
    let found = survey.lookup_asked();
    assert_eq!(found.location, None);
    assert!(found.unanswered.contains(&c), "{:?}", found.unanswered);
    assert!(survey.held_by_asked(&own).is_err());
    // A second survey finds that look still going and starts no second one.
    let again = reg.survey(&c, &stat, bound);
    assert!(again.held_by_asked(&own).is_err());
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    // Once it answers the asked path is free, and a path registered by its text is never looked at.
    drop(release);
    let free = (0..300).find_map(|_| {
        let s = reg.survey(&c, &stat, BOUND);
        if s.held_by_asked(&own) == Ok(Held::Free) {
            Some(())
        } else {
            std::thread::sleep(Duration::from_millis(10));
            None
        }
    });
    assert!(free.is_some(), "the asked path never answered");
    let registered = reg.survey(&a, &stat, bound);
    assert_eq!(registered.held_by_asked(&tab("main", "t1")), Ok(Held::Own));
}

#[test]
fn a_survey_of_a_registered_path_looks_at_nothing() {
    let t = tempfile::tempdir().unwrap();
    let (a, b) = (file(t.path(), "a.txt"), file(t.path(), "b.txt"));
    let reg = OpenRegistry::new();
    register(&reg, &a, tab("main", "t1"));
    register(&reg, &b, tab("main", "t2"));
    let (stat, release, calls) = blocking_stat(&[&b]);
    let survey = reg.survey(&a, &stat, Duration::from_millis(200));
    assert_eq!(
        survey.lookup(&FileId::default()).location,
        Some(tab("main", "t1"))
    );
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    drop(release);
}

#[test]
fn the_registry_never_looks_at_the_disk_with_its_lock_held() {
    // A stat that asks the registry something: it would deadlock if the lock were held.
    let reg = Arc::new(OpenRegistry::new());
    let t = tempfile::tempdir().unwrap();
    let (a, c) = (file(t.path(), "a.txt"), file(t.path(), "c.txt"));
    register(&reg, &a, tab("main", "t1"));
    let inner = Arc::clone(&reg);
    let stat: Stat = Arc::new(move |p: &Path| {
        let _ = inner.generation();
        inner.insert(Path::new("/during"), tab("main", "x"));
        FileId::of(p)
    });
    let survey = reg.survey(&c, &stat, BOUND);
    assert!(survey.generation < reg.generation());
}

// ---- Save As holds and the window's document ----

#[test]
fn the_document_of_a_window_is_not_a_save_as_target_or_a_hold() {
    let reg = OpenRegistry::new();
    let win = Location::Window {
        label: "doc-1".to_owned(),
    };
    reg.reserve(Path::new("/target"), win.clone());
    assert_eq!(reg.path_of_window("doc-1"), None);
    reg.insert(Path::new("/doc"), win.clone());
    reg.insert(
        Path::new("/routed"),
        Location::Opening {
            window: "doc-1".to_owned(),
        },
    );
    assert_eq!(reg.path_of_window("doc-1"), Some(PathBuf::from("/doc")));
    // The place's own registration of the target takes the hold over; the old path goes.
    reg.insert(Path::new("/target"), win.clone());
    reg.remove(Path::new("/doc"));
    assert_eq!(reg.path_of_window("doc-1"), Some(PathBuf::from("/target")));
}

#[test]
fn a_tab_is_forgotten_with_everything_held_at_it_and_nothing_else() {
    let reg = OpenRegistry::new();
    reg.insert(Path::new("/a"), tab("main", "t1"));
    reg.reserve(Path::new("/b"), tab("main", "t1"));
    reg.insert(Path::new("/c"), tab("main", "t2"));
    reg.insert(Path::new("/d"), tab("editor-1", "t1"));
    reg.insert(
        Path::new("/e"),
        Location::Opening {
            window: "main".to_owned(),
        },
    );
    reg.remove_tab("main", "t1");
    let at = |p: &str| get(&reg, Path::new(p), &none());
    assert_eq!(at("/a"), None);
    assert_eq!(at("/b"), None);
    assert_eq!(at("/c"), Some(tab("main", "t2")));
    assert_eq!(at("/d"), Some(tab("editor-1", "t1")));
    assert!(at("/e").is_some());
}

// ---- the resolver: missing names, dangling links, unreadable folders ----

#[test]
fn a_missing_file_in_a_folder_reached_through_a_link_is_found_by_its_resolved_folder() {
    let t = tempfile::tempdir().unwrap();
    let real = t.path().join("real");
    fs::create_dir(&real).unwrap();
    let alias = t.path().join("alias");
    std::os::unix::fs::symlink(&real, &alias).unwrap();
    let canonical_dir = real.canonicalize().unwrap();
    // Neither name exists: the folder is resolved through the link, the name kept.
    let through = FileId::of(&alias.join("gone.txt"));
    assert_eq!(through.canonical, Some(canonical_dir.join("gone.txt")));
    assert_eq!(through.ident, None);
    let direct = FileId::of(&real.join("gone.txt"));
    assert_eq!(through.canonical, direct.canonical);
    // So a document deleted on disk is found by the other route to its folder.
    let reg = OpenRegistry::new();
    let doc = canonical_dir.join("gone.txt");
    register(&reg, &doc, tab("main", "t1"));
    assert_eq!(
        get(&reg, &alias.join("gone.txt"), &through),
        Some(tab("main", "t1"))
    );
}

#[test]
fn a_relative_dangling_link_is_followed_from_the_folder_that_holds_it() {
    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("d");
    fs::create_dir(&dir).unwrap();
    let link = dir.join("link.txt");
    std::os::unix::fs::symlink("gone.txt", &link).unwrap();
    let want = dir.canonicalize().unwrap().join("gone.txt");
    assert_eq!(FileId::of(&link).canonical, Some(want.clone()));
    assert_eq!(FileId::of(&link).ident, None);
    // Up and over: ../d/gone.txt from a sibling folder.
    let other = t.path().join("e");
    fs::create_dir(&other).unwrap();
    let via = other.join("via.txt");
    std::os::unix::fs::symlink("../d/gone.txt", &via).unwrap();
    assert_eq!(FileId::of(&via).canonical, Some(want));
}

#[test]
fn a_chain_of_dangling_links_is_followed_to_the_last_name() {
    let t = tempfile::tempdir().unwrap();
    let base = t.path().canonicalize().unwrap();
    let (first, second) = (base.join("first"), base.join("second"));
    std::os::unix::fs::symlink(&second, &first).unwrap();
    std::os::unix::fs::symlink(base.join("last.txt"), &second).unwrap();
    assert_eq!(FileId::of(&first).canonical, Some(base.join("last.txt")));
    // A chain longer than the kernel allows is given up, not followed for ever.
    let mut prev = base.join("end");
    for n in 0..45 {
        let l = base.join(format!("l{n}"));
        std::os::unix::fs::symlink(&prev, &l).unwrap();
        prev = l;
    }
    assert_eq!(FileId::of(&prev).canonical, None);
}

#[test]
fn a_path_under_a_folder_that_cannot_be_searched_is_resolved_through_the_nearest_readable_one() {
    use std::os::unix::fs::PermissionsExt;
    let t = tempfile::tempdir().unwrap();
    let base = t.path().canonicalize().unwrap();
    let locked = base.join("locked");
    fs::create_dir(&locked).unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    // Root searches anything; the case is the user's.
    let searchable = fs::metadata(locked.join("x")).err().map(|e| e.kind())
        != Some(std::io::ErrorKind::PermissionDenied);
    if !searchable {
        let id = FileId::of(&locked.join("x.txt"));
        // Not guessed at beyond the folder it can name; never a panic, never a match by luck.
        assert_eq!(id.ident, None);
        assert_eq!(id.canonical, Some(locked.join("x.txt")));
        let reg = OpenRegistry::new();
        register(&reg, &base.join("other.txt"), tab("main", "t1"));
        assert_eq!(get(&reg, &locked.join("x.txt"), &id), None);
    }
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
}

// ---- letting go is announced ----

#[test]
fn every_way_of_letting_go_is_announced_once_and_a_no_op_is_not() {
    use std::sync::atomic::Ordering::SeqCst;
    let reg = Arc::new(OpenRegistry::new());
    let n = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (count, probe) = (Arc::clone(&n), Arc::clone(&reg));
    reg.on_release(Arc::new(move || {
        // Announced with no lock of the registry held: asking it does not wait for ever.
        let _ = probe.generation();
        count.fetch_add(1, SeqCst);
    }));
    let (a, b, c) = (Path::new("/a"), Path::new("/b"), Path::new("/c"));
    reg.insert(a, tab("main", "t1"));
    reg.reserve(b, tab("main", "t1"));
    reg.insert(c, tab("editor-1", "t2"));
    assert_eq!(n.load(SeqCst), 0, "holding is not letting go");
    // Not the place that holds it: nothing was let go.
    reg.remove_if(a, &tab("main", "other"));
    reg.remove(Path::new("/nothing"));
    reg.remove_tab("main", "nobody");
    reg.remove_window("window-9");
    assert_eq!(n.load(SeqCst), 0, "a no-op is not announced");
    reg.remove_if(a, &tab("main", "t1"));
    assert_eq!(n.load(SeqCst), 1);
    reg.remove_tab("main", "t1");
    assert_eq!(n.load(SeqCst), 2);
    reg.remove(c);
    assert_eq!(n.load(SeqCst), 3);
    reg.insert(a, tab("editor-2", "t3"));
    reg.remove_window("editor-2");
    assert_eq!(n.load(SeqCst), 4);
}

// ---- a rename or a move of an open document ----

/// Where the registry holds `path`, by its name alone.
fn at(reg: &OpenRegistry, path: &str) -> Option<Location> {
    get(reg, Path::new(path), &FileId::default())
}

fn moved(from: &str, to: &str, location: Location) -> Moved {
    Moved {
        from: PathBuf::from(from),
        to: PathBuf::from(to),
        location,
    }
}

#[test]
fn a_renamed_file_is_registered_under_its_new_name_at_the_same_place() {
    let reg = OpenRegistry::new();
    reg.insert(Path::new("/w/a.txt"), tab("main", "t1"));
    let out = reg.retarget(Path::new("/w/a.txt"), Path::new("/w/b.txt"));
    assert_eq!(
        out.moved,
        vec![moved("/w/a.txt", "/w/b.txt", tab("main", "t1"))]
    );
    assert!(out.kept.is_empty());
    assert_eq!(at(&reg, "/w/b.txt"), Some(tab("main", "t1")));
    assert_eq!(at(&reg, "/w/a.txt"), None);
}

#[test]
fn a_renamed_folder_moves_every_document_under_it_and_no_sibling_with_the_same_start() {
    let reg = OpenRegistry::new();
    reg.insert(Path::new("/w/dir/a.txt"), tab("main", "t1"));
    reg.insert(Path::new("/w/dir/sub/b.txt"), tab("editor-1", "t2"));
    let win = Location::Window {
        label: "doc-1".to_owned(),
    };
    reg.insert(Path::new("/w/dir/c.txt"), win.clone());
    reg.insert(Path::new("/w/dir2/d.txt"), tab("main", "t3"));
    let out = reg.retarget(Path::new("/w/dir"), Path::new("/w/other"));
    let mut got = out.moved;
    got.sort_by(|x, y| x.from.cmp(&y.from));
    assert_eq!(
        got,
        vec![
            moved("/w/dir/a.txt", "/w/other/a.txt", tab("main", "t1")),
            moved("/w/dir/c.txt", "/w/other/c.txt", win),
            moved(
                "/w/dir/sub/b.txt",
                "/w/other/sub/b.txt",
                tab("editor-1", "t2")
            ),
        ]
    );
    assert_eq!(at(&reg, "/w/other/sub/b.txt"), Some(tab("editor-1", "t2")));
    assert_eq!(at(&reg, "/w/dir/a.txt"), None);
    assert_eq!(at(&reg, "/w/dir2/d.txt"), Some(tab("main", "t3")));
}

#[test]
fn a_move_onto_an_open_document_leaves_both_registered_and_names_the_one_not_moved() {
    let reg = OpenRegistry::new();
    reg.insert(Path::new("/w/a.txt"), tab("main", "t1"));
    reg.insert(Path::new("/x/a.txt"), tab("main", "t2"));
    let out = reg.retarget(Path::new("/w/a.txt"), Path::new("/x/a.txt"));
    assert!(out.moved.is_empty());
    assert_eq!(out.kept, vec![PathBuf::from("/w/a.txt")]);
    assert_eq!(at(&reg, "/w/a.txt"), Some(tab("main", "t1")));
    assert_eq!(at(&reg, "/x/a.txt"), Some(tab("main", "t2")));
}

#[test]
fn a_folder_move_with_one_collision_moves_the_rest_and_names_the_one_kept() {
    let reg = OpenRegistry::new();
    reg.insert(Path::new("/w/dir/a.txt"), tab("main", "t1"));
    reg.insert(Path::new("/w/dir/b.txt"), tab("main", "t2"));
    reg.insert(Path::new("/x/dir/b.txt"), tab("main", "t3"));
    let out = reg.retarget(Path::new("/w/dir"), Path::new("/x/dir"));
    assert_eq!(
        out.moved,
        vec![moved("/w/dir/a.txt", "/x/dir/a.txt", tab("main", "t1"))]
    );
    assert_eq!(out.kept, vec![PathBuf::from("/w/dir/b.txt")]);
    assert_eq!(at(&reg, "/w/dir/b.txt"), Some(tab("main", "t2")));
    assert_eq!(at(&reg, "/x/dir/b.txt"), Some(tab("main", "t3")));
}

#[test]
fn a_save_as_hold_and_a_routed_path_are_not_retargeted() {
    let reg = OpenRegistry::new();
    reg.reserve(Path::new("/w/held.txt"), tab("main", "t1"));
    reg.insert(
        Path::new("/w/routed.txt"),
        Location::Opening {
            window: "main".to_owned(),
        },
    );
    let out = reg.retarget(Path::new("/w"), Path::new("/v"));
    assert!(out.moved.is_empty());
    assert!(out.kept.is_empty());
    assert_eq!(at(&reg, "/w/held.txt"), Some(tab("main", "t1")));
    assert!(at(&reg, "/w/routed.txt").is_some());
}

#[test]
fn a_retarget_counts_as_a_change_and_lets_the_old_path_go_only_when_something_moved() {
    use std::sync::atomic::Ordering::SeqCst;
    let reg = Arc::new(OpenRegistry::new());
    let n = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let count = Arc::clone(&n);
    reg.on_release(Arc::new(move || {
        count.fetch_add(1, SeqCst);
    }));
    reg.insert(Path::new("/w/a.txt"), tab("main", "t1"));
    let before = reg.generation();
    reg.retarget(Path::new("/nothing"), Path::new("/else"));
    assert_eq!(reg.generation(), before, "nothing moved, nothing changed");
    assert_eq!(n.load(SeqCst), 0);
    reg.retarget(Path::new("/w/a.txt"), Path::new("/w/b.txt"));
    assert_ne!(reg.generation(), before);
    assert_eq!(n.load(SeqCst), 1, "the old name is let go");
}
