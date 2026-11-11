# Kern Desktop
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021%20edition-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![kernkraft](https://img.shields.io/badge/kernkraft-0.1.1.0-5A4FCF?style=flat-square)](https://github.com/verycareful/kernkraft)
[![GTK](https://img.shields.io/badge/GTK-3-7FE719?style=flat-square&logo=gtk&logoColor=white)](https://www.gtk.org/)
[![zbus](https://img.shields.io/badge/zbus-5-4A86CF?style=flat-square)](https://github.com/dbus2/zbus)
[![React](https://img.shields.io/badge/React-19.1-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Zustand](https://img.shields.io/badge/Zustand-5-453F39?style=flat-square)](https://zustand.docs.pmnd.rs/)
[![TanStack Virtual](https://img.shields.io/badge/TanStack%20Virtual-3.14-FF4154?style=flat-square)](https://tanstack.com/virtual)
[![Lucide](https://img.shields.io/badge/Lucide-1.61-F56565?style=flat-square&logo=lucide&logoColor=white)](https://lucide.dev/)
[![CodeMirror](https://img.shields.io/badge/CodeMirror-6-D30707?style=flat-square)](https://codemirror.net/)
[![Outfit](https://img.shields.io/badge/Outfit-5.3-lightgrey?style=flat-square)](https://fontsource.org/fonts/outfit)
[![Quicksand](https://img.shields.io/badge/Quicksand-5.3-lightgrey?style=flat-square)](https://fontsource.org/fonts/quicksand)
[![IBM Plex Mono](https://img.shields.io/badge/IBM%20Plex%20Mono-5.3-lightgrey?style=flat-square)](https://fontsource.org/fonts/ibm-plex-mono)
[![Sora](https://img.shields.io/badge/Sora-5.3-lightgrey?style=flat-square)](https://fontsource.org/fonts/sora)
[![Vitest](https://img.shields.io/badge/Vitest-3-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-1.49-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
[![WebdriverIO](https://img.shields.io/badge/WebdriverIO-10.1-EA5906?style=flat-square&logo=webdriverio&logoColor=white)](https://webdriver.io/)
[![ESLint](https://img.shields.io/badge/ESLint-9-4B32C3?style=flat-square&logo=eslint&logoColor=white)](https://eslint.org/)
[![Prettier](https://img.shields.io/badge/Prettier-3-F7B93E?style=flat-square&logo=prettier&logoColor=black)](https://prettier.io/)
[![Python](https://img.shields.io/badge/Python-3-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![deb](https://img.shields.io/badge/deb-package-A81D33?style=flat-square&logo=debian&logoColor=white)](https://github.com/verycareful/kern-desktop/releases)
[![AppImage](https://img.shields.io/badge/AppImage-package-4A86CF?style=flat-square)](https://github.com/verycareful/kern-desktop/releases)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2Fverycareful%2Fkern-desktop%2Freleases%2Flatest&query=%24.tag_name&label=Version&color=informational&style=flat-square)](https://github.com/verycareful/kern-desktop/releases)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Early%20Development-orange?style=flat-square)](#)

<!-- Plain badges, no shields.io logo yet: kernkraft, zbus, Zustand, TanStack Virtual, CodeMirror,
Outfit, Quicksand, IBM Plex Mono, Sora, AppImage. Swap each for a logo badge if one appears.
The Version badge reads the tag of the latest release, as written (no prefix). -->

Kern Desktop is Kern for Linux: a file manager and a text editor in one app.
It runs on Tauri 2, with a React and TypeScript interface over a Rust backend,
and keeps its file and format logic in [kernkraft](https://github.com/verycareful/kernkraft),
the core it shares with Kern for Android. Kern edits your files where they
are, opens no network connection and takes its look from your desktop theme.

Kern Desktop is in alpha.

## What it does

- **Folders.** You get list and grid views, sorting, multi-select, a breadcrumb
  and an editable location bar, and hidden files when you ask for them. The
  view refreshes when something changes on disk. A toolbar over the folder
  holds Back, Forward and Up, New folder, Search, Open terminal here, the view
  switches and Open as editor. Folders open in tabs, and you can move a tab to
  a window of its own.
- **File operations.** Create, rename in place, cut, copy and paste through the
  system clipboard, so other file managers can take part. Trash files, or
  delete them for good after a question. Copies and moves run in the
  background with progress, a Cancel button, a prompt for name conflicts and a
  report of anything skipped or failed. Undo and redo cover the last
  operations. A drag moves files that sit on the same disk as the target folder
  and copies the rest; hold Ctrl to copy or Shift to move. When you drop files
  from another application, the pointer shows what Kern will do before you let
  go.
- **Places, pins and recents.** The strip on the left lists Home, your user
  folders, Volumes (mount, unmount, eject), the Trash (restore, delete
  permanently, empty) and the Library, which gathers your documents from the
  folders you choose in Settings. A single click opens an entry in the strip;
  in the right panel, the folder view and the editor's file tree it takes a
  double-click. Settings > Files sets single or double click for each of the
  four, and Enter and Space open in all of them. Pinned
  folders and files and your recent files sit in a panel on the right that you
  can resize. Pin a folder as an editor and it opens in an editor window.
- **Finding and inspecting.** Search by name under a folder, open Properties
  (size, item counts, permissions), copy a path, open a file with any installed
  application, or open a terminal in the folder. Search results and the Library
  list each file with its type, size, time and the folder it is in, and once the
  walk has finished a click on a column header sorts them. The Library has a
  filter by name, a list or card view, and a switch for hidden items.
- **Text editor.** A text file opens in a tab with line numbers, find and
  replace, and undo. Saving keeps the file's line endings and byte order mark.
  If another program changed or deleted the file, Kern asks before it writes.
  A file with mixed line endings, a file that is not UTF-8 and a very large
  file open read-only. A file you open from outside Kern gets a window of its
  own, and its Home button moves it into the main window.
- **Editor windows.** Open as editor gives a folder its own window, with a
  folder tree beside your documents. The tree's menu carries the file
  operations, and its heading holds search, the terminal, hidden files, the
  sort order (name, size, date modified or type, either way round) and
  collapse or expand all. F4 opens a terminal in the tree's folder, or in the
  folder of the row the pointer is over. Each folder has one editor window:
  open the folder again and that window comes forward. A file opened from
  inside an editor window moves into it, from whichever window held it. A file
  opened any other way (from a folder, the command line or another app) brings
  forward the window that already has it, so Kern never opens a file twice.
  The main window is always a file manager.
- **Windows from last time.** Kern starts with a fresh main window at your New
  tab folder (Home unless you choose another in Settings). When the last
  session left windows worth reopening, a bar at the top offers to restore
  them.
- **Settings.** Settings opens in a window of its own, with a search field.
  Changes wait for Save, and Revert drops them.
- **Keys and mouse.** Settings > Keys and mouse lists every action with the
  keys and mouse buttons that run it. Any action can take any key, or a mouse
  button (middle click, back, forward, or a click with Ctrl, Alt, Shift or Meta
  held), and one that another action holds is moved only after you agree. A
  change applies at once in every window. The binds are kept in `binds.json`
  in Kern's config folder, apart from the settings, and Reset all binds
  deletes it.
- **Desktop integration.** Kern follows the system theme: colours, accent,
  fonts and corner radius from Hyprland, the desktop portal, GTK and
  fontconfig, each with its own switch in Settings. It installs a desktop
  entry for folders and every text type the system knows. You can make it the
  default file manager, so other programs' "Show in folder" opens in Kern. A
  second launch hands its files to the running instance over D-Bus.
- **No network.** Kern opens no network connection, in its code, its
  dependencies or its packaging. CI checks the release binary for it.

The other document formats of Kern for Android (spreadsheets, Word and
PowerPoint files, PDF, EPUB) come in later versions.

## Installing

```bash
curl -fsSL https://raw.githubusercontent.com/verycareful/kern-desktop/main/install.sh | bash
```

The installer shows what Kern is, then asks its questions with arrow-key
menus: whether Kern is for you alone (no administrator password) or for
everyone on the computer, every setting from the Settings window, whether
Kern becomes the default file manager, and whether to start it. Nothing
changes until the last question is answered. It downloads the latest release
from GitHub and checks every file against the release's `SHA256SUMS` before
installing anything. The installer is the only part that uses the network;
Kern itself never does.

Run it again when Kern is installed to update to a newer release (your
settings, pins and recents stay as they are) or to reinstall from scratch,
choosing whether to keep your settings and whether to clear pins and recents.
Anything a reinstall replaces is moved to a `.backup-<time>` file beside it.

- `--defaults` installs for you alone with the default settings and asks
  nothing; on an installed Kern it updates when a newer release exists.
- `--from DIR` installs from release files you have already downloaded
  (`SHA256SUMS`, the deb, the AppImage and `uninstall.sh`), with no network.

For you alone, the AppImage is unpacked under `~/.local/lib/kern`, so it needs
no FUSE, with `~/.local/bin/kern` and the menu entry under `~/.local/share`.
For everyone, Debian and Ubuntu get the deb through apt; other distributions
get the unpacked AppImage under `/opt/kern`.

To remove Kern:

```bash
bash ~/.local/lib/kern/uninstall.sh   # or /opt/kern/uninstall.sh
```

It asks whether to keep Kern's settings, pins and recents or delete them, and
gives the default file manager back to the one Kern replaced.

## Building

```bash
npm ci --ignore-scripts
npx tauri dev                       # run in development
npx tauri build --bundles deb       # build a package
```

You need Rust, Node.js 22 and the system libraries Tauri builds against:

- Debian and Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev
  libayatana-appindicator3-dev librsvg2-dev`
- Arch and its derivatives: `webkit2gtk-4.1 gtk3 libayatana-appindicator
  librsvg`

## Testing

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npx vitest run
npx playwright test
e2e-app/run.sh
```

`e2e-app/run.sh` builds the debug binary and drives it through `tauri-driver`
and WebKitWebDriver, under `xvfb-run` and `dbus-run-session`. Install
`tauri-driver` with `cargo install tauri-driver --locked`; WebKitWebDriver
comes in `webkit2gtk-driver` on Debian and Ubuntu and in `webkitgtk-6.0` on
Arch. Each spec file gets its own session bus and home directory, so a run
leaves your session alone. Worlds and logs go to `src-tauri/target/e2e-app-runs/`,
or to the directory you set in `KERN_E2E_RUNS`.

The checks CI runs as gates:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npx tsc --noEmit
npx tsc -p tsconfig.node.json
npx tsc -p e2e-app
npx eslint . --max-warnings 0
npx prettier --check .
```

For the no-network check, `scripts/trace-in-empty-netns.sh` runs a command
under `strace` in a network namespace with no interfaces, and
`scripts/inet_calls.py` fails on any `connect`, `sendto`, `sendmsg` or
`sendmmsg` to an IPv4 or IPv6 address. CI runs both on the release binary,
after a control run that must trip them.

## Versioning

Kern Desktop numbers its versions `A.B.C.D`. Each release has a git tag with
the bare number (`0.1.0.0`, no `v`), and the Version badge above shows the tag
of the latest release. The [releases page](https://github.com/verycareful/kern-desktop/releases)
carries the deb and the AppImage for each one.

## License

Copyright (c) 2026 Sricharan Suresh (github.com/verycareful).

Kern Desktop is licensed under the GNU Affero General Public License,
version 3 or later (see [LICENSE](LICENSE)). You may use, study, modify and
redistribute it, including commercially. If you distribute it or a modified
version, you must do so under the same licence, provide the corresponding
source, keep the copyright and licence notices and state your changes. If you
let others use a modified version over a network, you must offer them its
source as well. There is no warranty.
