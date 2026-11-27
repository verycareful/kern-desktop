// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! What happens to a PDF's file when saving fails, through the commands as the webview sends them
//! (the kernkraft plugin with the application's own capabilities). The file is never lost: a save
//! the disk refuses leaves the original as it was, with nothing beside it, and a file changed under
//! the app is not written over.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

/// A time to stamp a save with: a PDF date.
const DATE: &str = "D:20261126103000Z";

struct Env {
    dir: tempfile::TempDir,
    _app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
}

fn env() -> Env {
    let app = mock_builder()
        .plugin(kernkraft_tauri::init())
        .build(tauri::generate_context!())
        .unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    Env {
        dir: tempfile::tempdir().unwrap(),
        _app: app,
        window,
    }
}

fn invoke(env: &Env, cmd: &str, args: Value) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: format!("plugin:{}|{cmd}", kernkraft_tauri::PLUGIN_NAME),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(&env.window, request).map(|body| body.deserialize::<Value>().unwrap())
}

/// A path as the webview sends it.
fn wire(path: &Path) -> Value {
    json!({ "k": "Utf8", "v": path.to_str().unwrap() })
}

/// A one-page PDF with a correct cross-reference table, so it opens without being repaired.
fn one_page_pdf() -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (n, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{body}\nendobj\n", n + 1).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}

/// A PDF in a folder of its own, opened and rotated: the handle and the stamp it was opened with.
struct Opened {
    folder: PathBuf,
    file: PathBuf,
    original: Vec<u8>,
    handle: i64,
    stamp: Value,
}

fn opened_and_rotated(e: &Env) -> Opened {
    let folder = e.dir.path().join("work");
    fs::create_dir(&folder).unwrap();
    let file = folder.join("book.pdf");
    let original = one_page_pdf();
    fs::write(&file, &original).unwrap();
    let opened = invoke(e, "pdf_open", json!({ "path": wire(&file) })).unwrap();
    let handle = opened["handle"].as_i64().unwrap();
    invoke(
        e,
        "pdf_apply",
        json!({ "handle": handle, "op": { "op": "rotate", "pages": [1], "degrees": 90 } }),
    )
    .unwrap();
    Opened {
        folder,
        file,
        original,
        handle,
        stamp: opened["stamp"].clone(),
    }
}

/// Makes the folder refuse new entries; false when this process is not held back by it (it runs
/// as a user the permission bits do not bind), in which case the test has nothing to show.
fn read_only(folder: &Path) -> bool {
    fs::set_permissions(folder, fs::Permissions::from_mode(0o555)).unwrap();
    let probe = folder.join(".probe");
    if fs::File::create(&probe).is_ok() {
        fs::remove_file(&probe).unwrap();
        fs::set_permissions(folder, fs::Permissions::from_mode(0o755)).unwrap();
        eprintln!("skipped: this user can write into a read-only folder");
        return false;
    }
    true
}

fn entries(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

#[test]
fn pdf_save_to_a_full_or_read_only_target_leaves_the_original_intact() {
    let e = env();
    let o = opened_and_rotated(&e);
    if !read_only(&o.folder) {
        return;
    }
    // The save writes beside the file and renames over it, so a folder that takes no new entry
    // stops it before the file is touched.
    let refused = invoke(
        &e,
        "pdf_save",
        json!({ "handle": o.handle, "path": wire(&o.file),
                "expect": { "kind": "unchanged", "stamp": o.stamp }, "modified": DATE }),
    );
    fs::set_permissions(&o.folder, fs::Permissions::from_mode(0o755)).unwrap();
    let err = refused.unwrap_err();
    assert!(err["kind"].is_string(), "{err}");
    assert_ne!(err["kind"], "ExternalModification", "{err}");
    assert_eq!(fs::read(&o.file).unwrap(), o.original);
    assert_eq!(
        entries(&o.folder),
        ["book.pdf"],
        "nothing is left beside the file"
    );

    // The document is still open and unchanged by the failure: the same save, once the folder
    // takes files again, writes it.
    invoke(
        &e,
        "pdf_save",
        json!({ "handle": o.handle, "path": wire(&o.file),
                "expect": { "kind": "unchanged", "stamp": o.stamp }, "modified": DATE }),
    )
    .unwrap();
    let written = fs::read(&o.file).unwrap();
    assert!(written.starts_with(&o.original));
    assert!(written.len() > o.original.len());
}

#[test]
fn save_as_into_a_read_only_folder_creates_nothing() {
    let e = env();
    let o = opened_and_rotated(&e);
    let target_folder = e.dir.path().join("locked");
    fs::create_dir(&target_folder).unwrap();
    if !read_only(&target_folder) {
        return;
    }
    let target = target_folder.join("copy.pdf");
    let refused = invoke(
        &e,
        "pdf_save",
        json!({ "handle": o.handle, "path": wire(&target),
                "expect": { "kind": "nothing" }, "modified": DATE }),
    );
    fs::set_permissions(&target_folder, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(refused.is_err());
    assert!(entries(&target_folder).is_empty());
    assert_eq!(fs::read(&o.file).unwrap(), o.original);
}

#[test]
fn a_file_changed_since_it_was_opened_is_not_written_over() {
    let e = env();
    let o = opened_and_rotated(&e);
    let mut theirs = o.original.clone();
    theirs.extend_from_slice(b"% another program wrote this\n");
    fs::write(&o.file, &theirs).unwrap();
    let err = invoke(
        &e,
        "pdf_save",
        json!({ "handle": o.handle, "path": wire(&o.file),
                "expect": { "kind": "unchanged", "stamp": o.stamp }, "modified": DATE }),
    )
    .unwrap_err();
    assert_eq!(err["kind"], "ExternalModification", "{err}");
    assert_eq!(fs::read(&o.file).unwrap(), theirs);
    assert_eq!(entries(&o.folder), ["book.pdf"]);
}

#[test]
fn save_as_never_replaces_a_file_that_is_there() {
    let e = env();
    let o = opened_and_rotated(&e);
    let target = o.folder.join("other.pdf");
    fs::write(&target, b"not yours").unwrap();
    let err = invoke(
        &e,
        "pdf_save",
        json!({ "handle": o.handle, "path": wire(&target),
                "expect": { "kind": "nothing" }, "modified": DATE }),
    )
    .unwrap_err();
    assert!(err["kind"].is_string(), "{err}");
    assert_eq!(fs::read(&target).unwrap(), b"not yours");
}

#[test]
fn a_compacted_copy_of_a_file_is_a_new_file_and_never_over_one() {
    let e = env();
    let o = opened_and_rotated(&e);
    let out = o.folder.join("book_compacted.pdf");
    let source = json!({ "path": wire(&o.file) });
    let written = invoke(
        &e,
        "pdf_compact_file",
        json!({ "source": source, "out": wire(&out) }),
    )
    .unwrap();
    assert!(out.exists(), "{written}");
    assert_eq!(fs::read(&o.file).unwrap(), o.original);
    // The copy opens as a document of its own.
    let opened = invoke(&e, "pdf_open", json!({ "path": wire(&out) })).unwrap();
    assert_eq!(opened["pages"], 1);
    // A second copy to the same name is refused, and what is there stays.
    let before = fs::read(&out).unwrap();
    let err = invoke(
        &e,
        "pdf_compact_file",
        json!({ "source": json!({ "path": wire(&o.file) }), "out": wire(&out) }),
    )
    .unwrap_err();
    assert!(err["kind"].is_string(), "{err}");
    assert_eq!(fs::read(&out).unwrap(), before);
}
