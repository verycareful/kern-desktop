// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { convertFileSrc } from "@tauri-apps/api/core";
import type { WirePath } from "./wire-path";

// The URL under which the webview can load a local file through Tauri's asset
// protocol (CSP img-src allows asset:). The protocol is scoped in
// tauri.conf.json to the thumbnail cache only. A path that is not valid UTF-8
// has no URL form, so it is refused rather than altered.
export function assetUrl(path: WirePath): string {
  if (path.k !== "Utf8") {
    throw new RangeError("a path that is not valid UTF-8 has no asset URL");
  }
  return convertFileSrc(path.v);
}
