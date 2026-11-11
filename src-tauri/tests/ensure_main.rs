// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! `ensure_main`: callers that reach it at the same moment (Kern's own first launch and a
//! request that arrived on the bus while it started) get one `main` window between them, and
//! every call succeeds.

mod common;

use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;

use common::env;
use kern_lib::windows::ensure_main;

const CALLERS: usize = 8;
/// Each round is a fresh app with no `main` yet: one round only sometimes catches a race.
const ROUNDS: usize = 40;

#[test]
fn callers_at_the_same_moment_make_one_main_window_and_all_succeed() {
    for round in 0..ROUNDS {
        let e = env(Duration::from_secs(5));
        let start = Arc::new(Barrier::new(CALLERS));
        let callers: Vec<_> = (0..CALLERS)
            .map(|_| {
                let app = e.handle.clone();
                let start = Arc::clone(&start);
                thread::spawn(move || {
                    start.wait();
                    ensure_main(&app)
                })
            })
            .collect();
        let results: Vec<_> = callers.into_iter().map(|c| c.join().unwrap()).collect();
        assert!(
            results.iter().all(Result::is_ok),
            "round {round}: {results:?}"
        );
        let created = results.iter().filter(|r| matches!(r, Ok(true))).count();
        assert_eq!(created, 1, "round {round}: {results:?}");
        assert!(e.exists("main"), "round {round}");
    }
}

#[test]
fn a_call_when_main_exists_creates_nothing() {
    let e = env(Duration::from_secs(5));
    assert!(ensure_main(&e.handle).unwrap());
    assert!(!ensure_main(&e.handle).unwrap());
    assert!(e.exists("main"));
}
