// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The interface size applied as webview zoom (design 7.2): at startup, on a
//! change of the stored setting, and to every window created afterwards.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use kern_lib::store::Store;
use kern_lib::store_cmds::StoreState;
use kern_lib::zoom;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::utils::acl::ExecutionContext;
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

struct Env {
    _tmp: tempfile::TempDir,
    config: PathBuf,
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
}

fn env() -> Env {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let (config, state) = (root.join("config"), root.join("state"));
    fs::create_dir_all(&config).unwrap();
    let mut ctx = mock_context(noop_assets());
    for cmd in ["settings_get", "settings_set"] {
        ctx.runtime_authority_mut()
            .__allow_command(cmd.to_owned(), ExecutionContext::Local);
    }
    let app = mock_builder()
        .plugin(zoom::plugin())
        .manage(StoreState::new(Store::new(config.clone(), state)))
        .invoke_handler(tauri::generate_handler![
            kern_lib::store_cmds::settings_get,
            kern_lib::store_cmds::settings_set,
        ])
        .build(ctx)
        .unwrap();
    let window = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    Env {
        _tmp: tmp,
        config,
        app,
        window,
    }
}

impl Env {
    fn call(&self, cmd: &str, args: Value) -> Result<Value, Value> {
        let request = InvokeRequest {
            cmd: cmd.to_owned(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        };
        get_ipc_response(&self.window, request).map(|b| b.deserialize::<Value>().unwrap())
    }

    fn zooms(&self) -> BTreeMap<String, f64> {
        zoom::applied(self.app.handle())
    }

    fn open(&self, label: &str) {
        WebviewWindowBuilder::new(&self.app, label, Default::default())
            .build()
            .unwrap();
    }
}

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn the_factor_is_the_percentage_as_a_fraction() {
    assert!(near(zoom::factor(90), 0.9));
    assert!(near(zoom::factor(125), 1.25));
    assert!(near(zoom::factor(80), 0.8));
}

#[test]
fn a_window_is_zoomed_to_the_default_size_when_it_is_created() {
    let e = env();
    assert_eq!(zoom::current(e.app.handle()), 90);
    assert!(near(e.zooms()["main"], 0.9), "{:?}", e.zooms());
}

#[test]
fn a_changed_setting_zooms_every_open_window_and_every_later_one() {
    let e = env();
    e.open("doc-1");
    e.call("settings_set", json!({"patch": {"interface_size": 125}}))
        .unwrap();
    assert_eq!(zoom::current(e.app.handle()), 125);
    assert!(near(e.zooms()["main"], 1.25));
    assert!(near(e.zooms()["doc-1"], 1.25));
    e.open("doc-2");
    assert!(near(e.zooms()["doc-2"], 1.25), "{:?}", e.zooms());
}

#[test]
fn the_stored_size_is_applied_when_the_settings_are_first_read() {
    let e = env();
    fs::write(e.config.join("settings.json"), r#"{"interface_size": 80}"#).unwrap();
    e.call("settings_get", json!({})).unwrap();
    assert!(near(e.zooms()["main"], 0.8));
}

#[test]
fn a_bad_stored_size_zooms_to_the_default() {
    let e = env();
    e.call("settings_set", json!({"patch": {"interface_size": 110}}))
        .unwrap();
    fs::write(e.config.join("settings.json"), r#"{"interface_size": 77}"#).unwrap();
    e.call("settings_get", json!({})).unwrap();
    assert_eq!(zoom::current(e.app.handle()), 90);
    assert!(near(e.zooms()["main"], 0.9));
}

#[test]
fn a_closed_window_is_forgotten() {
    let e = env();
    e.open("doc-1");
    assert!(e.zooms().contains_key("doc-1"));
    zoom::forget(e.app.handle(), "doc-1");
    assert!(!e.zooms().contains_key("doc-1"), "{:?}", e.zooms());
    assert!(e.zooms().contains_key("main"));
}
