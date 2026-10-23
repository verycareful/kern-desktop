# Kern Desktop
<!-- Shell and language -->
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021%20edition-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
<!-- Frontend -->
[![React](https://img.shields.io/badge/React-19.1-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
<!-- Tests -->
[![Vitest](https://img.shields.io/badge/Vitest-3-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-1.49-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
<!-- Release -->
[![Version](https://img.shields.io/badge/Version-0.1.0.0.12-informational?style=flat-square)](VERSION)
<!-- Licence and status -->
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Early%20Development-orange?style=flat-square)](#)

Kern Desktop is Kern for Linux: a file manager and document app built on
Tauri 2, with a React and TypeScript interface and a Rust backend. It will
read and write files in place, it never touches the network, and it follows
the system theme.

Kern Desktop is in alpha. At this stage the window opens and shows an empty
shell; the file manager, tabs and editor come in later versions.

## Building

```bash
npm ci
npx tauri dev                       # run in development
npx tauri build --bundles deb       # build a package
```

Building needs the WebKitGTK 4.1 development files, GTK 3 and
librsvg (on Debian and Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev
libayatana-appindicator3-dev librsvg2-dev`).

## Testing

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npx vitest run
npx playwright test
```

## License

Copyright (c) 2026 Sricharan Suresh (github.com/verycareful).

Kern Desktop is licensed under the GNU Affero General Public License,
version 3 or later (see [LICENSE](LICENSE)). You may use, study, modify and
redistribute it, including commercially. If you distribute it or a modified
version, you must do so under the same licence, provide the corresponding
source, keep the copyright and licence notices and state your changes. If you
let others use a modified version over a network, you must offer them its
source as well. There is no warranty.
