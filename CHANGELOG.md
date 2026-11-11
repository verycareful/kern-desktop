# Changelog - Kern Desktop

All notable changes documented here. Format: [Keep a Changelog](https://keepachangelog.com/), with one deviation: dated release entries are timestamped to the minute with timezone (`YYYY-MM-DD HH:MM (TZ)`).

## [Unreleased]

## [0.1.2.0] - 2026-11-11 15:16 (IST)

### Added

- **Error log**: Kern writes the errors its windows show, its panics and a web process that stops to `kern.log` in the XDG state folder, one line each, rotated at 1 MiB. It is cleared at the first launch after a reboot. A switch under About in Settings turns it off.
- **Keys and mouse**: Settings has a Keys and mouse category that lists every action and lets you set its keys and mouse buttons (middle click, back and forward, with modifiers). Binds are kept in `binds.json` beside `settings.json`, apply at once, and a bind that another action holds asks before it is taken. Middle click closing a tab is now a default bind of Close tab. A mouse bind never fires inside a text field.
- **Installer and binds**: on a fresh install, an update and a reinstall, the installer asks whether to keep or clear your binds when a `binds.json` exists. `--defaults` keeps them and asks nothing. The uninstaller names binds in its question.
- **Click settings**: four settings choose a single or a double click to open a file or folder, one each for the left panel, the right panel, the centre and the editor. The left panel defaults to a single click.
- **Panel order**: the file manager's three columns and the editor window's two panels can be put in any order in Settings > Files > Panels. The order is kept.
- **Time of day in dates**: Settings > Files picks the system clock, a 12 hour clock or a 24 hour one for the times Kern shows. The Properties dialog follows it.
- **Right-click menu setting**: Settings > Files can make the folder view's right-click menu Standard, Collapsed (six rows) or Expanded (the flat list). Standard is the default.
- **Library**: the Library has a toolbar row, sortable columns (sorting waits until the search is complete), a filter, a card view and a button for hidden items.
- **Cut files**: cut files are greyed until they are pasted, and Escape cancels the cut. When the folder shown is cut or lies inside a cut folder, every row and card is greyed, and so is everything below a cut folder in the editor tree. Search and Library hits grey only their own cut paths.
- **Editor tree**: a Sort button orders the tree by name, size, date modified or type, either way round (not kept across restarts). Expand all and Collapse all are one button. In a narrow column the heading's buttons drop to a row under the folder name.
- **Editor tree keys**: while the tree has the keyboard, Ctrl+X, Ctrl+C, Ctrl+V, F2, Delete and Shift+Delete cut, copy, paste, rename, trash and delete the current row. They can be rebound in Settings > Keys and mouse, mouse buttons included, and editor windows answer them. F4 opens a terminal in the editor layout, in the tree's root or the folder of the row under the pointer.
- **Clear pins and Clear recents**: two buttons in Settings > Files empty the lists after a question.
- **Open documents follow their file**: a tab keeps its text and its place when its file, or a folder above it, is renamed or moved from Kern. A move onto a document that is already open skips that document and says so.
- **Repeated messages**: a message raised again with the same words flashes instead of being dropped, in the status bar, the banners, the rename, the name dialog, the location bar and the editor's save problem.
- **Open errors**: a file that fails to open in an editor window is reported once, centred at the top of the editor area, with a button to dismiss it.

### Changed

- **Modified column**: it shows the day and the time ("Today 14:32", "Mar 4, 2025 10:07").
- **Folder view menu**: the right-click menu keeps the most used entries on top and folds the rest into submenus (More ways to open, More edit actions, Pinned, Selection, View). Hover, click and the Right and Left arrow keys open and close a submenu, and Escape closes the submenu before the menu. The other menus are unchanged.
- **Desktop entry**: Keywords no longer repeat file manager, which the name already says.
- **kernkraft**: the pin moves to 0.1.3.1.
- **Android link**: the link to Kern for Android in Settings and in the welcome text points to https://github.com/verycareful/kern-android.
- **Development tools**: the dev loop ignores edits to tests and to local notes.

### Fixed

- **Installer**: it finds a running Kern through `gdbus` or `dbus-send` when `busctl` is missing, so a system without systemd no longer reads as not running, and it says so when it cannot tell. Run as root, it warns that installing for just you means root.
- **Terminal**: Open terminal here opens the terminal you chose in Settings, then the system's terminal lists, then `$TERMINAL`, then any installed terminal. A program started from the AppImage no longer inherits the bundle's Python environment, which stopped kitty at start while Kern said it had opened a terminal. The message when no terminal is found says what to set.
- **Text rendering**: all text is drawn with greyscale antialiasing. A region whose content fits was drawn with colour fringes and a scrolling region without, so a short list and a long one looked different.
- **Clipboard**: copy offers `text/plain;charset=utf-8`, so a pasted name keeps its characters.
- **Message text**: Ctrl+C copies words selected in a message.
- **Two launches together**: two launches arriving at once create one main window, not two.
- **Reload**: a reloaded page forgets its window's open tabs, so opening the same file again opens a tab and does not focus one that is gone.
- **Settings**: an unreadable setting is reported once, not after every write.
- **Properties**: it is not shown over a folder that did not open.
- **List header**: the column header sits flush under the path bar, and rows scrolling up no longer show in a gap above it.
- **Notices**: the text of a one-line notice is centred against its button.

### Removed

- **Weeks in Modified**: the "Nw ago" form is gone. A date from the last week reads Today, Yesterday or N days ago, and an older one reads as a calendar date.

### Security

- **Document windows**: a document window has a capability of its own and no longer holds the commands only the main window needs (file operations, Trash, mounts, settings and the layout). Before, it held the same permissions as the main window.

### Tests

- Rust tests cover the error log (stamps, rotation, threads, the switch, the boot id), the main window made once, binds and the new settings (defaults, values kept across a restart, refusals that write nothing), the open-document registry (rename, move, collision, reload), each window kind's grants, Clear pins and Clear recents, and the clipboard's offered targets.
- Unit tests cover the keys and mouse binds (matching, claims, text fields, the shared button, the context menu), the Keys and mouse editor, panel order in the file manager and the editor layout, the folded menu (submenus, keyboard, flip at the window's edge), the Library, time formats, cut dimming, the editor tree's sort, hover target and keys (including a rebound key and a mouse button), repeated messages, and each document window command that the page sends.
- Browser tests check the panel order boxes, the folded menu's submenu beside its row and its flip at the window's edge, the editor tree's buttons at the narrowest column and its sort menu, F4 in the editor layout, and a centred one-line notice.
- Real-app tests rename an open edited file from a folder tab and check that the tab keeps its text and saves under the new name, and edit and save a document opened from outside in a window of its own.
- The installer suite covers the binds question in each flow, a running Kern found without `busctl`, and the warning as root.

### Results

- 2088 tests across 170 suites, all passed (220s, CachyOS x86-64, rustc 1.99.1, Python 3.14.9, Chromium through Playwright).

## [0.1.1.4] - 2026-11-07 20:59 (IST)

### Changed

- **Real-app test driver**: WebdriverIO and its `@wdio/*` packages move from 10.1.0 to 10.2.0.
- **Linting**: `typescript-eslint` moves from 8.71.2 to 8.72.1.
- **Glob matching in development tools**: `package.json` forces `minimatch` 11.0.5 for `@typescript-eslint/typescript-estree`, `mocha` and `readdir-glob`, and `glob` 14.0.4 for `mocha`. Each of those packages is at its newest release and still declares `minimatch` 10, so the override goes past what they ask for. It stays until they accept version 11, and then it is removed.

### Security

- **Development dependencies**: `minimatch` 10.2.6 has a denial of service through glob pattern amplification and `glob` 13.0.6 has a cancellation bypass that allows filesystem traversal after a timeout. Both reached the tree only through the linter, the test runner and the real-app test driver, with patterns taken from this project's own configuration, and neither is part of the shipped application. After this change no vulnerable copy of either remains and `npm audit` reports no vulnerabilities.

### Results

- 1704 tests across 141 suites (the Rust tests, every unit test, the browser tests, the real-app driver tests and the packaging and script suites), all passed (239s, CachyOS x86-64, rustc 1.99.1, Python 3.14.9, Chromium through Playwright).

## [0.1.1.3] - 2026-11-07 19:34 (IST)

### Changed

- **Test runner**: Vitest moves from 3.2.7 to 4.1.12, which also moves `@vitest/mocker` and the other `@vitest/*` packages to 4.1.12 and drops `tinypool`, `vite-node` and a second copy of Vite. The unit tests pass unchanged.
- **Type checking**: `tsconfig.json` lists `node` among its `types`. The tests that read CSS files use Node's `process`, `Buffer` and `node:fs`, and had type-checked only because Vitest 3's declarations pulled Node's types in; Vitest 4's do not.

### Security

- **Development dependencies**: the Vitest move closes the open advisories on `vitest` and `@vitest/mocker` (path traversal and arbitrary file read through the redirect mock, and code injection through manual mock registration) and the two critical advisories on `tinypool` (prototype pollution leading to remote code execution through worker options). All of these were in packages used only to run the tests and are not part of the shipped application.

### Results

- 1704 tests across 141 suites (the Rust tests, every unit test, the browser tests, the real-app driver tests and the packaging and script suites), all passed (261s, CachyOS x86-64, rustc 1.99.1, Python 3.14.9, Chromium through Playwright).

## [0.1.1.2] - 2026-11-07 18:54 (IST)

### Changed

- **Release publishing**: when several version tags are pushed together, only the newest publishes a release; the runs for the older tags stop with a notice. A tag that is not a four-part version, whether pushed or given to the manual run, is refused.
- **Release notes**: a release's notes are now every CHANGELOG section newer than the previous published release, up to the release's own version, so a series of patches published as one release lists all of its changes. With no earlier release the notes are the version's own section. The release still fails when its own section is missing or empty.
- **Changelog section tool**: `scripts/changelog_section.py` takes `--since <older version>` to print that range. Versions compare number by number, so 0.1.10.0 is newer than 0.1.9.0, and `[Unreleased]` is left out.

### Tests

- Thirteen tests for the range: numeric ordering, the older bound left out, versions newer than the release left out, a single section printed without a header, a bound with no section of its own, a missing or empty section for the release, a bound that is not older, a bound that is not a version, and the output without the option unchanged.

### Results

- 1704 tests across 141 suites (the Rust tests, every unit test, the browser tests, the real-app driver tests and the packaging and script suites), all passed (302s, CachyOS x86-64, rustc 1.99.1, Python 3.14.9, Chromium through Playwright).

## [0.1.1.1] - 2026-11-07 18:42 (IST)

### Fixed

- **Release history in the app metadata**: the AppStream metainfo listed 0.1.0.1 as the newest release, so software centres showed an out-of-date release history and the check that the newest release matches the current version failed on every push from 0.1.0.2 onward. Releases 0.1.0.2 to 0.1.1.0 and 0.1.1.1 are now listed with their dates.

### Results

- 1691 tests across 141 suites (the Rust tests, every unit test, the browser tests, the real-app driver tests and the packaging and script suites), all passed (650.4s, CachyOS x86-64, rustc 1.99.1, Python 3.14.9, Chromium through Playwright).

## [0.1.1.0] - 2026-11-06 23:10 (IST)

### Added

- **Open in file manager from an editor window**: the editor window's folder, or anything in its folder tree, opens in a folder tab of the main window, which comes forward (and opens first if it was closed). In the tree's right-click menu it opens the folder right-clicked, the folder holding the file right-clicked with that file selected, or the tree's folder when the empty part below the rows is right-clicked. The main menu and a button in the tree's heading open the window's folder.

### Fixed

- **Editor window panel buttons**: in an editor window, the folder column's button on the tab row and Ctrl+B did nothing since 0.1.0.7, as the window did not answer the action that shows and hides the column.

### Tests

- Unit tests check what Open in file manager opens for a folder, a file and the empty part of the tree, and from the main menu; that a file that cannot be shown says why; that the tree's menu offers it on a folder, a file and the empty part except in the main window, whose tree has no folder tabs to open; that the tree's heading button is an editor window's only; and that an editor window answers both panel buttons, their keys and Open in file manager.
- A browser test, as an editor window, right-clicks a folder and then a file in the tree and checks that the folder opens as a folder tab and the file's folder opens with the file selected.

### Results

- 1225 tests across 112 suites (every unit test, and the editor, editor layout, folder, places and smoke browser tests), all passed (69.6s, CachyOS x86-64, Chromium through Playwright).

## [0.1.0.7] - 2026-11-06 21:40 (IST)

### Changed

- **Side panel buttons on the tab row**: beside a document, and in the editor layout, the buttons that show and hide the side panels are on the tab row with Settings and the main menu, the same size and on the same line. The folder button starts the row: it shows the file manager panel beside a document and the folder column in the editor layout. The three-line button for Pinned and Recent stands just before Settings. Each is highlighted while its panel is open. The columns at the window's edges that held them are gone, and the panels slide in from the edges of the window.
- **Shortcuts**: Ctrl+B shows or hides the left panel beside a document as well as the folder column of the editor layout, and Ctrl+Alt+B shows or hides Pinned and Recent. Both work inside the text of a document. The buttons' tooltips name them.
- **Main menu**: the entries that showed and hid the side panels are gone, since the buttons and the shortcuts do it.

### Fixed

- **Side panel buttons out of line**: beside a document, the Pinned and Recent button sat a row below Settings and the main menu, and in the editor layout it sat lower than them in a column of its own.

### Tests

- Browser tests, beside a document and in the editor layout, check that the folder button, the Pinned and Recent button, Settings and the main menu share one row at one size, and that Pinned and Recent open below the tab row, so their button still closes them.
- Unit tests check the buttons beside a document and in the editor layout, that a folder tab has neither, Ctrl+B and Ctrl+Alt+B with the buttons' tooltips, that the left toggle slides the file manager panel beside a document and hides the folder column in the editor layout, that the main menu lists neither toggle, and that each key is bound once.

### Results

- 1215 tests across 111 suites (every unit test, and the editor, editor layout, folder, places and smoke browser tests), all passed (68.3s, CachyOS x86-64, Chromium through Playwright).

## [0.1.0.6] - 2026-11-06 20:30 (IST)

### Fixed

- **Show hidden files button**: the button did not show whether hidden files were shown. In the editor layout this made showing or hiding them seem slow, since the tree's button never changed and the only sign was the tree itself. The eye is now open while hidden files show and crossed out while they are hidden, in a folder tab's toolbar and in the folder tree of the editor layout. The tree's buttons also take the highlighted look of a pressed button, as the folder toolbar's do.
- **Cargo.lock**: the kernkraft crates were recorded without their git source, so a build from the lock file alone did not resolve them. Each again names the kernkraft 0.1.1.0 tag and commit.

### Tests

- The folder tab's Ctrl+H test and the editor layout's tree button test check the open and crossed-out eye, and the pressed state, through a show and a hide.
- The tab row and focus ring browser tests from 0.1.0.4 and 0.1.0.5 now pass the TypeScript check.

### Results

- 433 tests across 37 suites (the files and editor layout unit tests, and the hidden files, tab row and focus ring browser tests), all passed (28.2s, CachyOS x86-64, Chromium through Playwright).

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

[Unreleased]: https://github.com/verycareful/kern-desktop/compare/0.1.2.0...HEAD
[0.1.2.0]: https://github.com/verycareful/kern-desktop/compare/0.1.1.4...0.1.2.0
[0.1.1.4]: https://github.com/verycareful/kern-desktop/compare/0.1.1.3...0.1.1.4
[0.1.1.3]: https://github.com/verycareful/kern-desktop/compare/0.1.1.2...0.1.1.3
[0.1.1.2]: https://github.com/verycareful/kern-desktop/compare/0.1.1.0...0.1.1.2
[0.1.1.0]: https://github.com/verycareful/kern-desktop/compare/0.1.0.7...0.1.1.0
[0.1.0.7]: https://github.com/verycareful/kern-desktop/compare/0.1.0.6...0.1.0.7
[0.1.0.6]: https://github.com/verycareful/kern-desktop/compare/0.1.0.5...0.1.0.6
[0.1.0.5]: https://github.com/verycareful/kern-desktop/compare/0.1.0.4...0.1.0.5
[0.1.0.4]: https://github.com/verycareful/kern-desktop/compare/0.1.0.3...0.1.0.4
[0.1.0.3]: https://github.com/verycareful/kern-desktop/compare/0.1.0.2...0.1.0.3
[0.1.0.2]: https://github.com/verycareful/kern-desktop/compare/0.1.0.1...0.1.0.2
[0.1.0.1]: https://github.com/verycareful/kern-desktop/compare/0.1.0.0...0.1.0.1
[0.1.0.0]: https://github.com/verycareful/kern-desktop/releases/tag/0.1.0.0
