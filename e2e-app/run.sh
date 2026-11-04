#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# Runs the real-app driver suite: the debug build of Kern, driven through
# tauri-driver and WebKitWebDriver.
#
# Every spec file runs in a world of its own, so no app of the suite can
# reach the session it is started from:
#   - a fresh directory under the runs directory holds HOME, XDG_CONFIG_HOME,
#     XDG_STATE_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, XDG_RUNTIME_DIR and TMPDIR,
#     and every file the specs open, create or watch;
#   - dbus-run-session gives it a session bus of its own (Kern claims
#     io.github.verycareful.kern and org.freedesktop.FileManager1 on it), on an
#     abstract socket, so nothing is written to /tmp;
#   - xvfb-run gives it a display of its own, and the environment is rebuilt
#     from nothing but what the run needs, so no Wayland, Hyprland or other
#     session variable is inherited.
# e2e-app/support/world.ts refuses to start the suite outside such a world.
#
# Usage: e2e-app/run.sh [--check] [spec-name ...]
#   --check   exit 0 if everything the suite needs is installed, else 1,
#             saying what is missing; runs nothing
#   spec-name  run only e2e-app/<spec-name>.spec.ts (default: all)
# Environment:
#   KERN_E2E_NO_BUILD=1  skips building the debug binary
#   KERN_E2E_RUNS        the runs directory: the worlds, the logs of every run
#                        and of the build. Default: src-tauri/target/e2e-app-runs
#                        (build output, which git ignores). A passing world is
#                        removed, a failing one is kept.

set -euo pipefail

cd "$(dirname "$0")/.."
REPO=$PWD

# tauri-driver is installed with cargo and is often not on PATH.
find_driver() {
    if command -v tauri-driver >/dev/null 2>&1; then
        command -v tauri-driver
    elif [[ -x $HOME/.cargo/bin/tauri-driver ]]; then
        echo "$HOME/.cargo/bin/tauri-driver"
    else
        return 1
    fi
}

missing=()
DRIVER=$(find_driver) || missing+=("tauri-driver (cargo install tauri-driver --locked)")
WEBKIT_DRIVER=$(command -v WebKitWebDriver 2>/dev/null || true)
[[ -n $WEBKIT_DRIVER ]] || missing+=("WebKitWebDriver (Arch: webkitgtk-6.0, Ubuntu: webkit2gtk-driver)")
for tool in xvfb-run dbus-run-session dbus-daemon gdbus node; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done

if [[ ${1:-} == --check ]]; then
    if ((${#missing[@]})); then
        printf 'missing: %s\n' "${missing[@]}"
        exit 1
    fi
    echo "driver suite tools found (tauri-driver: $DRIVER)"
    exit 0
fi
if ((${#missing[@]})); then
    printf 'error: missing: %s\n' "${missing[@]}" >&2
    exit 1
fi

APP=$REPO/src-tauri/target/debug/kern
RUNS=$(realpath -m -- "${KERN_E2E_RUNS:-$REPO/src-tauri/target/e2e-app-runs}")
mkdir -p "$RUNS"
stamp=$(date +%Y%m%d-%H%M%S)

# The longest a spec file may run before it and everything it started are
# stopped. A file measured 1, 6 and 9 seconds on a development machine; 300 is
# over thirty times the longest, for a slower machine. The CI step limit is
# the file count times this, plus 5 minutes for starting the displays (see
# .github/workflows/ci.yml).
SPEC_BOUND_S=300

# The debug build with the frontend bundled in (as tauri dev would serve it
# from a dev server, the suite would need one).
if [[ ${KERN_E2E_NO_BUILD:-} != 1 ]]; then
    npx tauri build --debug --no-bundle >"$RUNS/e2e-app-$stamp-build.log" 2>&1 \
        || { echo "error: debug build failed, see $RUNS/e2e-app-$stamp-build.log" >&2; exit 1; }
fi
[[ -x $APP ]] || { echo "error: $APP is not built" >&2; exit 1; }

if (($# > 0)); then
    specs=("$@")
else
    specs=()
    for f in e2e-app/*.spec.ts; do
        n=$(basename "$f" .spec.ts)
        specs+=("$n")
    done
fi

# Rendering knobs for a machine without a GPU or user namespaces (CI); they
# say nothing about any session, so they are the only variables passed on.
pass=()
for v in WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS WEBKIT_DISABLE_COMPOSITING_MODE \
    WEBKIT_DISABLE_DMABUF_RENDERER LIBGL_ALWAYS_SOFTWARE; do
    [[ -z ${!v:-} ]] || pass+=("$v=${!v}")
done

# Two free ports on the loopback interface for the driver and the native
# driver behind it, so a driver left over from an earlier run is never the
# one a new run reaches. Both are held open until both are known.
free_ports() {
    node -e '
const net = require("node:net");
const open = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => resolve(s));
});
Promise.all([open(), open()]).then((s) => {
  console.log(s.map((x) => x.address().port).join(" "));
  s.forEach((x) => x.close());
});'
}

child=""
world=""
interrupted() {
    if [[ -n $child ]]; then
        kill -TERM "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
    fi
    echo "error: interrupted, world kept at $world" >&2
    exit 130
}
trap interrupted INT TERM

failed=0
for name in "${specs[@]}"; do
    spec=e2e-app/$name.spec.ts
    [[ -f $spec ]] || { echo "error: no such spec file: $spec" >&2; exit 1; }
    world=$RUNS/$stamp-$name
    mkdir -p "$world"/{home,config,state,data,cache,runtime,tmp}
    chmod 700 "$world/runtime"
    # Interface size 100 %. At the default (90 %, applied as webview zoom)
    # WebKitWebDriver delivers pointer input scaled by the inverse of the
    # zoom, so a click lands off its element; nothing the specs check depends
    # on the size. The file is the app's own settings.json, whose missing
    # fields take their defaults.
    mkdir -p "$world/config/kern"
    echo '{"interface_size": 100}' >"$world/config/kern/settings.json"
    bus=kern-e2e-$stamp-$name-$$
    cat >"$world/bus.conf" <<EOF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:abstract=/$bus</listen>
  <auth>EXTERNAL</auth>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
EOF
    log=$RUNS/e2e-app-$stamp-$name.log
    read -r port native_port < <(free_ports)
    # The environment is rebuilt, not filtered: nothing of the calling
    # session (Wayland, Hyprland, its bus, its runtime directory) is passed on.
    set +e
    timeout -k 10 "$SPEC_BOUND_S" env -i \
        PATH="$PATH" LANG="${LANG:-C.UTF-8}" TERM=dumb \
        HOME="$world/home" XDG_CONFIG_HOME="$world/config" XDG_STATE_HOME="$world/state" \
        XDG_DATA_HOME="$world/data" XDG_CACHE_HOME="$world/cache" \
        XDG_RUNTIME_DIR="$world/runtime" TMPDIR="$world/tmp" \
        GDK_BACKEND=x11 NO_AT_BRIDGE=1 "${pass[@]}" \
        KERN_E2E_ROOT="$world" KERN_E2E_RUNS="$RUNS" KERN_E2E_APP="$APP" \
        KERN_E2E_TAURI_DRIVER="$DRIVER" KERN_E2E_WEBKIT_DRIVER="$WEBKIT_DRIVER" \
        KERN_E2E_DRIVER_PORT="$port" KERN_E2E_NATIVE_PORT="$native_port" \
        xvfb-run -a -s "-screen 0 1600x1000x24" \
        dbus-run-session --config-file="$world/bus.conf" -- \
        "$REPO/node_modules/.bin/wdio" run e2e-app/wdio.conf.ts --spec "$spec" >"$log" 2>&1 &
    child=$!
    wait "$child"
    status=$?
    child=""
    set -e
    passing=$(grep -c '✓' "$log" || true)
    failing=$(grep -c '✖' "$log" || true)
    # A run that exits 0 without running a test has checked nothing.
    if ((status == 0 && passing == 0)); then status=1; fi
    if ((status == 0)); then
        echo "== e2e-app $name: passed ($passing tests), log $log"
        # Nothing of a passing run is kept but its log. The world is a
        # directory this script made under the runs directory just above.
        rm -rf -- "$world"
    else
        failed=1
        reason="status $status"
        ((status != 124)) || reason="stopped after the ${SPEC_BOUND_S} s bound"
        echo "== e2e-app $name: FAILED ($reason, $failing failing), log $log, world kept at $world"
        # What the log ends with, so a failure on a machine whose files are
        # gone afterwards (CI) is still readable.
        tail -n 60 "$log"
    fi
done

exit "$failed"
