// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The settings, pins and recents store (parent spec section 6.3).

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use kern_lib::store::{move_aside, Store, ViewMode, RECENTS_CAP};
use kernkraft_tauri::WirePath;
use serde_json::{json, Map, Value};

struct Env {
    _tmp: tempfile::TempDir,
    config: PathBuf,
    state: PathBuf,
    files: PathBuf,
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let files = root.join("files");
    fs::create_dir(&files).unwrap();
    Env {
        config: root.join("config/kern"),
        state: root.join("state/kern"),
        files,
        _tmp: tmp,
    }
}

fn store(e: &Env) -> Store {
    Store::new(e.config.clone(), e.state.clone())
}

fn wp(p: &Path) -> WirePath {
    WirePath::from(p)
}

fn patch(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => panic!("patch must be an object"),
    }
}

fn read_json(p: &Path) -> Value {
    serde_json::from_slice(&fs::read(p).unwrap()).unwrap()
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn defaults_when_missing() {
    let e = env();
    let s = store(&e);
    let settings = s.settings_get().unwrap();
    assert!(settings.corrupt.is_none());
    assert_eq!(settings.value, Default::default());
    assert_eq!(settings.value.view_mode, ViewMode::List);
    assert!(s.pins_get().unwrap().value.entries.is_empty());
    assert!(s.recents_get().unwrap().value.entries.is_empty());
    // Reading creates nothing.
    assert!(!e.config.exists());
    assert!(!e.state.exists());
}

#[test]
fn atomic_write_round_trip() {
    let e = env();
    let s = store(&e);
    let root = e.files.join("scan");
    let out = s
        .settings_set(patch(json!({
            "terminal": "kitty",
            "word_wrap": true,
            "editor_zoom": 1.5,
            "view_mode": "grid",
            "scan_roots": [wp(&root)],
        })))
        .unwrap();
    assert!(out.changed);
    let again = store(&e).settings_get().unwrap().value;
    assert_eq!(again, out.value);
    assert_eq!(again.terminal.as_deref(), Some("kitty"));
    assert_eq!(again.view_mode, ViewMode::Grid);
    assert_eq!(again.scan_roots, vec![wp(&root)]);
    // The atomic writer leaves no temporary file behind.
    assert_eq!(names(&e.config), vec!["settings.json".to_owned()]);

    s.pin(&wp(&e.files)).unwrap();
    s.recent_touch(&wp(&e.files)).unwrap();
    assert_eq!(
        names(&e.state),
        vec!["pins.json".to_owned(), "recents.json".to_owned()]
    );
}

#[test]
fn settings_patch_rejects_unknown_and_bad_values() {
    let e = env();
    let s = store(&e);
    assert!(s.settings_set(patch(json!({"nope": 1}))).is_err());
    assert!(s
        .settings_set(patch(json!({"view_mode": "tiles"})))
        .is_err());
    let relative = s.settings_set(patch(
        json!({"scan_roots": [{"k": "Utf8", "v": "relative/dir"}]}),
    ));
    assert_eq!(relative.unwrap_err().kind, "NotAbsolute");
    // A refused patch writes nothing.
    assert!(!e.config.join("settings.json").exists());
    // A null clears the optional terminal.
    s.settings_set(patch(json!({"terminal": "foot"}))).unwrap();
    let cleared = s.settings_set(patch(json!({"terminal": null}))).unwrap();
    assert_eq!(cleared.value.terminal, None);
}

#[test]
fn unknown_fields_survive() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::create_dir_all(&e.state).unwrap();
    fs::write(
        e.config.join("settings.json"),
        r#"{"future_setting":{"a":[1,2]},"word_wrap":true}"#,
    )
    .unwrap();
    fs::write(
        e.state.join("pins.json"),
        r#"{"entries":[],"future_pins":"x"}"#,
    )
    .unwrap();
    fs::write(
        e.state.join("recents.json"),
        format!(
            r#"{{"entries":[{{"path":{},"opened_ms":5,"future_entry":7}}],"future_recents":true}}"#,
            serde_json::to_string(&wp(&e.files)).unwrap()
        ),
    )
    .unwrap();
    let s = store(&e);

    s.settings_set(patch(json!({"show_hidden": true}))).unwrap();
    let v = read_json(&e.config.join("settings.json"));
    assert_eq!(v["future_setting"], json!({"a": [1, 2]}));
    assert_eq!(v["word_wrap"], json!(true));
    assert_eq!(v["show_hidden"], json!(true));

    s.pin(&wp(&e.files)).unwrap();
    let v = read_json(&e.state.join("pins.json"));
    assert_eq!(v["future_pins"], json!("x"));
    assert_eq!(v["entries"].as_array().unwrap().len(), 1);

    // Touching the entry again keeps both the file's and the entry's extras.
    s.recent_touch_at(&wp(&e.files), 9).unwrap();
    let v = read_json(&e.state.join("recents.json"));
    assert_eq!(v["future_recents"], json!(true));
    assert_eq!(v["entries"][0]["future_entry"], json!(7));
    assert_eq!(v["entries"][0]["opened_ms"], json!(9));
}

#[test]
fn recents_capped_and_deduped() {
    let e = env();
    let s = store(&e);
    let paths: Vec<PathBuf> = (0..RECENTS_CAP + 5)
        .map(|i| e.files.join(format!("f{i}")))
        .collect();
    for (i, p) in paths.iter().enumerate() {
        s.recent_touch_at(&wp(p), i as u64).unwrap();
    }
    let r = s.recents_get().unwrap().value.entries;
    assert_eq!(r.len(), RECENTS_CAP);
    // Newest first; the five oldest dropped.
    assert_eq!(r[0].path, wp(&paths[RECENTS_CAP + 4]));
    assert_eq!(r[RECENTS_CAP - 1].path, wp(&paths[5]));

    // Touching an existing entry moves it to the top without a duplicate.
    s.recent_touch_at(&wp(&paths[10]), 1000).unwrap();
    let r = s.recents_get().unwrap().value.entries;
    assert_eq!(r.len(), RECENTS_CAP);
    assert_eq!(r[0].path, wp(&paths[10]));
    assert_eq!(r[0].opened_ms, 1000);
    assert_eq!(r.iter().filter(|x| x.path == wp(&paths[10])).count(), 1);
}

#[test]
fn pins_order_and_non_utf8() {
    let e = env();
    let s = store(&e);
    let odd = e
        .files
        .join(PathBuf::from(OsString::from_vec(vec![b'a', 0xff, b'b'])));
    let a = e.files.join("a");
    let b = e.files.join("b");
    for p in [&a, &odd, &b] {
        s.pin(&wp(p)).unwrap();
    }
    // A second pin of the same path changes nothing.
    assert!(!s.pin(&wp(&a)).unwrap().changed);
    assert_eq!(s.pins_get().unwrap().value.entries.len(), 3);
    assert!(matches!(wp(&odd), WirePath::Bytes(_)));

    // Reorder keeps every pinned path: one the request omits goes last, one
    // it names that is not pinned is ignored.
    let stranger = e.files.join("stranger");
    s.pins_reorder(&[wp(&b), wp(&stranger), wp(&a)]).unwrap();
    let got = store(&e).pins_get().unwrap().value.entries;
    assert_eq!(got, vec![wp(&b), wp(&a), wp(&odd)]);

    s.unpin(&wp(&odd)).unwrap();
    assert_eq!(s.pins_get().unwrap().value.entries, vec![wp(&b), wp(&a)]);
    assert!(!s.unpin(&wp(&odd)).unwrap().changed);
    assert_eq!(
        s.pin(&WirePath::Utf8("rel".into())).unwrap_err().kind,
        "NotAbsolute"
    );
}

#[test]
fn concurrent_pins_lose_nothing() {
    let e = env();
    let s = Arc::new(store(&e));
    let handles: Vec<_> = (0..16)
        .map(|i| {
            let s = Arc::clone(&s);
            let p = e.files.join(format!("p{i}"));
            std::thread::spawn(move || s.pin(&wp(&p)).unwrap())
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(store(&e).pins_get().unwrap().value.entries.len(), 16);
}

#[test]
fn prune_drops_vanished() {
    let e = env();
    let s = store(&e);
    let keep = e.files.join("keep");
    let gone = e.files.join("gone");
    fs::write(&keep, b"x").unwrap();
    fs::write(&gone, b"x").unwrap();
    // A dangling symlink is itself present (lstat), so it stays.
    let dangling = e.files.join("dangling");
    std::os::unix::fs::symlink(e.files.join("nowhere"), &dangling).unwrap();
    for p in [&keep, &gone, &dangling] {
        s.pin(&wp(p)).unwrap();
        s.recent_touch(&wp(p)).unwrap();
    }
    fs::remove_file(&gone).unwrap();

    let report = s.prune().unwrap();
    assert_eq!(report.pins_removed, vec![wp(&gone)]);
    assert_eq!(report.recents_removed, vec![wp(&gone)]);
    assert!(report.errors.is_empty());
    let pins = s.pins_get().unwrap().value.entries;
    assert!(pins.contains(&wp(&keep)) && pins.contains(&wp(&dangling)));
    assert!(!pins.contains(&wp(&gone)));
    let rec = s.recents_get().unwrap().value.entries;
    assert_eq!(rec.len(), 2);
}

#[test]
fn prune_keeps_offline_volume_entry() {
    let e = env();
    let s = store(&e);
    // A stand-in for /run/media/<user>: mount directories sit two levels
    // below the root (user, volume name); one is present, one is not.
    let media = e.files.join("media");
    let present = media.join("alice/STICK");
    fs::create_dir_all(&present).unwrap();
    let offline = media.join("alice/UNPLUGGED/doc.txt");
    let missing_on_mounted = present.join("deleted.txt");
    let elsewhere = e.files.join("home-gone.txt");
    for p in [&offline, &missing_on_mounted, &elsewhere] {
        s.pin(&wp(p)).unwrap();
    }
    let layouts = [(media.clone(), 2usize)];
    let report = s.prune_with(&layouts).unwrap();
    // Only entries whose volume is mounted (or that are not on a removable
    // volume) are dropped.
    assert_eq!(
        report.pins_removed,
        vec![wp(&missing_on_mounted), wp(&elsewhere)]
    );
    assert_eq!(s.pins_get().unwrap().value.entries, vec![wp(&offline)]);
}

#[test]
fn prune_reports_other_lstat_errors_and_keeps_entry() {
    let e = env();
    let s = store(&e);
    // A path through a regular file fails lstat with ENOTDIR, not NotFound.
    let file = e.files.join("plain");
    fs::write(&file, b"x").unwrap();
    let under = file.join("child");
    s.pin(&wp(&under)).unwrap();
    let report = s.prune().unwrap();
    assert!(report.pins_removed.is_empty());
    assert_eq!(report.errors.len(), 1);
    assert_eq!(report.errors[0].path, wp(&under));
    assert_eq!(s.pins_get().unwrap().value.entries, vec![wp(&under)]);
}

#[test]
fn corrupt_file_preserved_and_reported() {
    let e = env();
    fs::create_dir_all(&e.state).unwrap();
    let bad = b"{ not json";
    fs::write(e.state.join("pins.json"), bad).unwrap();
    let s = store(&e);
    let got = s.pins_get().unwrap();
    assert!(got.value.entries.is_empty());
    let report = got.corrupt.expect("reported");
    assert_eq!(report.file, "pins.json");
    let moved = report.moved_to.to_path_buf().unwrap();
    let name = moved.file_name().unwrap().to_str().unwrap();
    let secs = name.strip_prefix("pins.json.corrupt-").expect("name");
    assert!(secs.parse::<u64>().is_ok(), "unix seconds, got {secs}");
    assert_eq!(fs::read(&moved).unwrap(), bad);
    assert!(!e.state.join("pins.json").exists());
    // Reported once: the file is gone, so the next read is a plain default.
    assert!(s.pins_get().unwrap().corrupt.is_none());

    // A wrong-typed field is corruption too, for every file.
    fs::create_dir_all(&e.config).unwrap();
    fs::write(e.config.join("settings.json"), r#"{"word_wrap":"yes"}"#).unwrap();
    assert!(s.settings_get().unwrap().corrupt.is_some());
}

#[test]
fn corrupt_collision_never_overwrites() {
    let e = env();
    let target = e.files.join("recents.json");
    let mut moved = Vec::new();
    for i in 0..3 {
        let content = format!("broken {i}");
        fs::write(&target, &content).unwrap();
        moved.push((move_aside(&target, 1_700_000_000).unwrap(), content));
    }
    // The same second three times: the suffixes -1 and -2 keep every copy.
    let expect: Vec<PathBuf> = ["", "-1", "-2"]
        .iter()
        .map(|suffix| {
            e.files
                .join(format!("recents.json.corrupt-1700000000{suffix}"))
        })
        .collect();
    assert_eq!(
        moved.iter().map(|(p, _)| p.clone()).collect::<Vec<_>>(),
        expect
    );
    for (p, c) in &moved {
        assert_eq!(fs::read_to_string(p).unwrap(), *c);
    }
    assert!(!target.exists());

    // Through the store, an earlier copy from the same second survives.
    fs::create_dir_all(&e.state).unwrap();
    let s = store(&e);
    fs::write(e.state.join("recents.json"), "first").unwrap();
    let first = s.recents_get().unwrap().corrupt.unwrap().moved_to;
    fs::write(e.state.join("recents.json"), "second").unwrap();
    let second = s.recents_get().unwrap().corrupt.unwrap().moved_to;
    assert_ne!(first, second);
    assert_eq!(
        fs::read_to_string(first.to_path_buf().unwrap()).unwrap(),
        "first"
    );
    assert_eq!(
        fs::read_to_string(second.to_path_buf().unwrap()).unwrap(),
        "second"
    );
}
