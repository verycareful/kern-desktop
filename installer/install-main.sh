# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

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
    [[ -L $L_BIN ]] && ui_say "  Command:   $L_BIN"
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
