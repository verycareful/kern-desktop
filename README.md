# Kern Desktop
<!-- Shell and language -->
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021%20edition-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
<!-- Frontend (swap the Zustand, TanStack Virtual and CodeMirror badges for logo badges if shields.io adds them) -->
[![React](https://img.shields.io/badge/React-19.1-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Zustand](https://img.shields.io/badge/Zustand-5-453F39?style=flat-square)](https://zustand.docs.pmnd.rs/)
[![TanStack Virtual](https://img.shields.io/badge/TanStack%20Virtual-3.14-FF4154?style=flat-square)](https://tanstack.com/virtual)
[![Lucide](https://img.shields.io/badge/Lucide-1.61-F56565?style=flat-square&logo=lucide&logoColor=white)](https://lucide.dev/)
[![CodeMirror](https://img.shields.io/badge/CodeMirror-6-D30707?style=flat-square)](https://codemirror.net/)
<!-- Fonts (bundled; swap each for a logo badge if shields.io adds one) -->
[![Outfit](https://img.shields.io/badge/Outfit-5.3-lightgrey?style=flat-square)](https://fontsource.org/fonts/outfit)
[![Quicksand](https://img.shields.io/badge/Quicksand-5.3-lightgrey?style=flat-square)](https://fontsource.org/fonts/quicksand)
[![IBM Plex Mono](https://img.shields.io/badge/IBM%20Plex%20Mono-5.3-lightgrey?style=flat-square)](https://fontsource.org/fonts/ibm-plex-mono)
[![Sora](https://img.shields.io/badge/Sora-5.3-lightgrey?style=flat-square)](https://fontsource.org/fonts/sora)
<!-- Tests -->
[![Vitest](https://img.shields.io/badge/Vitest-3-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-1.49-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
[![WebdriverIO](https://img.shields.io/badge/WebdriverIO-10.1-EA5906?style=flat-square&logo=webdriverio&logoColor=white)](https://webdriver.io/)
<!-- Release -->
[![Version](https://img.shields.io/badge/Version-0.1.0.0.86-informational?style=flat-square)](VERSION)
<!-- Licence and status -->
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Early%20Development-orange?style=flat-square)](#)

Kern Desktop is Kern for Linux: a file manager and document app built on
Tauri 2, with a React and TypeScript interface and a Rust backend. It reads
and writes files in place, never touches the network, and follows the system
theme.

Kern Desktop is in alpha: version 0.1.0.0 is a file manager and a text
editor. What it does today:

- **Folders.** List and grid views, sorting, selection, a breadcrumb and an
  editable location bar, hidden files on demand, and live refresh when
  something changes on disk. Back, forward and up, tabs, and "Move to new
  window".
- **File operations.** Create, rename in place, cut, copy and paste through
  the system clipboard (other file managers can take part), move to the Trash,
  and delete for good after a question. Copies and moves run in the background
  with progress, cancel, a name-conflict prompt and a report of anything
  skipped or failed; the last operations can be undone and redone. A drag moves
  files that are on the same disk as the folder and copies the others (Ctrl
  copies, Shift moves), and a drop from another application shows what it will
  do before it lands.
- **Places.** Home and your user folders, Volumes (mount, unmount, eject), the
  Trash (restore, delete permanently, empty), and the Library, which gathers
  your documents from the folders you choose in Settings. Pinned folders and
  recent files sit in their own panel.
- **Finding and inspecting.** Name search under a folder, Properties (size and
  item counts, permissions), Copy path, Open with any installed application,
  and Open terminal here.
- **Text editor.** A text file opens in a tab with line numbers, find and
  replace and undo. Saving keeps its line endings and byte order mark, asks
  before it writes over a file another program changed or deleted, and a file
  that mixes line endings, is not UTF-8 or is too large opens read-only. A file
  opened from outside Kern gets a window of its own; Home moves it into the main
  window.
- **Editor layout.** A window can switch to an editor layout with a folder tree
  beside the document, and "Open as editor" opens a folder in a window of that
  kind. A file open in one window is focused, never opened twice.
- **Desktop integration.** Kern follows the system theme (colours, accent,
  fonts and corner radius from Hyprland, the desktop portal, GTK and
  fontconfig), each part with its own switch in Settings. It installs a desktop
  entry for folders and every text type the system knows, can be set as the
  default file manager (other programs' "Show in folder" opens in Kern), and a
  second launch hands its files to the running window.
- **No network.** Kern opens no network connection, in its code, its
  dependencies or its packaging.

The other document formats of Kern for Android (spreadsheets, Word and
PowerPoint files, PDF, EPUB) come in later versions.

## Building

```bash
npm ci --ignore-scripts
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
e2e-app/run.sh
```

`e2e-app/run.sh` builds the debug binary and drives it through `tauri-driver`
and WebKitWebDriver (`cargo install tauri-driver --locked`; WebKitWebDriver is
in `webkit2gtk-driver` on Debian and Ubuntu and in `webkitgtk-6.0` on Arch),
with `xvfb-run` and `dbus-run-session`. Each spec file runs on a session bus
and in a home directory of its own, so it never touches the running session.
The worlds and logs go to `src-tauri/target/e2e-app-runs/`, or to the directory
in `KERN_E2E_RUNS`.

The no-network check is `scripts/trace-in-empty-netns.sh`, which runs a command
under `strace` in a network namespace with no interfaces, and
`scripts/inet_calls.py`, which fails on any `connect`, `sendto`, `sendmsg` or
`sendmmsg` to an IPv4 or IPv6 address. CI runs it on the release binary after
a control that must trip it.

## License

Copyright (c) 2026 Sricharan Suresh (github.com/verycareful).

Kern Desktop is licensed under the GNU Affero General Public License,
version 3 or later (see [LICENSE](LICENSE)). You may use, study, modify and
redistribute it, including commercially. If you distribute it or a modified
version, you must do so under the same licence, provide the corresponding
source, keep the copyright and licence notices and state your changes. If you
let others use a modified version over a network, you must offer them its
source as well. There is no warranty.
