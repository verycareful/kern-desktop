#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

# Runs the real-app driver suite: the debug build of Kern, driven through
# tauri-driver and WebKitWebDriver.
#
# Every spec file runs in a world of its own, so no app of the suite can
# reach the session it is started from:
#   - a fresh directory under local/e2e-app-runs/ holds HOME, XDG_CONFIG_HOME,
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
# Environment: KERN_E2E_NO_BUILD=1 skips building the debug binary.

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
LOGS=$REPO/local/test-runs/0.1.0.0
mkdir -p "$LOGS" "$REPO/local/e2e-app-runs"
stamp=$(date +%Y%m%d-%H%M%S)

# The debug build with the frontend bundled in (as tauri dev would serve it
# from a dev server, the suite would need one).
if [[ ${KERN_E2E_NO_BUILD:-} != 1 ]]; then
    npx tauri build --debug --no-bundle >"$LOGS/e2e-app-$stamp-build.log" 2>&1 \
        || { echo "error: debug build failed, see $LOGS/e2e-app-$stamp-build.log" >&2; exit 1; }
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

failed=0
port=47144
for name in "${specs[@]}"; do
    spec=e2e-app/$name.spec.ts
    [[ -f $spec ]] || { echo "error: no such spec file: $spec" >&2; exit 1; }
    world=$REPO/local/e2e-app-runs/$stamp-$name
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
    log=$LOGS/e2e-app-$stamp-$name.log
    # The environment is rebuilt, not filtered: nothing of the calling
    # session (Wayland, Hyprland, its bus, its runtime directory) is passed on.
    set +e
    timeout 600 env -i \
        PATH="$PATH" LANG="${LANG:-C.UTF-8}" TERM=dumb \
        HOME="$world/home" XDG_CONFIG_HOME="$world/config" XDG_STATE_HOME="$world/state" \
        XDG_DATA_HOME="$world/data" XDG_CACHE_HOME="$world/cache" \
        XDG_RUNTIME_DIR="$world/runtime" TMPDIR="$world/tmp" \
        GDK_BACKEND=x11 NO_AT_BRIDGE=1 "${pass[@]}" \
        KERN_E2E_ROOT="$world" KERN_E2E_APP="$APP" KERN_E2E_TAURI_DRIVER="$DRIVER" \
        KERN_E2E_WEBKIT_DRIVER="$WEBKIT_DRIVER" KERN_E2E_DRIVER_PORT="$port" \
        xvfb-run -a -s "-screen 0 1600x1000x24" \
        dbus-run-session --config-file="$world/bus.conf" -- \
        "$REPO/node_modules/.bin/wdio" run e2e-app/wdio.conf.ts --spec "$spec" >"$log" 2>&1
    status=$?
    set -e
    port=$((port + 2))
    passing=$(grep -c '✓' "$log" || true)
    failing=$(grep -c '✖' "$log" || true)
    if ((status == 0)); then
        echo "== e2e-app $name: passed ($passing tests), log $log"
        # Nothing of a passing run is kept but its log.
        case $world in "$REPO"/local/e2e-app-runs/*) rm -rf -- "$world" ;; esac
    else
        failed=1
        echo "== e2e-app $name: FAILED (status $status, $failing failing), log $log, world kept at $world"
        grep -m1 -E '^[A-Za-z]*Error' "$log" || true
    fi
done

exit "$failed"
