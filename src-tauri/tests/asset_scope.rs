// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! The asset protocol serves the thumbnail cache and nothing else. The scope
//! is read from the real tauri.conf.json and checked the way the protocol
//! handler checks a request (tauri src/protocol/asset.rs): `SafePathBuf`
//! refuses any `..`, then `Scope::is_allowed` resolves symlinks and matches
//! the canonical path against the patterns.

use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;

use tauri::path::SafePathBuf;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::utils::config::AssetProtocolConfig;
use tauri::Manager;

fn scope_for(cache_home: Option<&Path>) -> (tauri::scope::fs::Scope, std::path::PathBuf) {
    match cache_home {
        Some(p) => std::env::set_var("XDG_CACHE_HOME", p),
        None => std::env::remove_var("XDG_CACHE_HOME"),
    }
    let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let asset: AssetProtocolConfig =
        serde_json::from_value(conf["app"]["security"]["assetProtocol"].clone()).unwrap();
    assert!(asset.enable, "the asset protocol is off in tauri.conf.json");
    let mut ctx = mock_context(noop_assets());
    ctx.config_mut().app.security.asset_protocol = asset;
    let app = mock_builder().build(ctx).unwrap();
    let cache = app.path().cache_dir().unwrap();
    (app.asset_protocol_scope(), cache)
}

/// What the protocol handler does with a decoded request path.
fn served(scope: &tauri::scope::fs::Scope, path: &Path) -> bool {
    match SafePathBuf::new(path.to_path_buf()) {
        Ok(safe) => scope.is_allowed(&safe),
        Err(_) => false,
    }
}

// One test: it sets XDG_CACHE_HOME, which is process-wide.
#[test]
fn the_asset_scope_is_the_thumbnail_cache_kernkraft_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().canonicalize().unwrap();
    let cache = root.join("cache");
    let thumbs = cache.join("thumbnails").join("normal");
    fs::create_dir_all(&thumbs).unwrap();
    fs::write(thumbs.join("a.png"), b"png").unwrap();
    fs::write(cache.join("secret.txt"), b"secret").unwrap();
    fs::write(root.join("outside.txt"), b"outside").unwrap();
    symlink(root.join("outside.txt"), thumbs.join("link.png")).unwrap();
    symlink(&cache, root.join("cache-link")).unwrap();

    // With XDG_CACHE_HOME set: Tauri's $CACHE is the directory kernkraft uses.
    let (scope, tauri_cache) = scope_for(Some(&cache));
    assert_eq!(tauri_cache, kernkraft_fs::base_dirs().unwrap().cache);
    assert_eq!(tauri_cache, cache);

    assert!(served(&scope, &thumbs.join("a.png")));
    // Everything else is refused: asset://localhost/%2Fetc%2Fpasswd decodes to this.
    assert!(!served(&scope, Path::new("/etc/passwd")));
    assert!(!served(&scope, &cache.join("secret.txt")));
    assert!(!served(&scope, &root.join("outside.txt")));
    // A `..` is refused whether or not it would stay inside.
    assert!(!served(
        &scope,
        &thumbs.join("..").join("normal").join("a.png")
    ));
    assert!(!served(
        &scope,
        &thumbs.join("..").join("..").join("secret.txt")
    ));
    // A symlink inside thumbnails/ that points outside is refused.
    assert!(!served(&scope, &thumbs.join("link.png")));

    // Without it: both fall back to $HOME/.cache.
    let (_, tauri_cache) = scope_for(None);
    assert_eq!(tauri_cache, kernkraft_fs::base_dirs().unwrap().cache);
}
