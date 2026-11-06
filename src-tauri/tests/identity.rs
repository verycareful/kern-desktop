// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The identity of a file for the folder tree's loop check: the device and
//! inode after following links.

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;

use kern_lib::identity::{identity_of, link_target_of, Identity};
use kernkraft_fs::{write_atomic, Expect, FsError};

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

/// Makes a link at `at` to `to`.
fn link(to: &std::path::Path, at: &std::path::Path) {
    std::os::unix::fs::symlink(to, at).unwrap();
}

#[test]
fn a_link_to_a_missing_file_leads_to_the_path_it_holds() {
    let t = tempfile::tempdir().unwrap();
    let absolute = t.path().join("gone/where.txt");
    let l = t.path().join("l");
    link(&absolute, &l);
    assert_eq!(link_target_of(&l).unwrap(), absolute);
}

#[test]
fn a_relative_link_is_taken_from_the_folder_of_the_link() {
    let t = tempfile::tempdir().unwrap();
    fs::create_dir(t.path().join("dir")).unwrap();
    let l = t.path().join("dir/l");
    link(std::path::Path::new("sub/x.txt"), &l);
    assert_eq!(
        link_target_of(&l).unwrap(),
        t.path().join("dir").join("sub/x.txt")
    );
}

#[test]
fn a_chain_of_links_leads_to_the_end_of_the_chain() {
    let t = tempfile::tempdir().unwrap();
    let (a, b) = (t.path().join("a"), t.path().join("b"));
    let end = t.path().join("end.txt");
    link(&b, &a);
    link(std::path::Path::new("end.txt"), &b);
    assert_eq!(link_target_of(&a).unwrap(), end);
}

#[test]
fn a_path_that_is_no_link_or_a_loop_of_links_is_an_error() {
    let t = tempfile::tempdir().unwrap();
    let file = t.path().join("f");
    fs::write(&file, "x").unwrap();
    assert!(link_target_of(&file).is_err());
    assert!(link_target_of(&t.path().join("missing")).is_err());
    let (a, b) = (t.path().join("a"), t.path().join("b"));
    link(&b, &a);
    link(&a, &b);
    let err = link_target_of(&a).unwrap_err();
    assert_eq!(err.kind, "TooManyLinks", "{err:?}");
}

#[test]
fn a_file_created_only_if_nothing_is_there_lands_at_the_end_of_a_link_and_replaces_nothing() {
    let t = tempfile::tempdir().unwrap();
    let l = t.path().join("l");
    link(std::path::Path::new("made.txt"), &l);
    let target = link_target_of(&l).unwrap();
    // Created at the target; the link stays and now reaches it.
    write_atomic(&target, Expect::Nothing, |w| {
        std::io::Write::write_all(w, b"mine")
    })
    .unwrap();
    assert_eq!(fs::read(t.path().join("made.txt")).unwrap(), b"mine");
    assert!(fs::symlink_metadata(&l).unwrap().file_type().is_symlink());
    // Something else there by the next time: refused, and what is there is left as it is.
    fs::write(t.path().join("made.txt"), "theirs").unwrap();
    let err = write_atomic(&target, Expect::Nothing, |w| {
        std::io::Write::write_all(w, b"again")
    })
    .unwrap_err();
    assert!(matches!(err, FsError::Exists { .. }), "{err:?}");
    assert_eq!(fs::read(t.path().join("made.txt")).unwrap(), b"theirs");
}

#[test]
fn a_file_created_through_a_link_into_a_missing_folder_fails_and_makes_nothing() {
    let t = tempfile::tempdir().unwrap();
    let l = t.path().join("l");
    link(std::path::Path::new("gone/made.txt"), &l);
    let target = link_target_of(&l).unwrap();
    // The temporary file is made in the target's folder, which is not there.
    let err = write_atomic(&target, Expect::Nothing, |w| {
        std::io::Write::write_all(w, b"mine")
    })
    .unwrap_err();
    assert!(matches!(err, FsError::Io { .. }), "{err:?}");
    assert!(!t.path().join("gone").exists());
    let names: Vec<_> = fs::read_dir(t.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names, vec![OsString::from("l")]);
}

#[test]
fn a_file_created_through_a_link_to_a_folder_is_refused_and_the_folder_is_untouched() {
    let t = tempfile::tempdir().unwrap();
    let folder = t.path().join("dir");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("inside.txt"), "kept").unwrap();
    let l = t.path().join("l");
    link(std::path::Path::new("dir"), &l);
    let target = link_target_of(&l).unwrap();
    let err = write_atomic(&target, Expect::Nothing, |w| {
        std::io::Write::write_all(w, b"mine")
    })
    .unwrap_err();
    assert!(matches!(err, FsError::Exists { .. }), "{err:?}");
    assert!(fs::metadata(&folder).unwrap().is_dir());
    let inside: Vec<_> = fs::read_dir(&folder)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(inside, vec![OsString::from("inside.txt")]);
    assert_eq!(fs::read(folder.join("inside.txt")).unwrap(), b"kept");
    // The temporary file did not stay behind next to the folder.
    let mut names: Vec<_> = fs::read_dir(t.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    names.sort();
    assert_eq!(names, vec![OsString::from("dir"), OsString::from("l")]);
}
