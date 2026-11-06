#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# Kern never touches the network. Fails if a tracked Rust source names a
# socket API, or a frontend source under src/ names a network global. The
# ESLint and cargo-deny bans are the first line; this is the second.

set -euo pipefail

cd "$(dirname "$0")/.."

status=0

# Rust: the std and crate socket APIs.
rust_pattern='std::net|TcpStream|UdpSocket|TcpListener|socket2'
if git ls-files -co --exclude-standard -- 'src-tauri/**/*.rs' 'src-tauri/*.rs' \
    | xargs -r grep -nE "$rust_pattern"; then
    echo "error: Rust source names a socket API" >&2
    status=1
fi

# Frontend: the network globals, as whole words.
web_pattern='\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b|navigator\.sendBeacon'
if git ls-files -co --exclude-standard -- 'src/**/*.ts' 'src/**/*.tsx' 'src/*.ts' 'src/*.tsx' \
    | xargs -r grep -nE "$web_pattern"; then
    echo "error: frontend source names a network global" >&2
    status=1
fi

[[ $status -eq 0 ]] && echo "ok: no network APIs in source"
exit "$status"
