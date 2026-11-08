// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! `kern --apply-settings FILE`: the command line form and the write it makes.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use kern_lib::cli::{plan, Plan, APPLY_SETTINGS};
use kern_lib::prelaunch::apply_settings;
use kern_lib::store::{Settings, Store};
use serde_json::{json, Value};

fn args(a: &[&str]) -> Vec<OsString> {
    a.iter().map(OsString::from).collect()
}

fn cwd() -> PathBuf {
    PathBuf::from("/work")
}

#[test]
fn plan_apply_settings() {
    assert_eq!(
        plan(&args(&[APPLY_SETTINGS, "p.json"]), &cwd()),
        Plan::ApplySettings(PathBuf::from("/work/p.json"))
    );
}

#[test]
fn plan_apply_settings_missing_file_arg() {
    match plan(&args(&[APPLY_SETTINGS]), &cwd()) {
        Plan::Open(p) => {
            assert!(p.paths.is_empty());
            assert_eq!(p.errors.len(), 1);
            assert_eq!(p.errors[0].arg, OsString::from(APPLY_SETTINGS));
        }
        other => panic!("expected an argument error, got {other:?}"),
    }
}

#[test]
fn plan_apply_settings_extra_arg() {
    match plan(&args(&[APPLY_SETTINGS, "p.json", "q.json"]), &cwd()) {
        Plan::Open(p) => {
            assert!(p.paths.is_empty());
            assert_eq!(p.errors.len(), 1);
        }
        other => panic!("expected an argument error, got {other:?}"),
    }
}

#[test]
fn plan_apply_settings_after_double_dash_is_a_path() {
    match plan(&args(&["--", APPLY_SETTINGS, "p.json"]), &cwd()) {
        Plan::Open(p) => assert_eq!(
            p.paths,
            vec![
                PathBuf::from("/work").join(APPLY_SETTINGS),
                PathBuf::from("/work/p.json")
            ]
        ),
        other => panic!("expected two paths, got {other:?}"),
    }
}

struct Env {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    config: PathBuf,
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    Env {
        config: root.join("config"),
        root,
        _tmp: tmp,
    }
}

impl Env {
    fn store(&self) -> Store {
        Store::new(self.config.clone(), self.root.join("state"))
    }

    fn patch(&self, body: &str) -> PathBuf {
        let p = self.root.join("patch.json");
        fs::write(&p, body).unwrap();
        p
    }

    fn settings_file(&self) -> PathBuf {
        self.config.join("settings.json")
    }
}

fn read(p: &Path) -> Value {
    serde_json::from_slice(&fs::read(p).unwrap()).unwrap()
}

#[test]
fn valid_patch_is_written() {
    let e = env();
    let p = e.patch(r#"{"theme_mode": "dark", "interface_size": 110, "show_hidden": true}"#);
    apply_settings(&e.store(), &p).unwrap();
    let v = read(&e.settings_file());
    assert_eq!(v["theme_mode"], json!("dark"));
    assert_eq!(v["interface_size"], json!(110));
    assert_eq!(v["show_hidden"], json!(true));
}

#[test]
fn unknown_key_is_refused_and_nothing_is_written() {
    let e = env();
    let p = e.patch(r#"{"theme_mode": "dark", "colour_of_the_day": 3}"#);
    assert!(apply_settings(&e.store(), &p).is_err());
    assert!(!e.settings_file().exists());
}

#[test]
fn interface_size_not_offered_is_refused() {
    let e = env();
    let p = e.patch(r#"{"interface_size": 95}"#);
    assert!(apply_settings(&e.store(), &p).is_err());
    assert!(!e.settings_file().exists());
}

#[test]
fn non_object_json_is_refused() {
    let e = env();
    let p = e.patch("[1, 2]");
    assert!(apply_settings(&e.store(), &p).is_err());
    assert!(!e.settings_file().exists());
}

#[test]
fn missing_file_is_refused() {
    let e = env();
    assert!(apply_settings(&e.store(), &e.root.join("absent.json")).is_err());
    assert!(!e.settings_file().exists());
}

/// The installer's settings walk names every setting but `default_layout`,
/// which offers the main window one choice. A setting added without a
/// question in the walk fails here.
#[test]
fn installer_walk_covers_every_setting() {
    let src = include_str!("../../installer/settings.sh");
    let line = src
        .lines()
        .find_map(|l| l.strip_prefix("SETTING_KEYS=\""))
        .and_then(|l| l.strip_suffix('"'))
        .expect("installer/settings.sh has a SETTING_KEYS=\"...\" line");
    let walk: BTreeSet<String> = line.split_whitespace().map(str::to_owned).collect();
    let known: BTreeSet<String> = match serde_json::to_value(Settings::default()).unwrap() {
        Value::Object(m) => m.into_iter().map(|(k, _)| k).collect(),
        other => panic!("settings serialise to {other}"),
    };
    let expected: BTreeSet<String> = known
        .into_iter()
        .filter(|k| k != "default_layout")
        .collect();
    assert_eq!(walk, expected);
}

/// The objects the installer's settings walk writes (installer/settings.sh):
/// all defaults, and one with every kind of answer, paths in wire form. The
/// store takes both whole.
#[test]
fn installer_walk_output_is_accepted() {
    let e = env();
    let folder = e.root.join("my \"odd\" \\ dir");
    fs::create_dir(&folder).unwrap();
    let defaults = r#"{"theme_mode":"system","interface_size":90,"follow":{"colours":true,"accent":true,"fonts":true,"radius":true},"accent":"slate","new_tab_folder":null,"new_tab_default":"folder","view_mode":"list","show_hidden":false,"terminal":null,"scan_documents":true,"scan_downloads":true,"scan_roots":[],"word_wrap":false,"error_log":true,"editor_zoom":1}"#;
    apply_settings(&e.store(), &e.patch(defaults)).unwrap();
    let chosen = json!({
        "theme_mode": "dark", "interface_size": 125,
        "follow": {"colours": false, "accent": false, "fonts": true, "radius": false},
        "accent": "graphite",
        "new_tab_folder": {"k": "Utf8", "v": folder.to_str().unwrap()},
        "new_tab_default": "current", "view_mode": "grid", "show_hidden": true,
        "terminal": "foot", "scan_documents": false, "scan_downloads": false,
        "scan_roots": [{"k": "Bytes", "v": "L3RtcC/m"}],
        "word_wrap": true, "error_log": false, "editor_zoom": 1.25
    });
    apply_settings(&e.store(), &e.patch(&chosen.to_string())).unwrap();
    let v = read(&e.settings_file());
    assert_eq!(v["accent"], json!("graphite"));
    assert_eq!(v["editor_zoom"], json!(1.25));
    assert_eq!(v["error_log"], json!(false));
    assert_eq!(v["new_tab_folder"]["v"], json!(folder.to_str().unwrap()));
    assert_eq!(v["scan_roots"][0]["k"], json!("Bytes"));
}
