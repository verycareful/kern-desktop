# Changelog - Kern Desktop

All notable changes documented here. Format: [Keep a Changelog](https://keepachangelog.com/), with one deviation: dated release entries are timestamped to the minute with timezone (`YYYY-MM-DD HH:MM (TZ)`).

## [Unreleased]

## [0.1.0.5] - 2026-11-06 19:10 (IST)

### Fixed

- **Editor focus ring**: the accent ring round a focused text editor was missing down its left side. The ring was an outline drawn just inside the editor, and the line-number column, which stays in place as the text scrolls sideways, has a solid background drawn over it. The ring is now a layer over the whole editor, above the line numbers, that lets clicks through.

### Tests

- A browser test focuses the editor, takes a screenshot and checks that the pixel one in from each of the four edges, at its middle, is the accent colour.

### Results

- 142 tests across 8 suites (the editor browser tests and the editor unit tests), all passed (10.1s, CachyOS x86-64, Chromium through Playwright).

## [0.1.0.4] - 2026-11-06 18:05 (IST)

### Fixed

- **Tab close button**: a thin scrollbar appeared beside the close button of the last tab. It took part of the button's click area and scrolled the tab row by a pixel. The tab row scrolls sideways, which makes it scrollable up and down as well, and the selected tab stood one pixel taller than the row. The row now never scrolls up and down, and the selected tab fits it.

### Tests

- A browser test checks that the tab row cannot scroll up and down, even after a mouse wheel over the close button, that it shows no scrollbar, and that all four edges of the close button belong to the button.

### Results

- 4 tests across 2 suites (the tab row browser tests and the tab bar unit tests), all passed (2.3s, CachyOS x86-64, Chromium through Playwright).

## [0.1.0.3] - 2026-11-06 17:40 (IST)

### Fixed

- **Installing for everyone on the computer**: Kern installed under `/opt/kern` could be started only by root. The AppImage's own extraction gives every folder mode 0700, whatever the image stores, so the installed folders were closed to every other user. The install script now gives each extracted folder its stored mode, 0755, before moving it into place, and stops with nothing changed if it cannot. Installing for one user was not affected.

### Tests

- The installer tests' stand-in AppImage extracts its folders 0700, as the real one does. The user install and the install through sudo both check that every installed folder is 0755.

### Results

- 54 tests across 2 suites (the installer suites), all passed (11.5s, CachyOS x86-64, Python 3.14.9).

## [0.1.0.2] - 2026-11-06 17:35 (IST)

### Fixed

- **Kern would not start after installing**: an installed Kern did not open from the application menu, a launcher such as rofi, or `kern` in a terminal. The install script made `~/.local/bin/kern` (or `/usr/local/bin/kern`) a symbolic link to the bundle's `AppRun`, which finds the rest of the bundle through the folder it was started from, so started through the link it looked in the wrong folder and exited. The command is now a small script that starts `AppRun` in place, and an update replaces the link left by an earlier install.

### Tests

- The installer tests' stand-in `AppRun` finds its bundle the way the real one does. New tests start Kern through the installed command, with arguments, and reinstall over a linked command.

### Results

- 41 tests across 1 suite (the installer suite), all passed (10.0s, CachyOS x86-64, Python 3.14.9).

## [0.1.0.1] - 2026-11-06 14:13 (IST)

### Fixed

- **Installing for everyone on the computer**: the install script stopped with "The AppImage could not be extracted; nothing was changed." when a normal user installed with sudo. It made its staging folder under `/opt/kern` as root and then entered that folder and checked what it extracted as the user, so it was refused. Both steps now run through sudo. Installing for one user was not affected.

### Tests

- The installer tests replace `sudo` with a stand-in that switches identity: a folder `mktemp` makes under it can be entered only by commands run through it, as a root-owned 0700 folder can. A new test installs through this stand-in and checks that the AppImage is extracted and that no staging folder is left behind.

### Results

- 1630 tests across 139 suites, all passed (75.6s, CachyOS x86-64, rustc 1.99.1).

## [0.1.0.0] - 2026-11-06 13:26 (IST)

The first release of Kern Desktop: a file manager and a plain text editor in one app for Linux, built on kernkraft 0.1.1.0. It is an alpha. The document formats of Kern for Android (spreadsheets, Word, PowerPoint, PDF, EPUB) are not in it yet.

### Added

#### Shell

- **Main window**: tabs over the folder area, the places strip on the left and a resizable Pinned and Recent panel on the right. A tab moves to a window of its own.
- **Top bar**: the tab row, New tab (the New tab folder from Settings, Home by default), New tab here, Settings and a menu for the rarer actions. A folder tab adds a toolbar with Back, Forward, Up, New folder, Search, Open terminal here, the view switches and Open as editor.
- **Keyboard and right-click parity**: every action has a shortcut or a menu entry.
- **Windows from last time**: Kern starts with a fresh main window. When the last session left windows worth reopening, a bar at the top offers to restore them.
- **Settings** in a window of its own, with categories and a search field. Changes wait for Save, and Revert drops them. The interface size is one of 80, 90, 100, 110 and 125 %, 90 by default.
- **One instance**: a second launch hands its arguments to the running Kern over D-Bus, byte for byte, so names that are not UTF-8 survive. The window it opens comes forward.

#### File manager

- **Folder view**: list and grid, sorting, multi-select, a breadcrumb, an editable location bar and hidden files on request. The view refreshes through inotify when something changes on disk. The grid shows thumbnails from the freedesktop thumbnail cache that other file managers share.
- **File operations**: create, rename in place, and cut, copy and paste through the system clipboard in the formats GNOME and KDE file managers use, both ways. Trash, or delete for good after a question. Copies and moves run in the background with progress, Cancel, a prompt for name conflicts (Keep both names the copy `name (2)`) and a report of anything skipped or failed.
- **Undo and redo** for copy, move, trash, rename and create. An undo that would touch a file changed since is refused, naming it.
- **Drag and drop**: a drop moves files on the same filesystem as the target and copies across, Ctrl forces a copy and Shift a move, and the pointer shows which before the drop. Files drag out to other applications as a copy or a move; Kern never deletes the source of a drag.
- **Places**: Home and the user folders, Volumes (live list, mount, unmount and eject through UDisks2), the Trash (restore, delete permanently, empty) and the Library, which gathers the documents under the folders chosen in Settings.
- **Pinned and Recent**: pin files and folders with Ctrl+D or the menu, reorder them by dragging. A folder pinned as an editor opens in an editor window. Pins whose target is gone are pruned with a notice.
- **Finding and inspecting**: search by name under a folder, Properties (size, item counts, permissions), Copy path, Open with any installed application, and Open terminal here.

#### Text editor

- **Editor tabs**: line numbers, find and replace, undo. A save is atomic and keeps the file's line endings and byte order mark. When another program changed or deleted the file, Kern asks before it writes (Reload, Overwrite, Save As, Cancel), and Save As asks before it replaces a file.
- **Read-only cases**: a file with mixed line endings, a file that is not UTF-8 and a file over 10 MiB open read-only with a banner saying why. A file over 256 MiB offers its default application instead.
- **Close prompts**: closing a tab or a window with unsaved documents asks Save, Discard or Cancel for each.
- **Document windows**: a file opened from outside Kern gets a window of its own, and its Home button moves it into the main window.
- **Editor windows**: Open as editor gives a folder its own window with a folder tree beside its documents. The tree's menu carries the file operations, and its heading holds search, the terminal, hidden files and collapse or expand all. Each folder has one editor window, and a file is never open in two windows: opening it again brings forward the window that has it.

#### Theming

- **System theme**: colours, accent, fonts and corner radius from Hyprland's `hyprtoolkit.conf`, the desktop portal, GTK and fontconfig, each behind its own Follow system switch, re-applied live when the theme changes. Derived colours are checked for WCAG contrast. Kern's own tokens fill in whatever the system does not set, with Outfit, Quicksand, IBM Plex Mono and Sora bundled.

#### Desktop integration

- **Desktop entry** `io.github.verycareful.kern.desktop` for folders and every text type the system's MIME database knows, with icons from 16 to 512 pixels and AppStream metainfo.
- **`org.freedesktop.FileManager1`** (ShowFolders, ShowItems, ShowItemProperties), and making Kern the default file manager from Settings, so other programs' Show in folder opens in Kern.
- **Tiling compositors**: Kern opens tiled, not maximized.
- **Packages**: a deb and an AppImage for x86-64.

#### Installing

- **`install.sh`**, run straight from the repository with `curl`: arrow-key menus for who Kern is for (just me, with no administrator password, or everyone), every setting from the Settings window, the default file manager and whether to start Kern. Nothing changes until the last answer. It downloads the latest release and checks every file against the release's `SHA256SUMS` before installing anything. On an installed Kern it offers Update (only to a newer release, keeping settings, pins and recents) or a fresh reinstall, and moves anything a reinstall replaces aside as a `.backup-<time>` file. `--defaults` asks nothing; `--from DIR` installs from downloaded release files with no network.
- **Layouts**: for one user the AppImage is unpacked under `~/.local/lib/kern`, so it needs no FUSE. For everyone, Debian and Ubuntu get the deb through apt, other distributions the unpacked AppImage under `/opt/kern`.
- **`uninstall.sh`**, shipped with each release and installed beside Kern: keeps or deletes Kern's settings, pins and recents, and gives the default file manager back to the one Kern replaced.
- **`kern --apply-settings FILE`**: applies a JSON object of settings and exits, refusing the whole file if any field is invalid. The installer uses it.

#### No network

- Kern opens no network connection. `cargo deny` bans HTTP and socket crates, ESLint bans `fetch`, `XMLHttpRequest` and `WebSocket`, and the content security policy allows no remote origin. CI runs the release binary under `strace` in a network namespace with no interfaces and fails on any connection to an IPv4 or IPv6 address, after a control run that must trip the check. The install script is the only part that uses the network, to download the release from GitHub.

### Known limitations

- Renaming or moving a document that is open in a tab marks the tab's file as deleted on disk. Saving then offers to create the old name again, and agreeing leaves two files. Close the tab before renaming or moving its file.
- An editor window's strip holds only the Kern logo: Places, Volumes, the Trash and the Library are in the main window. An editor window cannot switch to the file manager layout.
- A tab whose file failed to open, or that shows its file read-only, keeps that file reserved to itself until the tab closes.
- A file swapped in between the Replace question and the write, or changed a second time after the external change question was shown, is replaced by the choice already confirmed.
- A mount that has stopped answering (NFS, sshfs, a stale FUSE mount) under an open document makes the first open or Save As wait up to 2 seconds. After that an open goes ahead by path, saying it could not check, and a Save As is refused naming the path, until the mount answers.
- When the main window's layout cannot be written as it closes, the error is shown in the closing window, so it is not seen. The last stored layout stays.
- Document windows hold the same permissions as the main window, not only the ones a document needs.
- The installer detects a running Kern through `busctl`, so on a system without systemd it does not see one. Run as root, it installs for root alone without a warning.

### Results

- 1629 tests across 139 suites, all passed (76.3s, CachyOS x86-64, rustc 1.99.1).
