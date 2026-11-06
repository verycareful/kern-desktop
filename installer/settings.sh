# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# The settings walk. Every key of settings.json but default_layout (the main
# window offers one layout) has a question here; a Rust test compares this
# list with the settings Kern defines; nothing in the scripts reads it.
# shellcheck disable=SC2034
SETTING_KEYS="theme_mode accent follow scan_roots scan_documents scan_downloads terminal word_wrap editor_zoom view_mode show_hidden interface_size new_tab_folder new_tab_default"

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

# settings_walk FILE: asks every setting and writes the JSON object to FILE.
settings_walk() {
    local out=$1 pick text folder p
    local theme size accent f_colours f_accent f_fonts f_radius
    local tab_folder tab_default view hidden terminal docs downloads wrap zoom
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
        printf '"terminal":%s,' "$terminal"
        printf '"scan_documents":%s,' "$(json_bool "$docs")"
        printf '"scan_downloads":%s,' "$(json_bool "$downloads")"
        printf '"scan_roots":[%s],' "$roots_json"
        printf '"word_wrap":%s,' "$(json_bool "$wrap")"
        printf '"editor_zoom":%s' "$zoom"
        printf '}\n'
    } >"$out"
}
