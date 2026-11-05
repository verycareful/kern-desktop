// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The settings, pins and recents store.

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use kern_lib::store::{
    move_aside, volume_online, LayoutKind, NewTabDefault, SessionTab, SessionWindow, Store,
    ViewMode, DEFAULT_INTERFACE_SIZE, INTERFACE_SIZES, LEFT_WIDTH_DEFAULT, LEFT_WIDTH_MAX,
    LEFT_WIDTH_MIN, MAIN_LAYOUTS, RECENTS_CAP, RIGHT_WIDTH_MAX, RIGHT_WIDTH_MIN,
};
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
    assert!(settings.corrupt.is_empty());
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

    s.pin(&wp(&e.files), false).unwrap();
    s.recent_touch(&wp(&e.files), false).unwrap();
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
    let err = relative.unwrap_err();
    assert_eq!(err.kind, "InvalidArgument");
    assert!(err.message.contains("not absolute"), "{}", err.message);
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

    s.pin(&wp(&e.files), false).unwrap();
    let v = read_json(&e.state.join("pins.json"));
    assert_eq!(v["future_pins"], json!("x"));
    assert_eq!(v["entries"].as_array().unwrap().len(), 1);

    // Touching the entry again keeps both the file's and the entry's extras.
    s.recent_touch_at(&wp(&e.files), 9, false).unwrap();
    let v = read_json(&e.state.join("recents.json"));
    assert_eq!(v["future_recents"], json!(true));
    assert_eq!(v["entries"][0]["future_entry"], json!(7));
    assert_eq!(v["entries"][0]["opened_ms"], json!(9));
}

#[test]
fn a_stored_density_is_dropped_by_the_next_write_and_refused_in_a_patch() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::write(
        e.config.join("settings.json"),
        r#"{"density":"compact","word_wrap":true}"#,
    )
    .unwrap();
    let s = store(&e);
    let read = s.settings_get().unwrap();
    assert!(read.corrupt.is_empty());
    assert!(read.value.word_wrap);
    // Reading alone leaves the file as it is.
    assert_eq!(
        read_json(&e.config.join("settings.json"))["density"],
        json!("compact")
    );

    s.settings_set(patch(json!({"show_hidden": true}))).unwrap();
    let v = read_json(&e.config.join("settings.json"));
    assert!(v.get("density").is_none(), "{v}");
    assert_eq!(v["word_wrap"], json!(true));
    assert_eq!(v["show_hidden"], json!(true));

    let err = s
        .settings_set(patch(json!({"density": "cozy"})))
        .unwrap_err();
    assert_eq!(err.kind, "InvalidArgument");
}

#[test]
fn recents_capped_and_deduped() {
    let e = env();
    let s = store(&e);
    let paths: Vec<PathBuf> = (0..RECENTS_CAP + 5)
        .map(|i| e.files.join(format!("f{i}")))
        .collect();
    for (i, p) in paths.iter().enumerate() {
        s.recent_touch_at(&wp(p), i as u64, false).unwrap();
    }
    let r = s.recents_get().unwrap().value.entries;
    assert_eq!(r.len(), RECENTS_CAP);
    // Newest first; the five oldest dropped.
    assert_eq!(r[0].path, wp(&paths[RECENTS_CAP + 4]));
    assert_eq!(r[RECENTS_CAP - 1].path, wp(&paths[5]));

    // Touching an existing entry moves it to the top without a duplicate.
    s.recent_touch_at(&wp(&paths[10]), 1000, false).unwrap();
    let r = s.recents_get().unwrap().value.entries;
    assert_eq!(r.len(), RECENTS_CAP);
    assert_eq!(r[0].path, wp(&paths[10]));
    assert_eq!(r[0].opened_ms, 1000);
    assert_eq!(r.iter().filter(|x| x.path == wp(&paths[10])).count(), 1);
}

#[test]
fn an_editor_folder_is_marked_and_a_file_is_written_as_before() {
    let e = env();
    let s = store(&e);
    let folder = e.files.join("project");
    let file = e.files.join("notes.txt");
    s.recent_touch_at(&wp(&file), 1, false).unwrap();
    s.recent_touch_at(&wp(&folder), 2, true).unwrap();
    let r = s.recents_get().unwrap().value.entries;
    assert_eq!((r[0].path.clone(), r[0].as_editor), (wp(&folder), true));
    assert_eq!((r[1].path.clone(), r[1].as_editor), (wp(&file), false));

    // A file's entry carries no as_editor key; the folder's carries true.
    let on_disk = read_json(&e.state.join("recents.json"));
    assert_eq!(on_disk["entries"][0]["as_editor"], json!(true));
    assert!(on_disk["entries"][1].get("as_editor").is_none());

    // Opened again another way, the entry takes that way.
    s.recent_touch_at(&wp(&folder), 3, false).unwrap();
    assert!(!s.recents_get().unwrap().value.entries[0].as_editor);
}

#[test]
fn recent_remove_takes_one_entry_off() {
    let e = env();
    let s = store(&e);
    let a = e.files.join("a");
    let b = e.files.join("b");
    s.recent_touch_at(&wp(&a), 1, false).unwrap();
    s.recent_touch_at(&wp(&b), 2, false).unwrap();

    let removed = s.recent_remove(&wp(&a)).unwrap();
    assert!(removed.changed);
    let r = removed.value.entries;
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].path, wp(&b));
    assert_eq!(s.recents_get().unwrap().value.entries.len(), 1);

    // A path that is not among the recents changes nothing.
    let again = s.recent_remove(&wp(&a)).unwrap();
    assert!(!again.changed);
    assert_eq!(again.value.entries.len(), 1);
}

#[test]
fn a_pinned_folder_marked_as_an_editor_keeps_the_mark_only_while_pinned() {
    let e = env();
    let s = store(&e);
    let (project, plain) = (e.files.join("project"), e.files.join("plain"));
    s.pin(&wp(&plain), false).unwrap();
    let pinned = s.pin(&wp(&project), true).unwrap();
    assert!(pinned.changed);
    assert_eq!(pinned.value.entries, vec![wp(&plain), wp(&project)]);
    assert_eq!(pinned.value.editors, vec![wp(&project)]);
    // Pinned again as an editor: nothing changes; a plain pin gains the mark.
    assert!(!s.pin(&wp(&project), true).unwrap().changed);
    let marked = s.pin(&wp(&plain), true).unwrap();
    assert!(marked.changed);
    assert_eq!(marked.value.entries.len(), 2);

    // The mark is turned off and on; a path that is not pinned is refused.
    assert!(s.pin_editor_set(&wp(&plain), false).unwrap().changed);
    assert!(!s.pin_editor_set(&wp(&plain), false).unwrap().changed);
    assert_eq!(
        s.pin_editor_set(&wp(&e.files.join("other")), true)
            .unwrap_err()
            .kind,
        "NotPinned"
    );

    // Unpinned, the mark goes with it; with no mark left the key is not written.
    s.unpin(&wp(&project)).unwrap();
    assert!(s.pins_get().unwrap().value.editors.is_empty());
    let on_disk = read_json(&e.state.join("pins.json"));
    assert!(on_disk.get("editors").is_none(), "{on_disk}");
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
        s.pin(&wp(p), false).unwrap();
    }
    // A second pin of the same path changes nothing.
    assert!(!s.pin(&wp(&a), false).unwrap().changed);
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
        s.pin(&WirePath::Utf8("rel".into()), false)
            .unwrap_err()
            .kind,
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
            std::thread::spawn(move || s.pin(&wp(&p), false).unwrap())
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
        s.pin(&wp(p), false).unwrap();
        s.recent_touch(&wp(p), false).unwrap();
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
    // below the root (user, volume name). One is absent; the other is a
    // plain directory on the same device as its parent, which is what a
    // mount point looks like after the volume is unmounted.
    let media = e.files.join("media");
    let leftover = media.join("alice/STICK");
    fs::create_dir_all(&leftover).unwrap();
    let missing_volume = media.join("alice/UNPLUGGED/doc.txt");
    let on_leftover = leftover.join("deleted.txt");
    let elsewhere = e.files.join("home-gone.txt");
    for p in [&missing_volume, &on_leftover, &elsewhere] {
        s.pin(&wp(p), false).unwrap();
        s.recent_touch(&wp(p), false).unwrap();
    }
    let layouts = [(media.clone(), 2usize)];
    let report = s.prune_with(&layouts).unwrap();
    // Only the entry off every removable volume is dropped.
    assert_eq!(report.pins_removed, vec![wp(&elsewhere)]);
    assert_eq!(report.recents_removed, vec![wp(&elsewhere)]);
    assert_eq!(
        s.pins_get().unwrap().value.entries,
        vec![wp(&missing_volume), wp(&on_leftover)]
    );
    // The report carries the stores as they are after the prune.
    assert_eq!(report.pins.entries.len(), 2);
    assert_eq!(report.recents.entries.len(), 2);
}

#[test]
fn volume_online_means_a_mount_point() {
    let e = env();
    assert!(!volume_online(&e.files.join("absent")).unwrap());
    let plain = e.files.join("plain");
    fs::create_dir(&plain).unwrap();
    assert!(!volume_online(&plain).unwrap());
    // /proc is a mount of its own device under /.
    assert!(volume_online(Path::new("/proc")).unwrap());
}

#[test]
fn prune_drops_entry_on_mounted_volume() {
    let e = env();
    let s = store(&e);
    // Layout rooted at / with one component: /proc is a mount point, so a
    // missing file under it is really gone.
    let gone = PathBuf::from("/proc/kern-test-no-such-entry");
    s.pin(&wp(&gone), false).unwrap();
    let report = s.prune_with(&[(PathBuf::from("/"), 1)]).unwrap();
    assert_eq!(report.pins_removed, vec![wp(&gone)]);
}

#[test]
fn prune_reports_other_lstat_errors_and_keeps_entry() {
    let e = env();
    let s = store(&e);
    // A path through a regular file fails lstat with ENOTDIR, not NotFound.
    let file = e.files.join("plain");
    fs::write(&file, b"x").unwrap();
    let under = file.join("child");
    s.pin(&wp(&under), false).unwrap();
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
    let mut got = s.pins_get().unwrap();
    assert!(got.value.entries.is_empty());
    let report = got.corrupt.pop().expect("reported");
    assert_eq!(report.file, "pins.json");
    let moved = report.moved_to.as_ref().unwrap().to_path_buf().unwrap();
    let name = moved.file_name().unwrap().to_str().unwrap();
    let secs = name.strip_prefix("pins.json.corrupt-").expect("name");
    assert!(secs.parse::<u64>().is_ok(), "unix seconds, got {secs}");
    assert_eq!(fs::read(&moved).unwrap(), bad);
    assert!(!e.state.join("pins.json").exists());
    // Reported once: the file is gone, so the next read is a plain default.
    assert!(s.pins_get().unwrap().corrupt.is_empty());

    // A settings file that is not a JSON object is corrupt too.
    fs::create_dir_all(&e.config).unwrap();
    fs::write(e.config.join("settings.json"), "[1, 2]").unwrap();
    assert!(s.settings_get().unwrap().corrupt[0].moved_to.is_some());
    // A pins file of the wrong shape is moved aside.
    fs::write(e.state.join("pins.json"), r#"{"entries":"no"}"#).unwrap();
    assert!(s.pins_get().unwrap().corrupt[0].moved_to.is_some());
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
    let first = s.recents_get().unwrap().corrupt.remove(0).moved_to.unwrap();
    fs::write(e.state.join("recents.json"), "second").unwrap();
    let second = s.recents_get().unwrap().corrupt.remove(0).moved_to.unwrap();
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

#[test]
fn newer_settings_values_are_kept_and_reported_once() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::write(
        e.config.join("settings.json"),
        r##"{"accent":"teal-from-the-future","word_wrap":true,
            "follow":{"colours":false,"hue":true},"unknown":[1]}"##,
    )
    .unwrap();
    let s = store(&e);
    let first = s.settings_get().unwrap();
    // Only the unreadable field falls back; the rest of the file is used.
    assert_eq!(first.value.accent, Default::default());
    assert!(first.value.word_wrap);
    assert!(!first.value.follow.colours);
    assert_eq!(first.corrupt.len(), 1);
    assert_eq!(first.corrupt[0].field.as_deref(), Some("accent"));
    assert!(first.corrupt[0].moved_to.is_none());
    assert_eq!(names(&e.config), vec!["settings.json".to_owned()]);
    // Reported once per run.
    assert!(s.settings_get().unwrap().corrupt.is_empty());

    // A rewrite for another field writes the raw value, the unknown key and
    // the unknown key inside follow back unchanged.
    s.settings_set(patch(json!({"show_hidden": true}))).unwrap();
    let v = read_json(&e.config.join("settings.json"));
    assert_eq!(v["accent"], json!("teal-from-the-future"));
    assert_eq!(v["unknown"], json!([1]));
    assert_eq!(v["follow"]["hue"], json!(true));
    assert_eq!(v["follow"]["colours"], json!(false));
    assert_eq!(v["word_wrap"], json!(true));
    assert_eq!(v["show_hidden"], json!(true));

    // Patching the field replaces the raw value with a valid one.
    s.settings_set(patch(json!({"accent": "teal"}))).unwrap();
    assert_eq!(
        read_json(&e.config.join("settings.json"))["accent"],
        json!("teal")
    );
}

#[test]
fn follow_patch_may_be_partial_and_keeps_unknown_keys() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::write(
        e.config.join("settings.json"),
        r#"{"follow":{"colours":true,"accent":true,"fonts":true,"radius":true,"hue":9}}"#,
    )
    .unwrap();
    let s = store(&e);
    let out = s
        .settings_set(patch(json!({"follow": {"fonts": false}})))
        .unwrap();
    assert!(!out.value.follow.fonts && out.value.follow.colours);
    assert_eq!(
        read_json(&e.config.join("settings.json"))["follow"]["hue"],
        json!(9)
    );
}

#[test]
fn editor_zoom_must_be_finite_and_in_range() {
    let e = env();
    let s = store(&e);
    for bad in [
        json!(1e40),
        json!(0.0),
        json!(-1.0),
        json!(0.1),
        json!(6.0),
        json!("big"),
    ] {
        assert!(
            s.settings_set(patch(json!({"editor_zoom": bad}))).is_err(),
            "{bad} accepted"
        );
    }
    assert!(!e.config.join("settings.json").exists());
    s.settings_set(patch(json!({"editor_zoom": 0.25}))).unwrap();
    s.settings_set(patch(json!({"editor_zoom": 5.0}))).unwrap();
    // A stored value out of range is kept raw and reported, not fatal.
    fs::write(e.config.join("settings.json"), r#"{"editor_zoom": 1e40}"#).unwrap();
    let got = store(&e).settings_get().unwrap();
    assert_eq!(got.value.editor_zoom, 1.0);
    assert_eq!(got.corrupt[0].field.as_deref(), Some("editor_zoom"));
}

#[test]
fn prune_report_holds_the_stores_after_removal() {
    let e = env();
    let s = store(&e);
    let gone = e.files.join("gone");
    let kept = e.files.join("kept");
    fs::write(&kept, b"x").unwrap();
    s.pin(&wp(&gone), false).unwrap();
    s.pin(&wp(&kept), false).unwrap();
    let report = s.prune().unwrap();
    assert_eq!(report.pins_removed, vec![wp(&gone)]);
    assert_eq!(report.pins.entries, vec![wp(&kept)]);
    assert_eq!(report.pins, s.pins_get().unwrap().value);
}

#[test]
fn interface_size_defaults_to_90_and_accepts_only_the_listed_sizes() {
    let e = env();
    let s = store(&e);
    assert_eq!(s.settings_get().unwrap().value.interface_size, 90);
    assert_eq!(INTERFACE_SIZES, [80, 90, 100, 110, 125]);
    assert_eq!(DEFAULT_INTERFACE_SIZE, 90);
    for bad in [
        json!(0),
        json!(85),
        json!(95),
        json!(150),
        json!(-90),
        json!(100.5),
        json!("100"),
        json!(null),
    ] {
        assert!(
            s.settings_set(patch(json!({"interface_size": bad})))
                .is_err(),
            "{bad} accepted"
        );
    }
    // A refused patch writes nothing.
    assert!(!e.config.join("settings.json").exists());
    for good in INTERFACE_SIZES {
        let out = s
            .settings_set(patch(json!({ "interface_size": good })))
            .unwrap();
        assert_eq!(out.value.interface_size, good);
    }
    assert_eq!(
        read_json(&e.config.join("settings.json"))["interface_size"],
        json!(125)
    );
    assert_eq!(store(&e).settings_get().unwrap().value.interface_size, 125);
}

#[test]
fn a_bad_stored_interface_size_is_reported_kept_and_replaced_by_the_next_choice() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::write(e.config.join("settings.json"), r#"{"interface_size": 77}"#).unwrap();
    let got = store(&e).settings_get().unwrap();
    // In memory the default stands in, and the report names the field.
    assert_eq!(got.value.interface_size, 90);
    assert_eq!(got.corrupt.len(), 1);
    assert_eq!(got.corrupt[0].field.as_deref(), Some("interface_size"));
    assert!(got.corrupt[0].moved_to.is_none());
    // The file is left as it was until the user chooses a size.
    assert_eq!(
        read_json(&e.config.join("settings.json"))["interface_size"],
        json!(77)
    );
    let set = store(&e)
        .settings_set(patch(json!({"interface_size": 110})))
        .unwrap();
    assert_eq!(set.value.interface_size, 110);
    assert_eq!(
        read_json(&e.config.join("settings.json"))["interface_size"],
        json!(110)
    );
    assert!(store(&e).settings_get().unwrap().corrupt.is_empty());
    // A stored value of the wrong type is a bad value too.
    fs::write(
        e.config.join("settings.json"),
        r#"{"interface_size": "big"}"#,
    )
    .unwrap();
    let got = store(&e).settings_get().unwrap();
    assert_eq!(got.value.interface_size, 90);
    assert_eq!(got.corrupt[0].field.as_deref(), Some("interface_size"));
}

// ---- the window layout and the default layout setting ----

#[test]
fn layout_remembered() {
    let e = env();
    let s = store(&e);
    // Nothing chosen yet: the default column, the tree not rooted.
    let first = s.layout_get().unwrap().value;
    assert_eq!(
        (first.left_width, first.left_open, first.tree_root.clone()),
        (LEFT_WIDTH_DEFAULT, true, None)
    );
    assert!(!e.state.join("layout.json").exists());

    let root = wp(&e.files);
    let out = s
        .layout_set(patch(json!({
            "left_width": 333, "left_open": false, "tree_root": root,
        })))
        .unwrap();
    assert!(out.changed);
    // A restart: a new store over the same directories reads what was written, in the state dir.
    let again = store(&e).layout_get().unwrap().value;
    assert_eq!(again.left_width, 333);
    assert!(!again.left_open);
    assert_eq!(again.tree_root, Some(wp(&e.files)));
    let on_disk = read_json(&e.state.join("layout.json"));
    assert_eq!(on_disk["left_width"], json!(333));
    // The same patch again changes nothing; a partial one leaves the other fields.
    assert!(
        !s.layout_set(patch(json!({"left_width": 333})))
            .unwrap()
            .changed
    );
    let part = s
        .layout_set(patch(json!({"left_open": true})))
        .unwrap()
        .value;
    assert_eq!((part.left_open, part.left_width), (true, 333));
}

#[test]
fn a_stored_layout_key_is_dropped_and_refused() {
    // The main window's layout is the setting alone: a layout.json that still holds one loses it
    // at the next write, is not reported, and a patch naming it is refused.
    let e = env();
    fs::create_dir_all(&e.state).unwrap();
    fs::write(
        e.state.join("layout.json"),
        r#"{"layout": "editor", "left_width": 300}"#,
    )
    .unwrap();
    let s = store(&e);
    let got = s.layout_get().unwrap();
    assert!(got.corrupt.is_empty());
    assert_eq!(got.value.left_width, 300);
    s.layout_set(patch(json!({"left_open": false}))).unwrap();
    let disk = read_json(&e.state.join("layout.json"));
    assert!(disk.get("layout").is_none(), "{disk}");
    let err = s
        .layout_set(patch(json!({"layout": "editor"})))
        .unwrap_err();
    assert_eq!(err.kind, "InvalidArgument");
}

#[test]
fn a_non_utf8_tree_root_is_kept() {
    let e = env();
    let s = store(&e);
    let name = OsString::from_vec(b"caf\xe9".to_vec());
    let dir = e.files.join(name);
    fs::create_dir(&dir).unwrap();
    s.layout_set(patch(json!({"tree_root": wp(&dir)}))).unwrap();
    assert_eq!(
        store(&e).layout_get().unwrap().value.tree_root,
        Some(wp(&dir))
    );
}

#[test]
fn a_layout_patch_that_is_wrong_writes_nothing() {
    let e = env();
    let s = store(&e);
    for bad in [
        json!({"nope": 1}),
        json!({"left_width": LEFT_WIDTH_MIN - 1}),
        json!({"left_width": LEFT_WIDTH_MAX + 1}),
        json!({"left_width": "wide"}),
        json!({"right_width": RIGHT_WIDTH_MIN - 1}),
        json!({"right_width": RIGHT_WIDTH_MAX + 1}),
        json!({"left_open": 1}),
        json!({"tree_root": {"k": "Utf8", "v": "relative/dir"}}),
        // One bad field refuses the good one beside it.
        json!({"left_width": 300, "left_open": "yes"}),
    ] {
        let err = s.layout_set(patch(bad.clone())).unwrap_err();
        assert_eq!(err.kind, "InvalidArgument", "{bad}");
    }
    assert!(!e.state.join("layout.json").exists());
    for good in [RIGHT_WIDTH_MIN, RIGHT_WIDTH_MAX] {
        assert_eq!(
            s.layout_set(patch(json!({"right_width": good})))
                .unwrap()
                .value
                .right_width,
            good
        );
    }
    for good in [LEFT_WIDTH_MIN, LEFT_WIDTH_MAX] {
        assert_eq!(
            s.layout_set(patch(json!({"left_width": good})))
                .unwrap()
                .value
                .left_width,
            good
        );
    }
}

#[test]
fn a_bad_layout_field_is_reported_once_kept_and_never_a_crash() {
    let e = env();
    fs::create_dir_all(&e.state).unwrap();
    fs::write(
        e.state.join("layout.json"),
        r#"{"left_width": 9999, "left_open": false, "tree_root": "/x", "future": [1]}"#,
    )
    .unwrap();
    let s = store(&e);
    let got = s.layout_get().unwrap();
    // The bad fields hold their defaults in memory; the good one is read.
    assert_eq!(got.value.left_width, LEFT_WIDTH_DEFAULT);
    assert!(!got.value.left_open);
    let mut fields: Vec<_> = got.corrupt.iter().filter_map(|r| r.field.clone()).collect();
    fields.sort();
    assert_eq!(fields, ["left_width", "tree_root"]);
    assert!(got
        .corrupt
        .iter()
        .all(|r| r.file == "layout.json" && r.moved_to.is_none()));
    // Reported once per run.
    assert!(s.layout_get().unwrap().corrupt.is_empty());
    // A write of another field keeps the raw bad values and the unknown key.
    s.layout_set(patch(json!({"left_open": true}))).unwrap();
    let disk = read_json(&e.state.join("layout.json"));
    assert_eq!(disk["left_width"], json!(9999));
    assert_eq!(disk["future"], json!([1]));
    // Choosing the field again replaces the bad value.
    s.layout_set(patch(json!({"left_width": 300}))).unwrap();
    assert_eq!(
        read_json(&e.state.join("layout.json"))["left_width"],
        json!(300)
    );
}

#[test]
fn a_layout_file_that_is_not_an_object_is_moved_aside() {
    let e = env();
    fs::create_dir_all(&e.state).unwrap();
    fs::write(e.state.join("layout.json"), "[1, 2").unwrap();
    let got = store(&e).layout_get().unwrap();
    assert_eq!(got.value.left_width, LEFT_WIDTH_DEFAULT);
    let moved = got.corrupt[0].moved_to.clone().expect("moved aside");
    assert!(moved.to_path_buf().unwrap().exists());
    assert!(!e.state.join("layout.json").exists());
}

#[test]
fn the_main_window_layout_is_the_file_manager_and_the_editor_is_refused() {
    let e = env();
    let s = store(&e);
    assert_eq!(MAIN_LAYOUTS, [LayoutKind::FileManager]);
    assert_eq!(
        s.settings_get().unwrap().value.default_layout,
        LayoutKind::FileManager
    );
    // The editor layout is not offered for the main window: refused, and nothing is written.
    let err = s
        .settings_set(patch(json!({"default_layout": "editor"})))
        .unwrap_err();
    assert_eq!(err.kind, "InvalidArgument");
    assert!(err.message.contains("not offered"), "{}", err.message);
    assert!(!e.config.join("settings.json").exists());
    // The file manager is taken; it is the value already, so nothing changes.
    let same = s
        .settings_set(patch(json!({"default_layout": "file_manager"})))
        .unwrap();
    assert!(!same.changed);
    // A value that is not a layout refuses the patch too.
    let err = s
        .settings_set(patch(json!({"default_layout": "sideways"})))
        .unwrap_err();
    assert_eq!(err.kind, "InvalidArgument");
    assert!(!e.config.join("settings.json").exists());
}

#[test]
fn a_stored_editor_layout_reads_as_the_file_manager_and_the_next_write_stores_it() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::write(
        e.config.join("settings.json"),
        r#"{"default_layout": "editor"}"#,
    )
    .unwrap();
    let s = store(&e);
    let got = s.settings_get().unwrap();
    assert_eq!(got.value.default_layout, LayoutKind::FileManager);
    assert!(got.corrupt.is_empty());
    s.settings_set(patch(json!({"word_wrap": true}))).unwrap();
    assert_eq!(
        read_json(&e.config.join("settings.json"))["default_layout"],
        json!("file_manager")
    );
}

#[test]
fn a_bad_stored_default_layout_is_reported_kept_and_replaced_by_the_next_choice() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::write(e.config.join("settings.json"), r#"{"default_layout": 3}"#).unwrap();
    let s = store(&e);
    let got = s.settings_get().unwrap();
    assert_eq!(got.value.default_layout, LayoutKind::FileManager);
    assert_eq!(got.corrupt.len(), 1);
    assert_eq!(got.corrupt[0].field.as_deref(), Some("default_layout"));
    s.settings_set(patch(json!({"word_wrap": true}))).unwrap();
    assert_eq!(
        read_json(&e.config.join("settings.json"))["default_layout"],
        json!(3)
    );
    s.settings_set(patch(json!({"default_layout": "file_manager"})))
        .unwrap();
    assert_eq!(
        read_json(&e.config.join("settings.json"))["default_layout"],
        json!("file_manager")
    );
}

#[test]
fn the_new_tab_settings_default_to_home_and_the_new_tab_folder() {
    let e = env();
    let got = store(&e).settings_get().unwrap().value;
    assert_eq!(got.new_tab_folder, None);
    assert_eq!(got.new_tab_default, NewTabDefault::Folder);
}

#[test]
fn the_new_tab_settings_are_stored_and_read_back() {
    let e = env();
    let s = store(&e);
    let dir = e.config.join("somewhere");
    let out = s
        .settings_set(patch(
            json!({"new_tab_folder": wp(&dir), "new_tab_default": "current"}),
        ))
        .unwrap();
    assert_eq!(out.value.new_tab_folder, Some(wp(&dir)));
    assert_eq!(out.value.new_tab_default, NewTabDefault::Current);
    let again = store(&e).settings_get().unwrap().value;
    assert_eq!(again.new_tab_folder, Some(wp(&dir)));
    assert_eq!(again.new_tab_default, NewTabDefault::Current);
    // null is Home again.
    let back = s
        .settings_set(patch(json!({"new_tab_folder": null})))
        .unwrap();
    assert_eq!(back.value.new_tab_folder, None);
    assert_eq!(
        read_json(&e.config.join("settings.json"))["new_tab_folder"],
        Value::Null
    );
}

#[test]
fn a_relative_new_tab_folder_or_an_unknown_default_is_refused_and_changes_nothing() {
    let e = env();
    let s = store(&e);
    let err = s
        .settings_set(patch(
            json!({"new_tab_folder": {"k": "Utf8", "v": "relative/dir"}}),
        ))
        .unwrap_err();
    assert_eq!(err.kind, "InvalidArgument");
    let err = s
        .settings_set(patch(json!({"new_tab_default": "elsewhere"})))
        .unwrap_err();
    assert_eq!(err.kind, "InvalidArgument");
    let got = s.settings_get().unwrap().value;
    assert_eq!(got.new_tab_folder, None);
    assert_eq!(got.new_tab_default, NewTabDefault::Folder);
}

#[test]
fn a_bad_stored_new_tab_folder_is_reported_and_kept() {
    let e = env();
    fs::create_dir_all(&e.config).unwrap();
    fs::write(
        e.config.join("settings.json"),
        r#"{"new_tab_folder": {"k": "Utf8", "v": "rel"}}"#,
    )
    .unwrap();
    let s = store(&e);
    let got = s.settings_get().unwrap();
    assert_eq!(got.value.new_tab_folder, None);
    assert_eq!(got.corrupt.len(), 1);
    assert_eq!(got.corrupt[0].field.as_deref(), Some("new_tab_folder"));
    s.settings_set(patch(json!({"word_wrap": true}))).unwrap();
    assert_eq!(
        read_json(&e.config.join("settings.json"))["new_tab_folder"],
        json!({"k": "Utf8", "v": "rel"})
    );
}

#[test]
fn set_aside_makes_the_session_the_closed_set_and_starts_a_new_one() {
    let e = env();
    let s = store(&e);
    fs::create_dir_all(&e.state).unwrap();
    // An entry this version cannot read moves with the rest, unchanged.
    let raw = json!({"windows": [{"label": "main", "tabs": [], "active": null}, {"label": "x"}]});
    fs::write(e.state.join("session.json"), raw.to_string()).unwrap();
    s.session_set_aside().unwrap();
    assert!(!e.state.join("session.json").exists());
    assert_eq!(read_json(&e.state.join("closed-session.json")), raw);
    let closed = s.closed_get().unwrap().value;
    assert_eq!(closed.windows.len(), 1);
    assert!(s.session_get().unwrap().value.windows.is_empty());
    // A run that kept no window leaves no closed set behind.
    s.session_set_aside().unwrap();
    assert!(!e.state.join("closed-session.json").exists());
}

#[test]
fn clearing_the_closed_set_removes_it_and_clearing_none_is_fine() {
    let e = env();
    let s = store(&e);
    s.session_put(session_window("main", vec![], None)).unwrap();
    s.session_set_aside().unwrap();
    s.closed_clear().unwrap();
    assert!(!e.state.join("closed-session.json").exists());
    s.closed_clear().unwrap();
    assert!(s.closed_get().unwrap().value.windows.is_empty());
}

fn session_window(label: &str, tabs: Vec<SessionTab>, active: Option<usize>) -> SessionWindow {
    SessionWindow {
        label: label.to_owned(),
        root: None,
        tabs,
        active,
    }
}

#[test]
fn no_session_file_is_no_window() {
    let e = env();
    let got = store(&e).session_get().unwrap();
    assert!(got.value.windows.is_empty());
    assert!(got.corrupt.is_empty());
}

#[test]
fn a_window_put_is_read_back_in_place_of_its_entry() {
    let e = env();
    let s = store(&e);
    let a = wp(&e.files.join("a"));
    let doc = wp(&e.files.join("notes.txt"));
    let main = session_window(
        "main",
        vec![
            SessionTab::Folder { path: a.clone() },
            SessionTab::Doc { path: doc.clone() },
            SessionTab::Trash,
            SessionTab::Documents,
        ],
        Some(1),
    );
    assert!(s.session_put(main.clone()).unwrap().changed);
    let mut editor = session_window("editor-2", vec![], None);
    editor.root = Some(a.clone());
    s.session_put(editor.clone()).unwrap();
    // The same window again writes nothing; a change replaces the entry in place.
    assert!(!s.session_put(main.clone()).unwrap().changed);
    let moved = session_window("main", vec![SessionTab::Trash], Some(0));
    assert!(s.session_put(moved.clone()).unwrap().changed);
    let got = store(&e).session_get().unwrap().value;
    assert_eq!(got.windows, vec![moved, editor]);
    assert_eq!(
        read_json(&e.state.join("session.json"))["windows"][1],
        json!({"label": "editor-2", "root": a, "tabs": [], "active": null})
    );
}

#[test]
fn a_window_with_a_relative_path_an_active_past_its_tabs_or_no_label_is_refused() {
    let e = env();
    let s = store(&e);
    let rel = WirePath::Utf8("rel".to_owned());
    for bad in [
        session_window("main", vec![SessionTab::Folder { path: rel.clone() }], None),
        session_window("main", vec![SessionTab::Trash], Some(1)),
        session_window("", vec![], None),
        SessionWindow {
            root: Some(rel.clone()),
            ..session_window("editor-1", vec![], None)
        },
    ] {
        assert_eq!(s.session_put(bad).unwrap_err().kind, "InvalidArgument");
    }
    assert!(!e.state.join("session.json").exists());
}

#[test]
fn retain_drops_the_windows_it_is_not_asked_to_keep() {
    let e = env();
    let s = store(&e);
    for label in ["main", "doc-1", "doc-2"] {
        s.session_put(session_window(label, vec![], None)).unwrap();
    }
    let out = s.session_retain(|l| l != "doc-1").unwrap();
    assert!(out.changed);
    let labels: Vec<String> = out.value.windows.into_iter().map(|w| w.label).collect();
    assert_eq!(labels, ["main", "doc-2"]);
    assert!(!s.session_retain(|_| true).unwrap().changed);
}

#[test]
fn a_session_entry_that_does_not_parse_is_reported_once_kept_and_replaced_by_its_label() {
    let e = env();
    fs::create_dir_all(&e.state).unwrap();
    let path = wp(&e.files);
    let newer = json!({"label": "editor-1", "root": path, "tabs": [{"kind": "split"}]});
    let file = json!({
        "windows": [
            {"label": "main", "tabs": [{"kind": "trash"}], "active": 0},
            newer,
            {"label": "main", "tabs": []},
            {"label": "doc-1", "tabs": [{"kind": "doc", "path": {"k": "Utf8", "v": "rel"}}]}
        ],
        "future": 7
    });
    fs::write(e.state.join("session.json"), file.to_string()).unwrap();
    let s = store(&e);
    let got = s.session_get().unwrap();
    let labels: Vec<&str> = got.value.windows.iter().map(|w| w.label.as_str()).collect();
    assert_eq!(labels, ["main"]);
    let fields: Vec<&str> = got
        .corrupt
        .iter()
        .map(|r| r.field.as_deref().unwrap())
        .collect();
    assert_eq!(fields, ["windows[1]", "windows[2]", "windows[3]"]);
    assert!(got.corrupt.iter().all(|r| r.file == "session.json"));
    assert!(s.session_get().unwrap().corrupt.is_empty());
    // A write keeps what it could not read and the keys it does not know.
    s.session_put(session_window("doc-2", vec![], None))
        .unwrap();
    let on_disk = read_json(&e.state.join("session.json"));
    assert_eq!(on_disk["future"], 7);
    assert_eq!(on_disk["windows"][2], newer);
    // A window of this run with the label of an entry that was not read takes its place.
    let mut editor = session_window("editor-1", vec![], None);
    editor.root = Some(path.clone());
    s.session_put(editor).unwrap();
    let on_disk = read_json(&e.state.join("session.json"));
    let raws = on_disk["windows"].as_array().unwrap();
    assert_eq!(raws.iter().filter(|w| w["label"] == "editor-1").count(), 1);
    assert!(!raws.contains(&newer));
}

#[test]
fn a_session_file_that_is_not_a_session_is_moved_aside() {
    let e = env();
    fs::create_dir_all(&e.state).unwrap();
    fs::write(e.state.join("session.json"), r#"{"windows": 3}"#).unwrap();
    let got = store(&e).session_get().unwrap();
    assert!(got.value.windows.is_empty());
    assert_eq!(got.corrupt.len(), 1);
    assert!(got.corrupt[0].moved_to.is_some());
    assert!(!e.state.join("session.json").exists());
}
