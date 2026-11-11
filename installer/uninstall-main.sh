# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# uninstall.sh: removes Kern, and on request its settings, binds, pins and recents.
#
# Remove deletes Kern's own folders, $XDG_CONFIG_HOME/kern and
# $XDG_STATE_HOME/kern, outright. Kern keeps nothing else: the files it
# opens are the user's and are never touched. If Kern is the default file
# manager, the one it replaced is made the default again.

UNINSTALL_USAGE="Usage: uninstall.sh [--defaults] [--help]

Removes Kern for Linux as install.sh installed it.

  --defaults   Ask nothing: remove Kern and keep its settings, binds, pins and
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
        ui_menu pick 0 "Settings, binds, pins and recents" "Keep them" "Remove them"
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
        ui_say "Kern, its settings, binds, pins and recents are removed."
    else
        ui_say "Kern is removed. Its settings, binds, pins and recents are kept in $config and $state."
    fi
}
