// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// The isolated world every app of the driver suite runs in. `e2e-app/run.sh`
// builds it: a fresh directory under the runs directory (KERN_E2E_RUNS), a
// session bus of its own (dbus-run-session, listening on an abstract socket),
// and HOME and every XDG directory pointing into that directory. This module
// refuses to let the suite start anywhere else, so a spec can never reach the
// user's session bus (where Kern would take io.github.verycareful.kern and
// org.freedesktop.FileManager1 from the running file manager) or files.

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

export interface World {
  /** The directory everything of this run lives in. */
  root: string;
  home: string;
  /** The session bus every process of the run shares. */
  bus: string;
}

/** The bus address run.sh's config listens on: abstract, so nothing is written to /tmp. */
const BUS_PREFIX = "unix:abstract=/kern-e2e-";

const REFUSED =
  "the driver suite runs only through e2e-app/run.sh, which gives it a session bus and a home directory of its own";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: ${REFUSED}`);
  return v;
}

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** The world of this run. Throws unless every part of the isolation is in place. */
export function world(): World {
  const runsDir = need("KERN_E2E_RUNS");
  if (!path.isAbsolute(runsDir)) {
    throw new Error(`KERN_E2E_RUNS ${runsDir} is not an absolute path: ${REFUSED}`);
  }
  const runs = path.resolve(runsDir);
  const root = path.resolve(need("KERN_E2E_ROOT"));
  if (!inside(runs, root)) {
    throw new Error(`KERN_E2E_ROOT ${root} is not inside ${runs}: ${REFUSED}`);
  }
  const want: Record<string, string> = {
    HOME: "home",
    XDG_CONFIG_HOME: "config",
    XDG_STATE_HOME: "state",
    XDG_DATA_HOME: "data",
    XDG_CACHE_HOME: "cache",
    XDG_RUNTIME_DIR: "runtime",
    TMPDIR: "tmp",
  };
  for (const [name, dir] of Object.entries(want)) {
    const got = need(name);
    if (path.resolve(got) !== path.join(root, dir)) {
      throw new Error(`${name} is ${got}, not ${path.join(root, dir)}: ${REFUSED}`);
    }
  }
  const bus = need("DBUS_SESSION_BUS_ADDRESS");
  if (!bus.startsWith(BUS_PREFIX)) {
    throw new Error(`the session bus ${bus} is not the run's own: ${REFUSED}`);
  }
  if (process.env["WAYLAND_DISPLAY"]) {
    throw new Error(`WAYLAND_DISPLAY is set, so the apps could open on a real display: ${REFUSED}`);
  }
  need("DISPLAY");
  return { root, home: path.join(root, "home"), bus };
}

/**
 * A new directory for one test, inside the isolated home. Removed again by
 * [`removeTestDirs`].
 */
export function testDir(name: string): string {
  const w = world();
  const dir = path.join(w.home, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Empties the isolated home. Refuses any path that is not inside it. */
export function removeTestDirs(): void {
  const w = world();
  for (const entry of readdirSync(w.home)) {
    const target = path.join(w.home, entry);
    if (!inside(w.home, target)) throw new Error(`refusing to remove ${target}`);
    rmSync(target, { recursive: true, force: true });
  }
}
