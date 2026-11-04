#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# Runs a command for a limited time in a network namespace with no
# interfaces, under strace, and writes the connect, sendto, sendmsg and
# sendmmsg calls of the command and everything it starts to a log. Whether any
# of them used an IPv4 or IPv6 address is then decided by inet_calls.py, the
# same code for every run.
#
# Usage: trace-in-empty-netns.sh <log> <seconds> <command> [argument ...]
# Exit status: the command's; 124 when it was still running after <seconds>
# and was stopped (timeout(1)); strace's own failures are 1 and above, so the
# caller tells them apart by the log, which inet_calls.py --min-calls checks.
#
# The namespace is made by KERN_NETNS_LAUNCH, a command line that runs its
# arguments inside a new network namespace. The default makes it as root,
# since a CI runner forbids unprivileged user namespaces, and drops back to
# the calling user with setpriv before anything else runs, so the traced
# command is unprivileged. A machine that allows user namespaces can set
# KERN_NETNS_LAUNCH="unshare -rn".
#
# timeout runs inside strace, so a stopped command takes its whole process
# group with it and strace then returns on its own.

set -euo pipefail

if (($# < 3)); then
    echo "usage: $0 <log> <seconds> <command> [argument ...]" >&2
    exit 2
fi
log=$1
seconds=$2
shift 2

if [[ -n ${KERN_NETNS_LAUNCH:-} ]]; then
    read -r -a launch <<<"$KERN_NETNS_LAUNCH"
else
    launch=(sudo unshare -n setpriv --reuid="$(id -u)" --regid="$(id -g)" --init-groups)
fi

# strace(1): -f follows children, -o writes the log, -e trace= picks the calls.
exec "${launch[@]}" env "HOME=$HOME" "PATH=$PATH" \
    strace -f -o "$log" -e trace=connect,sendto,sendmsg,sendmmsg \
    timeout "$seconds" "$@"
