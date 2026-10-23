// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The `org.freedesktop.FileManager1` service (freedesktop.org wiki,
//! Specifications/file-manager-interface) and the default file manager
//! status. The bus tests are skipped, with the reason printed, when there
//! is no session bus.

mod common;

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::time::Duration;

use common::{env, wp};
use kern_lib::cli::ArgError;
use kern_lib::default_fm::{self, DEFAULT_FM_DESKTOP_ID};
use kern_lib::filemanager1::{
    group_by_parent, run, serve, uris_to_paths, Call, Request, INTERFACE, OBJECT_PATH,
};
use kern_lib::instance::Launches;
use kern_lib::windows::{EVENT_OPEN, EVENT_OPEN_ERROR, EVENT_PROPERTIES, EVENT_SELECT};
use serde_json::json;

fn uris(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| (*s).to_owned()).collect()
}

fn request(call: Call, paths: Vec<PathBuf>) -> Request {
    Request {
        call,
        paths,
        refused: Vec::new(),
        token: "token-1".to_owned(),
    }
}

#[test]
fn uris_to_paths_decoded() {
    // RFC 3986 section 2.1 decodes %XX; RFC 8089 allows an empty host or
    // localhost.
    let b = uris_to_paths(&uris(&[
        "file:///home/a/b%20c.txt",
        "file://localhost/x/%C3%A9",
        "FILE:///Up/Case",
    ]));
    assert!(b.refused.is_empty());
    assert_eq!(
        b.paths,
        vec![
            PathBuf::from("/home/a/b c.txt"),
            PathBuf::from("/x/\u{e9}"),
            PathBuf::from("/Up/Case"),
        ]
    );
}

#[test]
fn remote_host_and_malformed_uris_are_refused_and_listed() {
    let input = uris(&[
        "file://example.com/x",
        "http://example.com/y",
        "file:///a%2Fb",
        "file:///a/%00",
        "",
        "/plain/path",
        "file:/one/slash",
        "file:///good",
    ]);
    let b = uris_to_paths(&input);
    assert_eq!(b.paths, vec![PathBuf::from("/good")]);
    let refused: Vec<OsString> = b.refused.iter().map(|e: &ArgError| e.arg.clone()).collect();
    let want: Vec<OsString> = input[..7].iter().map(OsString::from).collect();
    assert_eq!(refused, want);
    assert!(b.refused.iter().all(|e| !e.reason.is_empty()));
}

#[test]
fn non_utf8_path_round_trips() {
    let b = uris_to_paths(&uris(&["file:///d/caf%E9.txt"]));
    assert_eq!(
        b.paths,
        vec![PathBuf::from(OsString::from_vec(
            b"/d/caf\xe9.txt".to_vec()
        ))]
    );
}

#[test]
fn show_items_groups_by_parent() {
    let p = |s: &str| PathBuf::from(s);
    let g = group_by_parent(&[p("/a/x"), p("/b/y"), p("/a/z"), p("/a/x"), p("/")]);
    // First appearance orders the groups; a repeated item is listed once;
    // the root has no parent, so it is shown itself with nothing selected.
    assert_eq!(g.len(), 3);
    assert_eq!(g[0].folder, p("/a"));
    assert_eq!(g[0].items, vec![p("/a/x"), p("/a/z")]);
    assert_eq!(g[1].folder, p("/b"));
    assert_eq!(g[1].items, vec![p("/b/y")]);
    assert_eq!(g[2].folder, p("/"));
    assert!(g[2].items.is_empty());
}

fn run_block(e: &common::Env, req: Request) -> Vec<kernkraft_tauri::WireError> {
    tauri::async_runtime::block_on(run(&e.handle, req))
}

#[test]
fn show_items_in_two_folders_gives_two_tabs_each_with_its_selection() {
    let e = env(Duration::from_secs(5));
    let (a, b) = (e.files.join("a"), e.files.join("b"));
    fs::create_dir(&a).unwrap();
    fs::create_dir(&b).unwrap();
    let (x, y, z) = (a.join("x"), b.join("y"), a.join("z"));
    for f in [&x, &y, &z] {
        fs::write(f, "t").unwrap();
    }
    let errors = run_block(
        &e,
        request(Call::ShowItems, vec![x.clone(), y.clone(), z.clone()]),
    );
    assert!(errors.is_empty(), "{errors:?}");
    let q = e.take("main");
    let kinds: Vec<_> = q.iter().map(|m| m["event"].clone()).collect();
    assert_eq!(
        kinds,
        vec![
            json!(EVENT_OPEN),
            json!(EVENT_SELECT),
            json!(EVENT_OPEN),
            json!(EVENT_SELECT)
        ]
    );
    assert_eq!(
        q[0]["payload"],
        json!({"kind": "folder_tab", "path": wp(&a)})
    );
    assert_eq!(
        q[1]["payload"],
        json!({"tab": wp(&a), "paths": [wp(&x), wp(&z)]})
    );
    assert_eq!(
        q[2]["payload"],
        json!({"kind": "folder_tab", "path": wp(&b)})
    );
    assert_eq!(q[3]["payload"], json!({"tab": wp(&b), "paths": [wp(&y)]}));
}

#[test]
fn show_items_keeps_non_utf8_names_and_reports_missing_items() {
    let e = env(Duration::from_secs(5));
    let odd = e.files.join(OsString::from_vec(b"caf\xe9.txt".to_vec()));
    fs::write(&odd, "t").unwrap();
    let gone = e.files.join("gone.txt");
    let errors = run_block(
        &e,
        request(Call::ShowItems, vec![odd.clone(), gone.clone()]),
    );
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].kind, "NotFound");
    let q = e.take("main");
    // The folder opens and only the item that exists is selected.
    let sel = q
        .iter()
        .find(|m| m["event"] == json!(EVENT_SELECT))
        .unwrap();
    assert_eq!(
        sel["payload"],
        json!({"tab": wp(&e.files), "paths": [wp(&odd)]})
    );
}

#[test]
fn show_folders_opens_folders_and_reports_what_is_not_one() {
    let e = env(Duration::from_secs(5));
    let f = e.text("f.txt");
    let mut req = request(Call::ShowFolders, vec![e.files.clone(), f.clone()]);
    req.refused = uris_to_paths(&uris(&["file://example.com/x"])).refused;
    let errors = run_block(&e, req);
    let kinds: Vec<_> = errors.iter().map(|w| w.kind.as_str()).collect();
    assert_eq!(kinds, vec!["BadArgument", "NotAFolder"]);
    let q = e.take("main");
    assert_eq!(q.len(), 1);
    assert_eq!(
        q[0]["payload"],
        json!({"kind": "folder_tab", "path": wp(&e.files)})
    );
    // Nothing became a document.
    assert!(!e.exists("doc-1"));
}

#[test]
fn show_item_properties_tells_main() {
    let e = env(Duration::from_secs(5));
    let f = e.text("f.txt");
    // An open main window is not given another tab.
    e.open(&[&e.files], "outside", "default");
    let errors = run_block(&e, request(Call::ShowItemProperties, vec![f.clone()]));
    assert!(errors.is_empty());
    // The one folder tab of the first open, then the properties.
    let q = e.take("main");
    assert_eq!(q.len(), 2);
    assert_eq!(q[1]["event"], json!(EVENT_PROPERTIES));
    assert_eq!(q[1]["payload"], json!({"paths": [wp(&f)]}));
}

#[test]
fn errors_of_a_call_are_shown_through_the_open_error_event() {
    let e = env(Duration::from_secs(5));
    let req = request(Call::ShowFolders, vec![e.files.join("missing")]);
    tauri::async_runtime::block_on(kern_lib::filemanager1::handle(&e.handle, req));
    let q = e.take("main");
    assert!(q.iter().any(|m| m["event"] == json!(EVENT_OPEN_ERROR)));
}

fn two_buses() -> Option<(zbus::blocking::Connection, zbus::blocking::Connection)> {
    match (kernkraft_bus::session(), kernkraft_bus::session()) {
        (Ok(a), Ok(b)) => Some((a, b)),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("skipped: no session bus: {e}");
            None
        }
    }
}

fn call(
    conn: &zbus::blocking::Connection,
    name: &str,
    method: &str,
    uris: &[&str],
) -> zbus::Result<()> {
    conn.call_method(
        Some(name),
        OBJECT_PATH,
        Some(INTERFACE),
        method,
        &(uris.to_vec(), "startup-1"),
    )
    .map(|_| ())
}

#[test]
fn show_folders_over_the_bus_reaches_the_handler() {
    let Some((owner, caller)) = two_buses() else {
        return;
    };
    let name = format!("org.freedesktop.FileManager1Test{}", std::process::id());
    let pending = Launches::default();
    let svc = serve(&owner, &name, pending.clone()).unwrap();
    assert!(svc.status.get().owned);

    call(
        &caller,
        &name,
        "ShowFolders",
        &["file:///tmp", "file://example.com/x"],
    )
    .unwrap();
    // Counted before the caller had its answer.
    assert_eq!(pending.pending(), 1);
    let req = svc.requests.recv_timeout(Duration::from_secs(30)).unwrap();
    assert_eq!(req.call, Call::ShowFolders);
    assert_eq!(req.paths, vec![PathBuf::from("/tmp")]);
    assert_eq!(req.refused.len(), 1);
    assert_eq!(req.token, "startup-1");

    call(&caller, &name, "ShowItems", &["file:///a/b"]).unwrap();
    assert_eq!(
        svc.requests
            .recv_timeout(Duration::from_secs(30))
            .unwrap()
            .call,
        Call::ShowItems
    );
    call(&caller, &name, "ShowItemProperties", &["file:///a/b"]).unwrap();
    assert_eq!(
        svc.requests
            .recv_timeout(Duration::from_secs(30))
            .unwrap()
            .call,
        Call::ShowItemProperties
    );

    // Nothing usable: an error naming the refused URI, nothing counted.
    let before = pending.pending();
    let err = call(&caller, &name, "ShowFolders", &["http://x/y"]).unwrap_err();
    assert!(err.to_string().contains("http://x/y"), "{err}");
    assert_eq!(pending.pending(), before);
    assert!(svc.requests.try_recv().is_err());

    // Once the owner agreed to exit, a call is refused.
    while pending.finish() > 0 {}
    assert!(pending.exit_requested());
    assert!(call(&caller, &name, "ShowFolders", &["file:///tmp"]).is_err());
}

#[test]
fn a_taken_name_is_reported_not_stolen() {
    let Some((first, second)) = two_buses() else {
        return;
    };
    let name = format!("org.freedesktop.FileManager1Taken{}", std::process::id());
    let _first = serve(&first, &name, Launches::default()).unwrap();
    let svc = serve(&second, &name, Launches::default()).unwrap();
    let st = svc.status.get();
    assert!(!st.owned);
    assert_eq!(
        st.owner.as_deref(),
        Some(first.unique_name().unwrap().as_str())
    );
    // The loser serves nothing: its object was removed.
    let third = kernkraft_bus::session().unwrap();
    assert!(call(
        &third,
        second.unique_name().unwrap().as_str(),
        "ShowFolders",
        &["file:///tmp"]
    )
    .is_err());
}

#[test]
fn a_file_manager_asking_to_replace_kern_is_refused() {
    use zbus::fdo::{RequestNameFlags, RequestNameReply};
    let Some((ours, other)) = two_buses() else {
        return;
    };
    let name = format!("org.freedesktop.FileManager1Held{}", std::process::id());
    let svc = serve(&ours, &name, Launches::default()).unwrap();
    assert!(svc.status.get().owned);
    let flags = RequestNameFlags::ReplaceExisting | RequestNameFlags::DoNotQueue;
    let reply = other.request_name_with_flags(name.as_str(), flags);
    assert!(
        matches!(reply, Ok(RequestNameReply::Exists)) || reply.is_err(),
        "{reply:?}"
    );
    let st = svc.status.get();
    assert!(st.owned);
    assert_eq!(
        st.owner.as_deref(),
        Some(ours.unique_name().unwrap().as_str())
    );
    // Still served: a call reaches the handler.
    call(&other, &name, "ShowFolders", &["file:///tmp"]).unwrap();
    assert!(svc.requests.recv_timeout(Duration::from_secs(30)).is_ok());
}

#[test]
fn group_by_parent_is_linear_enough_for_many_items() {
    let paths: Vec<PathBuf> = (0..50_000)
        .map(|i| PathBuf::from(format!("/d/{i}")))
        .collect();
    let start = std::time::Instant::now();
    let g = group_by_parent(&paths);
    assert_eq!(g.len(), 1);
    assert_eq!(g[0].items.len(), 50_000);
    // Quadratic grouping of 50 000 items takes minutes; this takes
    // milliseconds, so a generous bound separates them.
    assert!(start.elapsed() < Duration::from_secs(5));
}

#[test]
fn dot_segments_in_a_uri_are_removed() {
    let b = uris_to_paths(&uris(&[
        "file:///a/../b",
        "file:///a/./b/",
        "file:///../../x",
        "file:///a/b/..",
    ]));
    assert_eq!(
        b.paths,
        vec![
            PathBuf::from("/b"),
            PathBuf::from("/a/b"),
            PathBuf::from("/x"),
            PathBuf::from("/a"),
        ]
    );
}

#[test]
fn properties_with_no_main_window_open_the_items_folder_first() {
    let e = env(Duration::from_secs(5));
    let f = e.text("f.txt");
    assert!(!e.exists("main"));
    let errors = run_block(&e, request(Call::ShowItemProperties, vec![f.clone()]));
    assert!(errors.is_empty());
    let q = e.take("main");
    assert_eq!(q.len(), 2);
    assert_eq!(
        q[0]["payload"],
        json!({"kind": "folder_tab", "path": wp(&e.files)})
    );
    assert_eq!(q[1]["event"], json!(EVENT_PROPERTIES));
}

// ---- default file manager ----

struct Home {
    _tmp: tempfile::TempDir,
    base: kernkraft_fs::BaseDirs,
    data: PathBuf,
    config: PathBuf,
}

fn home() -> Home {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let (data, config) = (root.join("data"), root.join("config"));
    fs::create_dir_all(data.join("applications")).unwrap();
    fs::create_dir_all(&config).unwrap();
    let env = {
        let (root, data, config) = (root.clone(), data.clone(), config.clone());
        move |k: &str| -> Option<OsString> {
            match k {
                "HOME" => Some(root.clone().into_os_string()),
                "XDG_DATA_HOME" => Some(data.clone().into_os_string()),
                "XDG_CONFIG_HOME" => Some(config.clone().into_os_string()),
                "XDG_DATA_DIRS" => Some(root.join("none").into_os_string()),
                "XDG_CONFIG_DIRS" => Some(root.join("none").into_os_string()),
                _ => None,
            }
        }
    };
    let base = kernkraft_fs::base_dirs_from(&env).unwrap();
    Home {
        _tmp: tmp,
        base,
        data,
        config,
    }
}

fn install(h: &Home, id: &str) {
    fs::write(
        h.data.join("applications").join(id),
        format!("[Desktop Entry]\nType=Application\nName={id}\nExec=true %F\nMimeType=inode/directory;\n"),
    )
    .unwrap();
}

fn set_list(h: &Home, id: &str) {
    fs::write(
        h.config.join("mimeapps.list"),
        format!("[Default Applications]\ninode/directory={id}\n"),
    )
    .unwrap();
}

#[test]
fn default_fm_status_tells_who_is_default() {
    let h = home();
    let s = default_fm::status_in(&h.base).unwrap();
    assert!(!s.is_default);
    assert_eq!(s.current, None);

    install(&h, "other.desktop");
    set_list(&h, "other.desktop");
    let s = default_fm::status_in(&h.base).unwrap();
    assert!(!s.is_default);
    assert_eq!(s.current.as_deref(), Some("other.desktop"));

    install(&h, DEFAULT_FM_DESKTOP_ID);
    set_list(&h, DEFAULT_FM_DESKTOP_ID);
    let s = default_fm::status_in(&h.base).unwrap();
    assert!(s.is_default);
    assert_eq!(s.current.as_deref(), Some(DEFAULT_FM_DESKTOP_ID));
}

#[test]
fn make_default_sets_then_rereads_and_refuses_when_kern_is_not_installed() {
    let h = home();
    let set = |id: &str, mime: &str| {
        assert_eq!(mime, "inode/directory");
        set_list(&h, id);
        Ok(())
    };
    // Kern's desktop entry is not installed: nothing is run.
    let err = default_fm::make_default_in(&h.base, &set).unwrap_err();
    assert_eq!(err.kind, "UnknownApp");
    assert!(!h.config.join("mimeapps.list").exists());

    install(&h, DEFAULT_FM_DESKTOP_ID);
    let s = default_fm::make_default_in(&h.base, &set).unwrap();
    assert!(s.is_default);
}
