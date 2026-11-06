# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

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
