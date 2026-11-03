// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The identity of a file for the folder tree's loop check: the device and
//! inode after following links.

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;

use kern_lib::identity::{identity_of, Identity};

fn known(i: Identity) -> (String, String) {
    match i {
        Identity::Known { dev, ino } => (dev, ino),
        Identity::Failed { error } => panic!("expected an identity: {error:?}"),
    }
}

#[test]
fn a_symlink_to_a_folder_has_the_folders_identity() {
    let t = tempfile::tempdir().unwrap();
    let real = t.path().join("real");
    let other = t.path().join("other");
    fs::create_dir(&real).unwrap();
    fs::create_dir(&other).unwrap();
    let link = t.path().join("link");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert_eq!(known(identity_of(&link)), known(identity_of(&real)));
    assert_ne!(known(identity_of(&other)), known(identity_of(&real)));
    // Derived from stat, not copied from a run.
    let m = fs::metadata(&real).unwrap();
    assert_eq!(
        known(identity_of(&real)),
        (m.dev().to_string(), m.ino().to_string())
    );
}

#[test]
fn a_hard_link_has_the_files_identity() {
    let t = tempfile::tempdir().unwrap();
    let a = t.path().join("a");
    fs::write(&a, "x").unwrap();
    let b = t.path().join("b");
    fs::hard_link(&a, &b).unwrap();
    assert_eq!(known(identity_of(&a)), known(identity_of(&b)));
}

#[test]
fn a_path_that_cannot_be_looked_at_says_why() {
    let t = tempfile::tempdir().unwrap();
    // A dangling link and a missing name.
    let dangling = t.path().join("dangling");
    std::os::unix::fs::symlink(t.path().join("nowhere"), &dangling).unwrap();
    for p in [dangling, t.path().join("missing")] {
        match identity_of(&p) {
            Identity::Failed { error } => assert_eq!(error.kind, "NotFound", "{p:?}"),
            other => panic!("{p:?}: {other:?}"),
        }
    }
}

#[test]
fn a_name_that_is_not_utf8_has_an_identity() {
    let t = tempfile::tempdir().unwrap();
    let name = OsString::from_vec(b"caf\xe9".to_vec());
    let p: PathBuf = t.path().join(name);
    fs::create_dir(&p).unwrap();
    let (dev, ino) = known(identity_of(&p));
    let m = fs::metadata(&p).unwrap();
    assert_eq!((dev, ino), (m.dev().to_string(), m.ino().to_string()));
}

#[test]
fn the_identity_travels_as_strings() {
    // An inode may not fit a JSON number exactly; both parts are decimal strings.
    let t = tempfile::tempdir().unwrap();
    let v = serde_json::to_value(identity_of(t.path())).unwrap();
    assert_eq!(v["state"], "known");
    assert!(v["dev"].is_string() && v["ino"].is_string(), "{v}");
}
