# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

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
