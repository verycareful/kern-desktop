# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

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
        if ! (cd "$stage" && as_scope "$appimage" --appimage-extract >/dev/null 2>&1) ||
            [[ ! -x $stage/squashfs-root/AppRun ]]; then
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
