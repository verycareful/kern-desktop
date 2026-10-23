// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The single-instance service over the live session bus. Skipped, with the
//! reason printed, when there is no bus.

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::time::Duration;

use kern_lib::instance::{claim, forward, Claim, Invocation, Launches};

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
