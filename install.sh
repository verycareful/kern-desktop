#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# install.sh for Kern (github.com/verycareful/kern-desktop). Built by
# installer/build.sh from the files in installer/; edit those, not this.
#
# Nothing runs until the last line, so a download cut short runs nothing.

set -euo pipefail

# Terminal UI for the install and uninstall scripts: arrow-key menus, yes/no
# menus and line input.
#
# Everything is drawn on and read from the controlling terminal, opened as
# fd 3, never stdin: under `curl ... | bash` stdin is the script itself.
# Keys follow ECMA-48: cursor up is CSI A, cursor down CSI B; cursor
# visibility is the DEC private mode 25 (CSI ? 25 l / h).

UI_TTY_STATE=""
UI_OPEN=0
UI_ESC=$'\033'

# Colour only on a terminal that is not dumb and when NO_COLOR is unset
# (no-color.org).
ui_colour() {
    [[ -z "${NO_COLOR:-}" && "${TERM:-dumb}" != dumb ]]
}

ui_bold() { ui_colour && printf '%s[1m' "$UI_ESC"; return 0; }
ui_dim() { ui_colour && printf '%s[2m' "$UI_ESC"; return 0; }
ui_reverse() { ui_colour && printf '%s[7m' "$UI_ESC"; return 0; }
ui_reset() { ui_colour && printf '%s[0m' "$UI_ESC"; return 0; }

# Opens the terminal on fd 3 and installs the traps that give it back. With
# no terminal there is no one to answer, so the run stops (status 2).
ui_init() {
    if ! { exec 3<>/dev/tty; } 2>/dev/null; then
        printf '%s\n' "No terminal to ask questions on. Run this in a terminal, or pass --defaults to install without questions." >&2
        exit 2
    fi
    UI_OPEN=1
    UI_TTY_STATE=$(stty -g <&3 2>/dev/null || true)
    trap ui_restore EXIT
    trap 'ui_restore; trap - INT; kill -INT $$' INT
    trap 'ui_restore; trap - TERM; kill -TERM $$' TERM
}

# Gives the terminal back: echo and line mode as they were, cursor shown,
# attributes reset. Safe to call more than once.
ui_restore() {
    ((UI_OPEN)) || return 0
    if [[ -n "$UI_TTY_STATE" ]]; then
        stty "$UI_TTY_STATE" <&3 2>/dev/null || true
    fi
    { printf '%s[?25h' "$UI_ESC"; ui_reset; } >&3 2>/dev/null || true
}

# Messages go to the terminal UI when it is open (ui_init), else to stderr:
# a run with --defaults asks nothing and opens no UI.
ui_out() {
    if ((UI_OPEN)); then cat >&3; else cat >&2; fi
}

ui_say() { printf '%s\n' "$*" | ui_out; }

ui_warn() { { ui_bold; printf '%s' "! $*"; ui_reset; printf '\n'; } | ui_out; }

# Prints the message and exits with the given status.
ui_fail() {
    local code=$1
    shift
    { ui_bold; printf '%s' "x $*"; ui_reset; printf '\n'; } | ui_out
    exit "$code"
}

# Bash runs a trap only between commands, so a Ctrl+C that lands while
# `read` waits on the terminal would wait for the next key. Reads therefore
# time out every UI_POLL_S seconds and start again, which lets a pending
# trap run. A read that ends without a timeout and without input means the
# terminal is gone.
UI_POLL_S=0.2

# ui_read VAR READ-OPTION...: `read -u 3` into VAR, retried across timeouts.
ui_read() {
    local -n _line=$1
    shift
    local status
    while true; do
        status=0
        IFS= read -r -t "$UI_POLL_S" -u 3 "$@" _line || status=$?
        ((status == 0)) && return 0
        ((status > 128)) && continue
        ui_fail 1 "The terminal closed; nothing more can be asked."
    done
}

# Reads one key from the terminal into the named variable: up, down, enter,
# or the character itself.
ui_key() {
    local -n _key=$1
    local c rest
    ui_read c -s -n1
    case "$c" in
    "$UI_ESC")
        # An arrow key is ESC [ A or ESC O A (normal or application mode).
        IFS= read -rsn2 -t 0.1 -u 3 rest || true
        case "$rest" in
        "[A" | "OA") _key=up ;;
        "[B" | "OB") _key=down ;;
        *) _key=other ;;
        esac
        ;;
    "" | $'\n' | $'\r') _key=enter ;;
    k) _key=up ;;
    j) _key=down ;;
    *) _key=other ;;
    esac
}

# ui_menu VAR DEFAULT TITLE OPTION...
# Draws the options under TITLE with DEFAULT (0-based) highlighted. Up and
# down (or k and j) move, Enter picks; VAR gets the 0-based index.
ui_menu() {
    local -n _choice=$1
    local current=$2 title=$3
    shift 3
    local options=("$@") count=$# key i
    { ui_bold; printf '%s' "$title"; ui_reset; printf '\n'; } >&3
    printf '%s[?25l' "$UI_ESC" >&3
    # Keys arrive one at a time and are not echoed for the whole menu, also
    # between two polls of ui_read.
    stty -echo -icanon min 1 time 0 <&3 2>/dev/null || true
    while true; do
        for ((i = 0; i < count; i++)); do
            if ((i == current)); then
                { printf '  > '; ui_reverse; printf ' %s ' "${options[i]}"; ui_reset; printf '%s[K\n' "$UI_ESC"; } >&3
            else
                printf '     %s %s[K\n' "${options[i]}" "$UI_ESC" >&3
            fi
        done
        ui_key key
        case "$key" in
        up) ((current > 0)) && current=$((current - 1)) ;;
        down) ((current < count - 1)) && current=$((current + 1)) ;;
        enter) break ;;
        esac
        # Back to the first option's line, to draw the list again.
        printf '%s[%dA' "$UI_ESC" "$count" >&3
    done
    printf '%s[?25h' "$UI_ESC" >&3
    if [[ -n "$UI_TTY_STATE" ]]; then
        stty "$UI_TTY_STATE" <&3 2>/dev/null || true
    fi
    _choice=$current
}

# ui_yesno VAR DEFAULT QUESTION
# A two-entry menu, Yes then No; DEFAULT is y or n. VAR gets y or n.
ui_yesno() {
    local -n _answer=$1
    local start=0 picked
    [[ $2 == n ]] && start=1
    ui_menu picked "$start" "$3" Yes No
    if ((picked == 0)); then _answer=y; else _answer=n; fi
}

# ui_text VAR DEFAULT PROMPT
# One line of input; an empty line takes DEFAULT, which is shown when set.
ui_text() {
    local -n _text=$1
    local default=$2 prompt=$3 line
    {
        ui_bold
        printf '%s' "$prompt"
        ui_reset
        if [[ -n "$default" ]]; then
            ui_dim
            printf ' [%s]' "$default"
            ui_reset
        fi
        printf ': '
    } >&3
    ui_read line
    if [[ -z "$line" ]]; then _text=$default; else _text=$line; fi
}

# The Kern mark, drawn from src-tauri/icons/kern.svg: two navy bars on a
# white square, sampled at 32 by 16 cells (a cell is about twice as tall as
# it is wide). Navy is the icon's #020c3b. In colour the square is filled
# white, so the mark reads as the icon on a dark or a light terminal.

KERN_LOGO=(
    "████████████████████            "
    "██████████████████████          "
    "████████████████████████        "
    "███████████████████████         "
    "█████████████████████           "
    "███████████████████             "
    "█████████████████               "
    "███████████████                 "
    "███████████████                 "
    "█████████████████               "
    "███████████████████             "
    "█████████████████████           "
    "███████████████████████         "
    "████████████████████████        "
    "██████████████████████          "
    "████████████████████            "
)

# Truecolor when the terminal says so (COLORTERM), else the 256-colour
# palette's nearest entries (17 navy, 231 white).
logo_colours() {
    if [[ "${COLORTERM:-}" == truecolor || "${COLORTERM:-}" == 24bit ]]; then
        printf '%s[38;2;2;12;59;48;2;255;255;255m' "$UI_ESC"
    else
        printf '%s[38;5;17;48;5;231m' "$UI_ESC"
    fi
}

show_logo() {
    local row
    printf '\n' >&3
    for row in "${KERN_LOGO[@]}"; do
        if ui_colour; then
            { printf '  '; logo_colours; printf ' %s ' "$row"; ui_reset; printf '\n'; } >&3
        else
            printf '  %s\n' "${row%"${row##*[! ]}"}" >&3
        fi
    done
    printf '\n' >&3
}

# Names and version labels shared by install.sh and uninstall.sh.

KERN_APP_ID="io.github.verycareful.kern"

# A version label: numbers separated by dots, at least two parts.
is_label() {
    [[ $1 =~ ^[0-9]+(\.[0-9]+)+$ ]]
}

# Cargo holds the label as build metadata (0.1.0+0.103 for 0.1.0.0.103),
# and the bundles are named and versioned that way.
cargo_to_label() {
    printf '%s\n' "${1/+/.}"
}

# Finding and fetching a Kern release.
#
# A release carries SHA256SUMS (sha256sum(1) format) over the deb, the
# AppImage and uninstall.sh. The file names are read from SHA256SUMS, never
# guessed, and every file is checked against it before anything is installed.
# The source is a release tag (downloaded from GitHub over HTTPS) or a
# directory holding the same files (--from: no network).

KERN_RELEASES="https://github.com/verycareful/kern-desktop/releases"
# The bundles are built for x86-64 only (the release runs on ubuntu-24.04).
KERN_ARCH_SUFFIX="_amd64"

REL_VERSION=""
REL_APPIMAGE=""
REL_DEB=""
REL_UNINSTALL=""

# version_gt A B: true when label A is newer than label B, comparing part by
# part as numbers; a missing part counts as 0.
version_gt() {
    local -a a b
    local i n x y
    IFS=. read -r -a a <<<"$1"
    IFS=. read -r -a b <<<"$2"
    n=${#a[@]}
    ((${#b[@]} > n)) && n=${#b[@]}
    for ((i = 0; i < n; i++)); do
        x=$((10#${a[i]:-0}))
        y=$((10#${b[i]:-0}))
        ((x > y)) && return 0
        ((x < y)) && return 1
    done
    return 1
}

# The tag of the latest release, from where /releases/latest redirects to:
# no API call, so no rate limit.
release_latest_tag() {
    local url tag
    url=$(curl -fsSLI --proto '=https' --tlsv1.2 -o /dev/null -w '%{url_effective}' "$KERN_RELEASES/latest") ||
        ui_fail 1 "Could not reach GitHub to find the latest Kern release."
    tag=${url##*/}
    is_label "$tag" || ui_fail 1 "GitHub's latest release has an unexpected tag: $tag"
    printf '%s\n' "$tag"
}

# release_get SOURCE NAME DEST: one file of the release into DEST.
release_get() {
    local src=$1 name=$2 dest=$3
    if [[ -d $src ]]; then
        cp -- "$src/$name" "$dest/$name" || ui_fail 1 "Could not copy $name from $src."
    else
        curl -fsSL --proto '=https' --tlsv1.2 -o "$dest/$name" "$KERN_RELEASES/download/$src/$name" ||
            ui_fail 1 "Could not download $name from the Kern $src release."
    fi
}

# release_fetch SOURCE DEST: SOURCE is a tag or a directory. Fetches
# SHA256SUMS and the three files it lists into DEST, checks them, and sets
# REL_VERSION, REL_APPIMAGE, REL_DEB and REL_UNINSTALL.
release_fetch() {
    local src=$1 dest=$2 sum name line
    local -a appimages=() debs=() uninstalls=() wanted=()
    release_get "$src" SHA256SUMS "$dest"
    while IFS= read -r line || [[ -n $line ]]; do
        [[ -z $line ]] && continue
        if [[ ! $line =~ ^([0-9a-f]{64})\ [\ *](.+)$ ]]; then
            ui_fail 1 "SHA256SUMS has a line that is not a checksum: $line"
        fi
        sum=${BASH_REMATCH[1]}
        name=${BASH_REMATCH[2]}
        if [[ ! $name =~ ^[A-Za-z0-9._+-]+$ || $name == .* ]]; then
            ui_fail 1 "SHA256SUMS names a file Kern does not ship: $name"
        fi
        case "$name" in
        *.AppImage) appimages+=("$name") ;;
        *.deb) debs+=("$name") ;;
        uninstall.sh) uninstalls+=("$name") ;;
        *) continue ;;
        esac
        wanted+=("$sum  $name")
    done <"$dest/SHA256SUMS"
    ((${#appimages[@]} == 1)) || ui_fail 1 "SHA256SUMS lists ${#appimages[@]} .AppImage files, not one."
    ((${#debs[@]} == 1)) || ui_fail 1 "SHA256SUMS lists ${#debs[@]} .deb files, not one."
    ((${#uninstalls[@]} == 1)) || ui_fail 1 "SHA256SUMS does not list uninstall.sh."
    for name in "${appimages[0]}" "${debs[0]}" uninstall.sh; do
        release_get "$src" "$name" "$dest"
    done
    printf '%s\n' "${wanted[@]}" >"$dest/SHA256SUMS.kern"
    if ! (cd "$dest" && sha256sum --check --strict --quiet SHA256SUMS.kern) >/dev/null 2>&1; then
        ui_fail 1 "A downloaded file does not match its checksum in SHA256SUMS; nothing was installed."
    fi
    name=${appimages[0]#"${KERN_APP_ID}_"}
    name=${name%"${KERN_ARCH_SUFFIX}.AppImage"}
    REL_VERSION=$(cargo_to_label "$name")
    is_label "$REL_VERSION" || ui_fail 1 "The AppImage's name carries no version: ${appimages[0]}"
    if [[ ! -d $src && $REL_VERSION != "$src" ]]; then
        ui_fail 1 "The $src release holds Kern $REL_VERSION."
    fi
    REL_APPIMAGE="$dest/${appimages[0]}"
    REL_DEB="$dest/${debs[0]}"
    REL_UNINSTALL="$dest/uninstall.sh"
    chmod +x "$REL_APPIMAGE"
}

# Where Kern is installed, the record of the install, and removing it.
#
# Two scopes. "user" needs no root: the AppImage is extracted (so FUSE is not
# needed) under ~/.local/lib/kern/<version>, with ~/.local/bin/kern and the
# desktop entry, icons and metainfo under $XDG_DATA_HOME. "system" uses the
# deb through apt where apt exists, else the extracted AppImage under
# /opt/kern with /usr/local/bin/kern and /usr/local/share.
#
# The record, install.env, lives in the scope's lib directory beside
# uninstall.sh and installed-files (every file put outside that directory).
# It is KEY=value lines, read line by line and never sourced, so a value is
# never run.

KERN_PKG="io-github-verycareful-kern"
KERN_BUS_NAME="io.github.verycareful.kern"

KERN_VERSION=""
KERN_SCOPE=""
KERN_FORMAT=""
KERN_PREV_FM=""
FOUND=""

L_LIB=""
L_BIN=""
L_SHARE=""
L_SUDO=()

# scope_paths SCOPE: sets L_LIB, L_BIN, L_SHARE and L_SUDO for the scope.
scope_paths() {
    case "$1" in
    user)
        L_LIB="$HOME/.local/lib/kern"
        L_BIN="$HOME/.local/bin/kern"
        L_SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
        L_SUDO=()
        ;;
    system)
        L_LIB="/opt/kern"
        L_BIN="/usr/local/bin/kern"
        L_SHARE="/usr/local/share"
        if ((EUID == 0)); then L_SUDO=(); else L_SUDO=(sudo); fi
        ;;
    *) ui_fail 1 "Unknown install scope: $1" ;;
    esac
}

as_scope() {
    "${L_SUDO[@]}" "$@"
}

# Whether a Kern instance owns its bus name on the session bus.
kern_running() {
    busctl --user status "$KERN_BUS_NAME" >/dev/null 2>&1
}

# record_write SCOPE FORMAT VERSION PREV_FM
record_write() {
    local v
    scope_paths "$1"
    for v in "$@"; do
        [[ $v == *$'\n'* ]] && ui_fail 1 "A record value holds a line break."
    done
    printf 'KERN_VERSION=%s\nKERN_SCOPE=%s\nKERN_FORMAT=%s\nKERN_PREV_FM=%s\n' "$3" "$1" "$2" "$4" |
        as_scope tee "$L_LIB/install.env" >/dev/null
}

# record_read FILE: sets the KERN_* variables from the record.
record_read() {
    local line key value
    KERN_VERSION="" KERN_SCOPE="" KERN_FORMAT="" KERN_PREV_FM=""
    while IFS= read -r line || [[ -n $line ]]; do
        key=${line%%=*}
        value=${line#*=}
        case "$key" in
        KERN_VERSION) KERN_VERSION=$value ;;
        KERN_SCOPE) KERN_SCOPE=$value ;;
        KERN_FORMAT) KERN_FORMAT=$value ;;
        KERN_PREV_FM) KERN_PREV_FM=$value ;;
        esac
    done <"$1"
}

# installed_kern: sets FOUND to record-user or record-system (with the
# KERN_* variables), deb (a Kern deb installed without this script, which
# is adopted), foreign <path> (a Kern this script did not install and will
# not touch), or none.
installed_kern() {
    local scope status version path
    FOUND=none
    for scope in user system; do
        scope_paths "$scope"
        if [[ -f $L_LIB/install.env ]]; then
            record_read "$L_LIB/install.env"
            FOUND="record-$scope"
            return 0
        fi
    done
    if command -v dpkg-query >/dev/null 2>&1; then
        status=$(dpkg-query -W -f='${Status}|${Version}' "$KERN_PKG" 2>/dev/null || true)
        if [[ $status == "install ok installed|"* ]]; then
            version=$(cargo_to_label "${status#*|}")
            KERN_VERSION=$version KERN_SCOPE=system KERN_FORMAT=deb KERN_PREV_FM=""
            FOUND=deb
            return 0
        fi
    fi
    for path in \
        "$HOME/.local/bin/kern" \
        "${XDG_DATA_HOME:-$HOME/.local/share}/applications/$KERN_APP_ID.desktop" \
        /usr/local/bin/kern \
        "/usr/local/share/applications/$KERN_APP_ID.desktop" \
        "/usr/share/applications/$KERN_APP_ID.desktop"; do
        if [[ -e $path || -L $path ]]; then
            FOUND="foreign $path"
            return 0
        fi
    done
}

# Refreshes the desktop and icon caches of the scope's share directory, when
# the tools are there. A failure is reported: menus may show the old entry.
refresh_caches() {
    if command -v update-desktop-database >/dev/null 2>&1; then
        as_scope update-desktop-database -q "$L_SHARE/applications" ||
            ui_warn "update-desktop-database failed; the menu may need a new login to show Kern."
    fi
    if [[ -f $L_SHARE/icons/hicolor/index.theme ]] && command -v gtk-update-icon-cache >/dev/null 2>&1; then
        as_scope gtk-update-icon-cache -q -t "$L_SHARE/icons/hicolor" ||
            ui_warn "gtk-update-icon-cache failed; the icon may need a new login to show."
    fi
}

# layout_install SCOPE FORMAT VERSION APPIMAGE DEB UNINSTALL
# Installs (or replaces, for an update) the release. The AppImage is
# extracted into a staging directory first, so a failed extraction leaves
# the existing install as it was.
layout_install() {
    local scope=$1 format=$2 version=$3 appimage=$4 deb=$5 uninstall=$6
    local work stage share_src entry icon rel old
    local -a placed=()
    scope_paths "$scope"
    work=$(dirname "$appimage")
    as_scope mkdir -p "$L_LIB"
    if [[ $format == deb ]]; then
        as_scope apt-get install -y --reinstall "$(realpath "$deb")" || ui_fail 1 "apt-get could not install the Kern deb."
        : | as_scope tee "$L_LIB/installed-files" >/dev/null
    else
        stage=$(as_scope mktemp -d "$L_LIB/.stage-XXXXXX") || ui_fail 1 "Could not write to $L_LIB."
        # The stage is mktemp's 0700 directory, owned by whoever as_scope
        # runs as, so only an as_scope command may enter or test it.
        if ! as_scope env -C "$stage" "$appimage" --appimage-extract >/dev/null 2>&1 ||
            ! as_scope test -x "$stage/squashfs-root/AppRun"; then
            as_scope rm -rf "$stage"
            ui_fail 1 "The AppImage could not be extracted; nothing was changed."
        fi
        # --appimage-extract writes every directory 0700 whatever the image
        # stores, which shuts a system install to everyone but root. Kern's
        # image stores its directories 0755; they get that mode back here.
        if ! as_scope find "$stage/squashfs-root" -type d -exec chmod u=rwx,go=rx {} +; then
            as_scope rm -rf "$stage"
            ui_fail 1 "The extracted AppImage could not be made readable; nothing was changed."
        fi
        as_scope rm -rf "${L_LIB:?}/$version"
        as_scope mv "$stage/squashfs-root" "$L_LIB/$version"
        as_scope rm -rf "$stage"
        as_scope ln -sfn "$version" "$L_LIB/current"

        share_src="$L_LIB/$version/usr/share"
        entry="$L_SHARE/applications/$KERN_APP_ID.desktop"
        sed "s|^Exec=kern |Exec=$L_BIN |" "$share_src/applications/$KERN_APP_ID.desktop" >"$work/kern.desktop"
        as_scope install -D -m 0644 "$work/kern.desktop" "$entry"
        placed+=("$entry")
        while IFS= read -r icon; do
            rel=${icon#"$share_src/"}
            as_scope install -D -m 0644 "$icon" "$L_SHARE/$rel"
            placed+=("$L_SHARE/$rel")
        done < <(find "$share_src/icons/hicolor" -path '*/apps/kern.*' -type f 2>/dev/null)
        if [[ -f $share_src/metainfo/$KERN_APP_ID.metainfo.xml ]]; then
            as_scope install -D -m 0644 "$share_src/metainfo/$KERN_APP_ID.metainfo.xml" \
                "$L_SHARE/metainfo/$KERN_APP_ID.metainfo.xml"
            placed+=("$L_SHARE/metainfo/$KERN_APP_ID.metainfo.xml")
        fi
        # The launcher is a script, not a symlink: AppRun finds its hooks
        # through the directory of $0, which for a symlink is the link's own
        # directory, so launching through a symlink fails.
        printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$L_LIB/current/AppRun" >"$work/kern.launcher"
        as_scope rm -f "$L_BIN"
        as_scope install -D -m 0755 "$work/kern.launcher" "$L_BIN"
        placed+=("$L_BIN")
        printf '%s\n' "${placed[@]}" | as_scope tee "$L_LIB/installed-files" >/dev/null

        # An update leaves the version it replaced behind; it goes now.
        for old in "$L_LIB"/*/; do
            old=${old%/}
            [[ ${old##*/} == "$version" ]] && continue
            is_label "${old##*/}" && as_scope rm -rf "$old"
        done
        refresh_caches
    fi
    as_scope install -m 0755 "$uninstall" "$L_LIB/uninstall.sh"
}

# layout_remove: removes the install installed_kern found (KERN_SCOPE and
# KERN_FORMAT). Only the files installed-files names are removed outside
# the lib directory.
layout_remove() {
    local path
    scope_paths "$KERN_SCOPE"
    [[ ${L_LIB##*/} == kern ]] || ui_fail 1 "Refusing to remove $L_LIB."
    if [[ $KERN_FORMAT == deb ]]; then
        as_scope apt-get remove -y "$KERN_PKG" || ui_fail 1 "apt-get could not remove Kern."
    elif [[ -f $L_LIB/installed-files ]]; then
        while IFS= read -r path; do
            [[ -z $path ]] && continue
            if [[ $path == "$L_SHARE/"* || $path == "$L_BIN" ]]; then
                as_scope rm -f -- "$path"
            fi
        done <"$L_LIB/installed-files"
    fi
    as_scope rm -rf -- "$L_LIB"
    [[ $KERN_FORMAT == deb ]] || refresh_caches
}

# The settings walk. Every key of settings.json but default_layout (the main
# window offers one layout) has a question here; a Rust test compares this
# list with the settings Kern defines; nothing in the scripts reads it.
# shellcheck disable=SC2034
SETTING_KEYS="theme_mode accent follow scan_roots scan_documents scan_downloads terminal word_wrap editor_zoom view_mode show_hidden interface_size new_tab_folder new_tab_default single_click_left single_click_right single_click_centre single_click_editor error_log"

# The questions follow the Settings window: its sections, its order and its
# labels. The answers become one JSON object, which `kern --apply-settings`
# checks and writes; a path goes in Kern's wire form, {"k":"Utf8","v":...},
# or {"k":"Bytes","v":<base64>} for a name that is not UTF-8.

# Settings offers these interface sizes (store.rs INTERFACE_SIZES); 90 is the
# default (DEFAULT_INTERFACE_SIZE).
SETTINGS_SIZES=(80 90 100 110 125)
SETTINGS_SIZE_DEFAULT=1
# Kern's 12 accents in Settings order (kernkraft-theme KernAccent::ALL);
# Slate is the default.
SETTINGS_ACCENTS=(slate indigo violet plum ocean teal forest amber copper crimson rose graphite)
# Text size: the editor zoom from 25 % to 500 % in 25 % steps
# (EditorSection.tsx ZOOM_MIN, ZOOM_MAX, ZOOM_STEP); 100 % is the default.
SETTINGS_ZOOM_MIN=25
SETTINGS_ZOOM_MAX=500
SETTINGS_ZOOM_STEP=25
SETTINGS_ZOOM_DEFAULT=100

# A JSON string: backslash, quote and control characters escaped (RFC 8259,
# section 7).
json_str() {
    local s=$1 out="" c i code
    for ((i = 0; i < ${#s}; i++)); do
        c=${s:i:1}
        case "$c" in
        '"') out+='\"' ;;
        "\\") out+="\\\\" ;;
        $'\n') out+='\n' ;;
        $'\t') out+='\t' ;;
        $'\r') out+='\r' ;;
        *)
            printf -v code '%d' "'$c"
            if ((code >= 0 && code < 32)); then
                printf -v c '\\u%04x' "$code"
            fi
            out+=$c
            ;;
        esac
    done
    printf '"%s"' "$out"
}

json_bool() {
    if [[ $1 == y ]]; then printf true; else printf false; fi
}

# A path in Kern's wire form.
json_path() {
    if printf '%s' "$1" | LC_ALL=C.UTF-8 iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1; then
        printf '{"k":"Utf8","v":%s}' "$(json_str "$1")"
    else
        printf '{"k":"Bytes","v":"%s"}' "$(printf '%s' "$1" | base64 -w0)"
    fi
}

# ask_folder VAR PROMPT: an existing folder, absolute or under ~, asked again
# until it is one. An empty answer leaves VAR empty.
ask_folder() {
    local -n _folder=$1
    local prompt=$2 answer
    while true; do
        ui_text answer "" "$prompt"
        [[ $answer == \~ ]] && answer=$HOME
        [[ $answer == \~/* ]] && answer="$HOME/${answer#\~/}"
        if [[ -z $answer ]]; then
            _folder=""
            return 0
        fi
        if [[ $answer == /* && -d $answer ]]; then
            _folder=$answer
            return 0
        fi
        ui_warn "$answer is not a folder. Give its full path, or start it with ~/."
    done
}

# Text size in percent as the zoom factor: 125 -> 1.25, 100 -> 1.
zoom_factor() {
    local p=$1 whole frac
    whole=$((p / 100))
    frac=$((p % 100))
    if ((frac == 0)); then
        printf '%d' "$whole"
    else
        printf -v frac '%02d' "$frac"
        printf '%d.%s' "$whole" "${frac%0}"
    fi
}

# click_answer INDEX: y for the "Single click" choice (index 1), n for "Double click".
click_answer() {
    if (($1 == 1)); then printf 'y'; else printf 'n'; fi
}

# settings_walk FILE: asks every setting and writes the JSON object to FILE.
settings_walk() {
    local out=$1 pick text folder p
    local theme size accent f_colours f_accent f_fonts f_radius
    local tab_folder tab_default view hidden click_left click_right click_centre click_editor terminal docs downloads wrap zoom error_log
    local -a sizes=() zooms=() roots=()
    local roots_json="" root

    ui_say ""
    ui_say "Appearance"
    ui_menu pick 0 "Theme" System Light Dark
    case $pick in 0) theme=system ;; 1) theme=light ;; 2) theme=dark ;; esac
    for p in "${SETTINGS_SIZES[@]}"; do sizes+=("$p %"); done
    ui_menu pick "$SETTINGS_SIZE_DEFAULT" "Interface size" "${sizes[@]}"
    size=${SETTINGS_SIZES[pick]}
    ui_yesno f_colours y "Follow the system: colours?"
    ui_yesno f_accent y "Follow the system: accent colour?"
    accent=${SETTINGS_ACCENTS[0]}
    if [[ $f_accent == n ]]; then
        local -a names=()
        for p in "${SETTINGS_ACCENTS[@]}"; do names+=("${p^}"); done
        ui_menu pick 0 "Accent colour" "${names[@]}"
        accent=${SETTINGS_ACCENTS[pick]}
    fi
    ui_yesno f_fonts y "Follow the system: fonts?"
    ui_yesno f_radius y "Follow the system: corner radius?"

    ui_say ""
    ui_say "Files"
    ui_menu pick 0 "New tab folder" Home "Another folder"
    tab_folder=null
    if ((pick == 1)); then
        ask_folder folder "Folder for new tabs (Enter for Home)"
        [[ -n $folder ]] && tab_folder=$(json_path "$folder")
    fi
    ui_menu pick 0 "Ctrl+T opens" "New tab folder" "Current folder"
    if ((pick == 0)); then tab_default=folder; else tab_default=current; fi
    ui_menu pick 0 "View of new folder views" List Grid
    if ((pick == 0)); then view=list; else view=grid; fi
    ui_yesno hidden n "Show hidden items?"
    ui_menu pick 1 "Left panel opens with" "Double click" "Single click"
    click_left=$pick
    ui_menu pick 0 "Right panel opens with" "Double click" "Single click"
    click_right=$pick
    ui_menu pick 0 "File manager list and grid open with" "Double click" "Single click"
    click_centre=$pick
    ui_menu pick 0 "Editor window file tree opens with" "Double click" "Single click"
    click_editor=$pick
    ui_text text "" "Terminal (one program; Enter lets Kern pick one)"
    if [[ -z $text ]]; then terminal=null; else terminal=$(json_str "$text"); fi

    ui_say ""
    ui_say "Library"
    ui_yesno docs y "Walk Documents?"
    ui_yesno downloads y "Walk Downloads?"
    while true; do
        ask_folder folder "Add a folder for the Library to walk (Enter when done)"
        [[ -z $folder ]] && break
        for root in "${roots[@]}"; do
            [[ $root == "$folder" ]] && continue 2
        done
        roots+=("$folder")
    done
    for root in "${roots[@]}"; do
        [[ -n $roots_json ]] && roots_json+=","
        roots_json+=$(json_path "$root")
    done

    ui_say ""
    ui_say "Editor"
    ui_yesno wrap n "Wrap long lines?"
    for ((p = SETTINGS_ZOOM_MIN; p <= SETTINGS_ZOOM_MAX; p += SETTINGS_ZOOM_STEP)); do zooms+=("$p %"); done
    ui_menu pick $(((SETTINGS_ZOOM_DEFAULT - SETTINGS_ZOOM_MIN) / SETTINGS_ZOOM_STEP)) "Text size" "${zooms[@]}"
    zoom=$(zoom_factor $((SETTINGS_ZOOM_MIN + pick * SETTINGS_ZOOM_STEP)))

    ui_say ""
    ui_say "About"
    ui_yesno error_log y "Write an error log?"

    {
        printf '{'
        printf '"theme_mode":"%s",' "$theme"
        printf '"interface_size":%d,' "$size"
        printf '"follow":{"colours":%s,"accent":%s,"fonts":%s,"radius":%s},' \
            "$(json_bool "$f_colours")" "$(json_bool "$f_accent")" "$(json_bool "$f_fonts")" "$(json_bool "$f_radius")"
        printf '"accent":"%s",' "$accent"
        printf '"new_tab_folder":%s,' "$tab_folder"
        printf '"new_tab_default":"%s",' "$tab_default"
        printf '"view_mode":"%s",' "$view"
        printf '"show_hidden":%s,' "$(json_bool "$hidden")"
        printf '"single_click_left":%s,' "$(json_bool "$(click_answer "$click_left")")"
        printf '"single_click_right":%s,' "$(json_bool "$(click_answer "$click_right")")"
        printf '"single_click_centre":%s,' "$(json_bool "$(click_answer "$click_centre")")"
        printf '"single_click_editor":%s,' "$(json_bool "$(click_answer "$click_editor")")"
        printf '"terminal":%s,' "$terminal"
        printf '"scan_documents":%s,' "$(json_bool "$docs")"
        printf '"scan_downloads":%s,' "$(json_bool "$downloads")"
        printf '"scan_roots":[%s],' "$roots_json"
        printf '"word_wrap":%s,' "$(json_bool "$wrap")"
        printf '"error_log":%s,' "$(json_bool "$error_log")"
        printf '"editor_zoom":%s' "$zoom"
        printf '}\n'
    } >"$out"
}

# install.sh: installs, updates or reinstalls Kern.
#
# Every question is asked before anything changes, so answering Cancel or
# pressing Ctrl+C during the questions leaves the machine as it was. The
# release is fetched into a work directory that is removed on exit.

INSTALL_USAGE="Usage: install.sh [--defaults] [--from DIR] [--help]

Installs Kern for Linux from its latest GitHub release, or updates or
reinstalls it when it is already installed.

  --defaults   Ask nothing. A new install is for you alone, with Kern's
               default settings; an existing one is updated when a newer
               release exists.
  --from DIR   Install from release files already downloaded to DIR
               (SHA256SUMS, the deb, the AppImage and uninstall.sh). Nothing
               is downloaded.
  --help       Show this text."

OPT_DEFAULTS=0
OPT_FROM=""
WORK=""
BACKUPS=()
# A reinstall's files to move aside, and the install it replaces. Both are
# acted on only once the new install is in place, so a failed install
# leaves the old one and the user's files as they were.
PENDING_ASIDE=()
OLD_SCOPE=""
OLD_FORMAT=""

on_exit() {
    [[ -n $WORK ]] && rm -rf -- "$WORK"
    ui_restore
}

set_traps() {
    trap on_exit EXIT
    trap 'on_exit; trap - INT; kill -INT $$' INT
    trap 'on_exit; trap - TERM; kill -TERM $$' TERM
}

parse_args() {
    while (($#)); do
        case "$1" in
        --defaults) OPT_DEFAULTS=1 ;;
        --from)
            (($# >= 2)) || { printf '%s\n' "--from needs a directory." >&2; exit 2; }
            OPT_FROM=$(realpath -e -- "$2" 2>/dev/null) || { printf '%s\n' "No such directory: $2" >&2; exit 2; }
            [[ -d $OPT_FROM ]] || { printf '%s\n' "Not a directory: $2" >&2; exit 2; }
            shift
            ;;
        --help | -h)
            printf '%s\n' "$INSTALL_USAGE"
            exit 0
            ;;
        *)
            printf '%s\n\n%s\n' "Unknown option: $1" "$INSTALL_USAGE" >&2
            exit 2
            ;;
        esac
        shift
    done
}

need_commands() {
    local c
    local -a missing=()
    for c in "$@"; do
        command -v "$c" >/dev/null 2>&1 || missing+=("$c")
    done
    ((${#missing[@]} == 0)) || ui_fail 1 "Kern's installer needs these commands, which are missing: ${missing[*]}"
}

welcome() {
    ui_say "Kern is a file manager and text editor in one window. Folders and"
    ui_say "documents open as tabs beside each other, every file is read and"
    ui_say "written in place, and Kern never uses the network. It follows your"
    ui_say "system's colours, accent, fonts and corner radius."
    ui_say ""
    ui_say "Kern is free software under the GNU AGPL, version 3 or later."
    ui_say ""
    ui_say "Thank you for choosing Kern."
    ui_say ""
}

# The installed Kern binary for a scope and format.
kern_binary() {
    if [[ $2 == deb ]]; then
        printf '%s\n' /usr/bin/kern
    else
        scope_paths "$1"
        printf '%s\n' "$L_LIB/current/AppRun"
    fi
}

# The format for a scope: the deb where apt manages packages, else the
# extracted AppImage.
format_for() {
    if [[ $1 == system ]] && command -v apt-get >/dev/null 2>&1 && command -v dpkg-query >/dev/null 2>&1; then
        printf deb
    else
        printf appimage
    fi
}

# backup_aside FILE: moves FILE to FILE.backup-<time>, never over an
# existing file. Nothing happens when FILE does not exist.
backup_aside() {
    local file=$1 dest n=1
    [[ -e $file ]] || return 0
    dest="$file.backup-$STAMP"
    while [[ -e $dest ]]; do
        dest="$file.backup-$STAMP-$n"
        n=$((n + 1))
    done
    mv -n -- "$file" "$dest" || ui_fail 1 "Could not move $file aside."
    [[ -e $file ]] && ui_fail 1 "Could not move $file aside."
    BACKUPS+=("$dest")
}

# Waits until Kern is closed, or the user cancels.
wait_for_kern_closed() {
    local pick
    while kern_running; do
        ((OPT_DEFAULTS)) && ui_fail 1 "Kern is running. Close every Kern window, then run the installer again."
        ui_menu pick 0 "Kern is running. Close every Kern window, then choose Retry." Retry Cancel
        if ((pick == 1)); then
            ui_say "Nothing was changed."
            exit 0
        fi
    done
}

# The release to install: a directory (--from) or the latest tag. Sets
# LATEST to its version; a directory is fetched at once, a tag later.
LATEST=""
SOURCE=""
find_release() {
    if [[ -n $OPT_FROM ]]; then
        SOURCE=$OPT_FROM
        release_fetch "$SOURCE" "$WORK"
        LATEST=$REL_VERSION
    else
        SOURCE=$(release_latest_tag)
        LATEST=$SOURCE
    fi
}

fetch_release() {
    [[ -n $REL_APPIMAGE ]] && return 0
    ui_say "Downloading Kern $LATEST..."
    release_fetch "$SOURCE" "$WORK"
}

# The install questions shared by a new install and a reinstall. Sets
# Q_SCOPE, Q_CUSTOMISE, Q_FM and Q_LAUNCH; the walk writes $WORK/settings.json.
Q_SCOPE=user
Q_CUSTOMISE=n
Q_FM=n
Q_LAUNCH=n
ask_install_questions() {
    local walk=$1 pick
    ((OPT_DEFAULTS)) && return 0
    ui_menu pick 0 "Install Kern for" "Just me (no administrator password)" "Everyone on this computer (uses sudo)"
    if ((pick == 0)); then Q_SCOPE=user; else Q_SCOPE=system; fi
    if [[ $walk == ask ]]; then
        ui_yesno Q_CUSTOMISE y "Customise Kern now? (No keeps Kern's defaults; Settings can change them later.)"
    else
        Q_CUSTOMISE=$walk
    fi
    [[ $Q_CUSTOMISE == y ]] && settings_walk "$WORK/settings.json"
    ui_say ""
    if command -v xdg-mime >/dev/null 2>&1; then
        ui_yesno Q_FM n "Make Kern the default file manager?"
    fi
    ui_yesno Q_LAUNCH y "Launch Kern now?"
}

# Installs with the answers given: the layout, then (for a reinstall) the
# old layout when it was in another scope or format and the files to move
# aside, then the record, the default file manager, the settings and the
# launch. PREV_FM is the file manager to give back on uninstall.
do_install() {
    local prev_fm=$1 format kern current f
    format=$(format_for "$Q_SCOPE")
    fetch_release
    ui_say "Installing Kern $REL_VERSION..."
    layout_install "$Q_SCOPE" "$format" "$REL_VERSION" "$REL_APPIMAGE" "$REL_DEB" "$REL_UNINSTALL"
    if [[ -n $OLD_SCOPE && ($OLD_SCOPE != "$Q_SCOPE" || $OLD_FORMAT != "$format") ]]; then
        KERN_SCOPE=$OLD_SCOPE KERN_FORMAT=$OLD_FORMAT
        layout_remove
    fi
    for f in "${PENDING_ASIDE[@]}"; do
        backup_aside "$f"
    done
    if [[ $Q_FM == y ]]; then
        current=$(xdg-mime query default inode/directory 2>/dev/null || true)
        [[ $current != "$KERN_APP_ID.desktop" ]] && prev_fm=$current
        xdg-mime default "$KERN_APP_ID.desktop" inode/directory ||
            ui_warn "Kern could not be made the default file manager; Settings can try again."
    fi
    record_write "$Q_SCOPE" "$format" "$REL_VERSION" "$prev_fm"
    kern=$(kern_binary "$Q_SCOPE" "$format")
    if [[ -f $WORK/settings.json ]]; then
        "$kern" --apply-settings "$WORK/settings.json" ||
            ui_fail 1 "Kern $REL_VERSION is installed, but it refused the settings above; it starts with its defaults, and Settings can change them."
    fi
    ui_say ""
    ui_say "Kern $REL_VERSION is installed ($(scope_words "$Q_SCOPE"))."
    summary "$Q_SCOPE"
    if [[ $Q_LAUNCH == y ]]; then
        setsid -f "$kern" >/dev/null 2>&1 </dev/null || ui_warn "Kern could not be started."
    fi
}

scope_words() {
    if [[ $1 == user ]]; then printf 'for you'; else printf 'for everyone on this computer'; fi
}

summary() {
    local b
    scope_paths "$1"
    ui_say "  Program:   $L_LIB"
    [[ -f $L_BIN ]] && ui_say "  Command:   $L_BIN"
    for b in "${BACKUPS[@]}"; do
        ui_say "  Moved aside: $b"
    done
    ui_say "  Uninstall: bash $L_LIB/uninstall.sh"
}

fresh_install() {
    welcome
    find_release
    ask_install_questions ask
    do_install ""
}

existing_install() {
    local installed=$KERN_VERSION scope=$KERN_SCOPE format=$KERN_FORMAT prev_fm=$KERN_PREV_FM
    local pick newer=0 settings_choice=0 pins_choice=0
    local -a options=()
    ui_say "Kern $installed is installed ($(scope_words "$scope"))."
    find_release
    version_gt "$LATEST" "$installed" && newer=1
    if ((OPT_DEFAULTS)); then
        if ((newer == 0)); then
            ui_say "Kern is up to date."
            exit 0
        fi
        pick=0
    else
        ((newer)) && options+=("Update to $LATEST")
        ((newer)) || ui_say "Kern is up to date ($LATEST is the latest release)."
        options+=("Fresh reinstall" "Cancel")
        ui_menu pick 0 "What would you like to do?" "${options[@]}"
        ((newer)) || pick=$((pick + 1))
    fi
    case $pick in
    0)
        wait_for_kern_closed
        fetch_release
        ui_say "Updating Kern $installed to $REL_VERSION..."
        layout_install "$scope" "$format" "$REL_VERSION" "$REL_APPIMAGE" "$REL_DEB" "$REL_UNINSTALL"
        record_write "$scope" "$format" "$REL_VERSION" "$prev_fm"
        ui_say "Kern is updated to $REL_VERSION. Settings, pins and recents are as they were."
        ;;
    1)
        welcome
        ui_menu settings_choice 0 "Settings" "Keep current settings" "Choose new settings" "Restore defaults"
        ui_menu pins_choice 0 "Pins and recents" Keep Clear
        if ((settings_choice == 1)); then
            ask_install_questions y
        else
            ask_install_questions n
        fi
        wait_for_kern_closed
        ((settings_choice > 0)) && PENDING_ASIDE+=("$CONFIG_DIR/settings.json")
        ((pins_choice == 1)) && PENDING_ASIDE+=("$STATE_DIR/pins.json" "$STATE_DIR/recents.json")
        OLD_SCOPE=$scope OLD_FORMAT=$format
        do_install "$prev_fm"
        ;;
    *)
        ui_say "Nothing was changed."
        ;;
    esac
}

main() {
    parse_args "$@"
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/kern"
    STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/kern"
    STAMP=$(date +%Y%m%d-%H%M%S)
    ((OPT_DEFAULTS)) || ui_init
    set_traps
    [[ $(uname -m) == x86_64 ]] || ui_fail 1 "Kern is built for x86-64 only; this machine is $(uname -m)."
    need_commands sha256sum mktemp realpath setsid iconv base64
    [[ -n $OPT_FROM ]] || need_commands curl
    WORK=$(mktemp -d "${TMPDIR:-/tmp}/kern-install.XXXXXX") || ui_fail 1 "Could not make a work directory."
    ((OPT_DEFAULTS)) || show_logo
    installed_kern
    case "$FOUND" in
    none) fresh_install ;;
    record-* | deb) existing_install ;;
    foreign*)
        ui_fail 1 "A Kern this installer did not install is at ${FOUND#foreign }. Remove it first; the installer will not change it."
        ;;
    esac
}

main "$@"
