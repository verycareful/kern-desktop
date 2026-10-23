// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Files for their default applications, with and without a window: the
//! same arguments start the same launches whether `prelaunch` handles them
//! or a running Kern does.
//!
//! Nothing real is started. This test binary points `PATH` at one stub
//! script that records its arguments, and the XDG variables at a temp tree
//! holding the MIME database (Shared MIME-info Database 0.21, `globs2` is
//! `weight:type:glob`), one application (Desktop Entry Specification 1.5,
//! `%F` is every file in one launch) and the `mimeapps.list` making it the
//! default for PNG images (MIME Applications Associations 1.0.1). The
//! variables are set once, before any test builds an app or reads them.

mod common;

use std::ffi::OsString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use common::env;
use kern_lib::instance::Invocation;
use serde_json::json;

const GLOBS2: &str = "50:text/plain:*.txt\n50:image/png:*.png\n";

struct Xdg {
    log: PathBuf,
    _dir: tempfile::TempDir,
}

fn xdg() -> &'static Xdg {
    static ONCE: OnceLock<Xdg> = OnceLock::new();
    ONCE.get_or_init(|| {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let (bin, log, home) = (root.join("bin"), root.join("log"), root.join("home"));
        let (data, config, empty) = (root.join("data"), root.join("config"), root.join("empty"));
        for d in [&bin, &log, &home, &empty, &data.join("mime")] {
            fs::create_dir_all(d).unwrap();
        }
        fs::create_dir_all(data.join("applications")).unwrap();
        fs::create_dir_all(&config).unwrap();
        fs::write(data.join("mime/globs2"), GLOBS2).unwrap();
        fs::write(
            data.join("applications/viewer.desktop"),
            "[Desktop Entry]\nType=Application\nName=Viewer\nExec=rec-open %F\nMimeType=image/png;\n",
        )
        .unwrap();
        fs::write(
            config.join("mimeapps.list"),
            "[Default Applications]\nimage/png=viewer.desktop\n",
        )
        .unwrap();
        // Builtins only, as PATH holds nothing else. END marks the record
        // complete.
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" END > '{}/rec-open.'$$\n",
            log.display()
        );
        let stub = bin.join("rec-open");
        fs::write(&stub, script).unwrap();
        fs::set_permissions(&stub, fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("PATH", &bin);
        std::env::set_var("HOME", &home);
        std::env::set_var("XDG_DATA_HOME", &data);
        std::env::set_var("XDG_CONFIG_HOME", &config);
        std::env::set_var("XDG_DATA_DIRS", &empty);
        std::env::set_var("XDG_CONFIG_DIRS", &empty);
        std::env::remove_var("XDG_CURRENT_DESKTOP");
        std::env::remove_var("TERMINAL");
        Xdg { log, _dir: dir }
    })
}

/// The launches recorded whose arguments are under `dir`, each as its
/// argument list, once `count` are complete or the wait is over.
fn launches(dir: &Path, count: usize) -> Vec<Vec<String>> {
    let marker = dir.to_string_lossy().into_owned();
    let end = Instant::now() + Duration::from_secs(30);
    loop {
        let mut found = Vec::new();
        for entry in fs::read_dir(&xdg().log).unwrap() {
            let text = fs::read_to_string(entry.unwrap().path()).unwrap_or_default();
            let lines: Vec<String> = text.lines().map(str::to_owned).collect();
            if lines.last().map(String::as_str) == Some("END")
                && lines.iter().any(|l| l.starts_with(&marker))
            {
                found.push(lines[..lines.len() - 1].to_vec());
            }
        }
        if found.len() >= count || Instant::now() > end {
            found.sort();
            return found;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// No launch names a file under `dir`. A launch is started before the
/// call returns; the stub is given time to write before the look.
fn no_launches(dir: &Path) -> bool {
    std::thread::sleep(Duration::from_millis(300));
    launches(dir, 0).is_empty()
}

fn file(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let p = dir.join(name);
    fs::write(&p, bytes).unwrap();
    p
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Two images, and a file no application is the default for: no name
/// match and NUL bytes make it `application/octet-stream`.
fn files(dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
    fs::create_dir_all(dir).unwrap();
    (
        file(dir, "a.png", b"png"),
        file(dir, "b.png", b"png"),
        file(dir, "blob", b"\0\0\0"),
    )
}

#[test]
fn a_running_kern_starts_default_apps_in_one_launch() {
    xdg();
    let e = env(Duration::from_secs(5));
    let dir = e.files.join("grouped");
    let (a, b, _) = files(&dir);
    let notes = file(&dir, "notes.txt", b"text\n");
    let out = e.open(&[&a, &notes, &b], "outside", "default");
    let actions: Vec<_> = out.iter().map(|o| o["action"].clone()).collect();
    assert_eq!(
        actions,
        [
            json!("default_app"),
            json!("doc_window"),
            json!("default_app")
        ]
    );
    // %F: both images in one launch, as `open_default` groups them.
    assert_eq!(launches(&dir, 1), vec![vec![s(&a), s(&b)]]);
}

#[test]
fn a_running_kern_opens_default_apps_all_or_nothing() {
    xdg();
    let e = env(Duration::from_secs(5));
    let dir = e.files.join("none");
    let (a, _, blob) = files(&dir);
    let out = e.open(&[&a, &blob], "outside", "default");
    // The blob has no default application, so the image is not opened
    // either, and both say so.
    for o in &out {
        assert_eq!(o["action"], json!("failed"), "{out:?}");
        assert_eq!(o["error"]["kind"], json!("NoDefaultApp"), "{out:?}");
    }
    assert!(no_launches(&dir));
}

#[test]
fn without_a_running_kern_the_same_launches_happen() {
    xdg();
    let t = tempfile::tempdir().unwrap();
    let inv = |dir: &Path, argv: Vec<OsString>| Invocation {
        argv,
        cwd: dir.to_path_buf(),
        activation_token: String::new(),
    };
    let dir = t.path().canonicalize().unwrap().join("pre");
    let (a, b, blob) = files(&dir);
    let run = |argv: Vec<OsString>| kern_lib::prelaunch::run(&inv(&dir, argv));
    assert_eq!(run(vec![a.clone().into(), blob.into()]), Some(1));
    assert!(no_launches(&dir));
    assert_eq!(run(vec![a.clone().into(), b.clone().into()]), Some(0));
    assert_eq!(launches(&dir, 1), vec![vec![s(&a), s(&b)]]);
}
