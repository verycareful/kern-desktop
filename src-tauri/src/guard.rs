// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

//! Keeps every webview on Kern's own page. A file dropped where the page does
//! not take it, or a link that is followed, would otherwise make the webview
//! navigate away from the application to that file or site. The rule is
//! [`crate::drop_rule::navigation_allowed`]; a refused navigation does nothing.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

use crate::drop_rule::navigation_allowed;

/// The plugin that refuses every navigation but the application's own origin
/// (and the dev server's, in a development run). Register it before the first
/// window is created.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("kern-guard")
        .on_navigation(|webview, url| {
            let dev = if cfg!(dev) {
                webview.app_handle().config().build.dev_url.clone()
            } else {
                None
            };
            navigation_allowed(url, dev.as_ref())
        })
        .build()
}
