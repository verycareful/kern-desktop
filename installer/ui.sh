# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

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
