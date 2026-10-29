// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { clipClearIf, toWireError, type WirePath } from "../ipc";
import { useOps } from "./useOps";

// A cut that was pasted and fully moved is taken off the clipboard (design 5.8), if the
// clipboard still holds exactly that cut. The backend can only reach the clipboard while the
// window has the focus (Wayland gives it to a focused window alone) and says so with
// `NoFocus`. A move can end while the user is in another application, so that is not an
// error: the cut waits, and is cleared when the window gets the focus back. It lives here and
// not in a folder view because the view that pasted may be gone by then.

const waiting: WirePath[][] = [];
let listening = false;

const STILL_THERE =
  "The cut is still on the clipboard. It is cleared when Kern has the focus, so a paste elsewhere will look for files that have moved.";

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("focus", onFocus);
}

function unlisten() {
  if (!listening) return;
  listening = false;
  window.removeEventListener("focus", onFocus);
}

function onFocus() {
  const now = waiting.splice(0);
  if (now.length === 0) {
    unlisten();
    return;
  }
  void Promise.all(now.map((paths) => attempt(paths, true))).then(() => {
    if (waiting.length === 0) unlisten();
  });
}

async function attempt(paths: WirePath[], retry: boolean): Promise<void> {
  try {
    await clipClearIf("cut", paths);
  } catch (e) {
    const error = toWireError(e);
    if (error.kind === "NoFocus") {
      waiting.push(paths);
      listen();
      // The first miss is the user being elsewhere; a miss after the focus came back is
      // news they can act on.
      if (retry) useOps.getState().notify(STILL_THERE);
    } else {
      useOps
        .getState()
        .report({ title: "Clearing the clipboard after a cut", report: null, error });
    }
  }
}

/** Takes the cut of `paths` off the clipboard once it is safe to; settles after the first try. */
export function clearSpentCut(paths: WirePath[]): Promise<void> {
  return attempt(paths, false);
}

/** Forgets every cut waiting for the focus (tests). */
export function forgetSpentCuts(): void {
  waiting.length = 0;
  unlisten();
}
