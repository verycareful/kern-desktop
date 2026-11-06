# Changelog - Kern Desktop

All notable changes documented here. Format: [Keep a Changelog](https://keepachangelog.com/), with one deviation: dated release entries are timestamped to the minute with timezone (`YYYY-MM-DD HH:MM (TZ)`).

## [Unreleased]

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
