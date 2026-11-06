# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

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
