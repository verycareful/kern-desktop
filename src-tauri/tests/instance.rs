// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The single-instance service over the live session bus. Skipped, with the
//! reason printed, when there is no bus.

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use kern_lib::instance::{
    claim, claim_when_free, forward, launch_dir, Claim, Invocation, Launches,
};

#[test]
fn second_open_reaches_the_owner() {
    let (owner_conn, second_conn) = match (kernkraft_bus::session(), kernkraft_bus::session()) {
        (Ok(a), Ok(b)) => (a, b),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("skipped: no session bus: {e}");
            return;
        }
    };
    // A name of its own, so a running Kern is not disturbed.
    let name = format!("io.github.verycareful.kern.Test{}", std::process::id());
    let Claim::Owner(launches) = claim(&owner_conn, &name, Launches::default()).unwrap() else {
        panic!("a fresh name must be free");
    };
    assert!(matches!(
        claim(&second_conn, &name, Launches::default()).unwrap(),
        Claim::Taken
    ));

    let inv = Invocation {
        argv: vec![
            OsString::from_vec(b"caf\xe9.txt".to_vec()),
            OsString::from("b.md"),
        ],
        cwd: PathBuf::from(OsString::from_vec(b"/w\xff".to_vec())),
        activation_token: "token-1".to_owned(),
    };
    forward(&second_conn, &name, &inv).unwrap();
    let got = launches.recv_timeout(Duration::from_secs(30)).unwrap();
    assert_eq!(got, inv);
}

#[test]
fn forward_to_nobody_is_an_error() {
    let Ok(conn) = kernkraft_bus::session() else {
        eprintln!("skipped: no session bus");
        return;
    };
    let inv = Invocation {
        argv: vec![],
        cwd: PathBuf::from("/"),
        activation_token: String::new(),
    };
    let name = format!("io.github.verycareful.kern.Nobody{}", std::process::id());
    assert!(forward(&conn, &name, &inv).is_err());
}

#[test]
fn an_answered_open_is_counted_before_the_caller_returns() {
    let (owner_conn, second_conn) = match (kernkraft_bus::session(), kernkraft_bus::session()) {
        (Ok(a), Ok(b)) => (a, b),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("skipped: no session bus: {e}");
            return;
        }
    };
    let name = format!("io.github.verycareful.kern.Count{}", std::process::id());
    let counted = Launches::default();
    let Claim::Owner(launches) = claim(&owner_conn, &name, counted.clone()).unwrap() else {
        panic!("a fresh name must be free");
    };
    let inv = Invocation {
        argv: vec![OsString::from("a.txt")],
        cwd: PathBuf::from("/w"),
        activation_token: String::new(),
    };
    forward(&second_conn, &name, &inv).unwrap();
    // The caller has its answer, and nothing has handled the launch yet:
    // it is pending, so the owner will not exit under it.
    assert_eq!(counted.pending(), 1);
    assert_eq!(launches.recv_timeout(Duration::from_secs(30)).unwrap(), inv);

    // Once the owner agreed to exit, a launch is refused, so the caller
    // fails instead of being told it was taken.
    assert_eq!(counted.finish(), 0);
    assert!(counted.exit_requested());
    assert!(forward(&second_conn, &name, &inv).is_err());
    assert!(launches.try_recv().is_err());
}

#[test]
fn a_restarted_kern_takes_the_name_once_the_old_instance_lets_it_go() {
    let (old_conn, new_conn) = match (kernkraft_bus::session(), kernkraft_bus::session()) {
        (Ok(a), Ok(b)) => (a, b),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("skipped: no session bus: {e}");
            return;
        }
    };
    let name = format!("io.github.verycareful.kern.Restart{}", std::process::id());
    let Claim::Owner(_launches) = claim(&old_conn, &name, Launches::default()).unwrap() else {
        panic!("a fresh name must be free");
    };
    // The old instance exits a moment after the new one starts: its connection closes.
    let exiting = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        drop(old_conn);
    });
    let claimed = claim_when_free(
        &new_conn,
        &name,
        Launches::default(),
        Duration::from_secs(10),
    )
    .unwrap();
    exiting.join().unwrap();
    assert!(matches!(claimed, Claim::Owner(_)));
}

#[test]
fn a_restarted_kern_stops_waiting_for_a_name_that_is_kept() {
    let (old_conn, new_conn) = match (kernkraft_bus::session(), kernkraft_bus::session()) {
        (Ok(a), Ok(b)) => (a, b),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("skipped: no session bus: {e}");
            return;
        }
    };
    let name = format!("io.github.verycareful.kern.Kept{}", std::process::id());
    let Claim::Owner(_launches) = claim(&old_conn, &name, Launches::default()).unwrap() else {
        panic!("a fresh name must be free");
    };
    let wait = Duration::from_millis(300);
    let started = std::time::Instant::now();
    let claimed = claim_when_free(&new_conn, &name, Launches::default(), wait).unwrap();
    assert!(matches!(claimed, Claim::Taken));
    assert!(started.elapsed() >= wait);
}

#[test]
fn launches_are_accepted_again_after_an_exit_that_did_not_happen() {
    let launches = Launches::default();
    assert!(launches.exit_requested());
    assert!(!launches.begin());
    launches.reopen();
    assert!(launches.begin());
}

const BUNDLE_EXE: &str = "/opt/kern/squashfs-root/usr/bin/kern";
const BUNDLE_USR: &str = "/opt/kern/squashfs-root/usr";

#[test]
fn started_in_its_bundle_the_launch_is_where_the_launcher_was_run() {
    let dir = launch_dir(
        Some(PathBuf::from(BUNDLE_USR)),
        Some(Path::new(BUNDLE_EXE)),
        Some(OsStr::new("/home/u/dotfiles")),
    );
    assert_eq!(dir, PathBuf::from("/home/u/dotfiles"));
}

#[test]
fn started_elsewhere_the_working_directory_stands_whatever_owd_says() {
    let dir = launch_dir(
        Some(PathBuf::from("/home/u/dotfiles")),
        Some(Path::new(BUNDLE_EXE)),
        Some(OsStr::new("/somewhere/else")),
    );
    assert_eq!(dir, PathBuf::from("/home/u/dotfiles"));
}

#[test]
fn a_program_that_is_not_in_a_bundle_keeps_its_working_directory() {
    for exe in ["/usr/bin/kern", "/opt/kern/bin/kern", "/opt/kern/usr/kern"] {
        let dir = launch_dir(
            Some(PathBuf::from("/opt/kern/usr")),
            Some(Path::new(exe)),
            Some(OsStr::new("/home/u")),
        );
        assert_eq!(dir, PathBuf::from("/opt/kern/usr"), "{exe}");
    }
}

#[test]
fn in_its_bundle_without_a_usable_owd_the_working_directory_stands() {
    for owd in [None, Some(OsStr::new("relative/dir")), Some(OsStr::new(""))] {
        let dir = launch_dir(
            Some(PathBuf::from(BUNDLE_USR)),
            Some(Path::new(BUNDLE_EXE)),
            owd,
        );
        assert_eq!(dir, PathBuf::from(BUNDLE_USR));
    }
}

#[test]
fn a_working_directory_that_could_not_be_read_is_empty() {
    assert_eq!(
        launch_dir(
            None,
            Some(Path::new(BUNDLE_EXE)),
            Some(OsStr::new("/home/u"))
        ),
        PathBuf::new()
    );
    assert_eq!(launch_dir(None, None, None), PathBuf::new());
}
