#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# Builds install.sh and uninstall.sh at the repository root from the parts in
# this folder. Each is one file, so `curl ... | bash` needs nothing else.
# With --check, builds into memory and fails if the committed files differ.

set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")

# A part without its two header lines (SPDX and copyright), which the built
# file carries once.
part() {
    tail -n +3 "$here/$1"
}

build() {
    local name=$1
    shift
    printf '%s\n' \
        '#!/usr/bin/env bash' \
        '# SPDX-License-Identifier: AGPL-3.0-or-later' \
        '# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)' \
        '' \
        "# $name for Kern (github.com/verycareful/kern-desktop). Built by" \
        '# installer/build.sh from the files in installer/; edit those, not this.' \
        '#' \
        '# Nothing runs until the last line, so a download cut short runs nothing.' \
        '' \
        'set -euo pipefail'
    local p
    for p in "$@"; do
        part "$p"
    done
    printf '\n%s\n' 'main "$@"'
}

install_parts=(ui.sh logo.sh common.sh release.sh layout.sh settings.sh install-main.sh)
uninstall_parts=(ui.sh logo.sh common.sh layout.sh uninstall-main.sh)

if [[ ${1:-} == --check ]]; then
    status=0
    diff -u "$root/install.sh" <(build install.sh "${install_parts[@]}") >/dev/null ||
        { echo "install.sh differs from installer/: run installer/build.sh" >&2; status=1; }
    diff -u "$root/uninstall.sh" <(build uninstall.sh "${uninstall_parts[@]}") >/dev/null ||
        { echo "uninstall.sh differs from installer/: run installer/build.sh" >&2; status=1; }
    exit $status
fi

build install.sh "${install_parts[@]}" >"$root/install.sh"
build uninstall.sh "${uninstall_parts[@]}" >"$root/uninstall.sh"
chmod 0755 "$root/install.sh" "$root/uninstall.sh"
