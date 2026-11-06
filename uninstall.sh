#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# uninstall.sh for Kern (github.com/verycareful/kern-desktop). Built by
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
        as_scope mkdir -p "$(dirname "$L_BIN")"
        as_scope ln -sfn "$L_LIB/current/AppRun" "$L_BIN"
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

# uninstall.sh: removes Kern, and on request its settings, pins and recents.
#
# Remove deletes Kern's own folders, $XDG_CONFIG_HOME/kern and
# $XDG_STATE_HOME/kern, outright. Kern keeps nothing else: the files it
# opens are the user's and are never touched. If Kern is the default file
# manager, the one it replaced is made the default again.

UNINSTALL_USAGE="Usage: uninstall.sh [--defaults] [--help]

Removes Kern for Linux as install.sh installed it.

  --defaults   Ask nothing: remove Kern and keep its settings, pins and
               recents.
  --help       Show this text."

OPT_DEFAULTS=0

parse_args() {
    while (($#)); do
        case "$1" in
        --defaults) OPT_DEFAULTS=1 ;;
        --help | -h)
            printf '%s\n' "$UNINSTALL_USAGE"
            exit 0
            ;;
        *)
            printf '%s\n\n%s\n' "Unknown option: $1" "$UNINSTALL_USAGE" >&2
            exit 2
            ;;
        esac
        shift
    done
}

# Gives the default file manager back when Kern holds it.
restore_file_manager() {
    local current
    command -v xdg-mime >/dev/null 2>&1 || return 0
    current=$(xdg-mime query default inode/directory 2>/dev/null || true)
    [[ $current == "$KERN_APP_ID.desktop" ]] || return 0
    if [[ -n $KERN_PREV_FM ]]; then
        xdg-mime default "$KERN_PREV_FM" inode/directory ||
            ui_warn "Could not make $KERN_PREV_FM the default file manager again."
    else
        ui_warn "No file manager was the default before Kern; choose one in your desktop's settings."
    fi
}

main() {
    local yn pick config state
    parse_args "$@"
    config="${XDG_CONFIG_HOME:-$HOME/.config}/kern"
    state="${XDG_STATE_HOME:-$HOME/.local/state}/kern"
    ((OPT_DEFAULTS)) || ui_init
    ((OPT_DEFAULTS)) || show_logo
    installed_kern
    case "$FOUND" in
    none)
        ui_say "Kern is not installed."
        exit 0
        ;;
    foreign*)
        ui_fail 1 "A Kern the installer did not install is at ${FOUND#foreign }; remove it the way it was installed."
        ;;
    esac
    pick=0
    if ((OPT_DEFAULTS == 0)); then
        ui_yesno yn n "Remove Kern $KERN_VERSION?"
        if [[ $yn == n ]]; then
            ui_say "Nothing was changed."
            exit 0
        fi
        ui_menu pick 0 "Settings, pins and recents" "Keep them" "Remove them"
    fi
    while kern_running; do
        ((OPT_DEFAULTS)) && ui_fail 1 "Kern is running. Close every Kern window, then run this again."
        ui_menu yn 0 "Kern is running. Close every Kern window, then choose Retry." Retry Cancel
        if ((yn == 1)); then
            ui_say "Nothing was changed."
            exit 0
        fi
    done
    restore_file_manager
    layout_remove
    if ((pick == 1)); then
        rm -rf -- "$config" "$state" || ui_fail 1 "Kern is removed, but $config or $state could not be deleted."
        ui_say "Kern, its settings, pins and recents are removed."
    else
        ui_say "Kern is removed. Its settings, pins and recents are kept in $config and $state."
    fi
}

main "$@"
