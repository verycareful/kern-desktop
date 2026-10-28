// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { displayPath, type Identity, type WireError } from "../ipc";

// What the strip says about a volume's problems, in plain words. The kinds are
// kernkraft-volumes' error variants (error.rs) as kernkraft-tauri names them;
// anything not listed here is shown as its kind and UDisks' or the system's
// own message.

const detail = (e: WireError) => e.message;

export function volumeErrorText(e: WireError): string {
  const d = e.details;
  switch (e.kind) {
    case "IdentityMismatch":
      return `This is no longer the volume that was listed, so nothing was done. The list has been read again. (${detail(e)})`;
    case "IdentityUnknown":
      return `Kern cannot tell this volume from another, so it will not mount, unmount or eject it. (${detail(e)})`;
    case "NoDiskSeq":
      return `Kern cannot tell which disk this is, so it will not unmount or eject it. (${detail(e)})`;
    case "UdisksAbsent":
      return "Disks that are plugged in or taken out will not appear here, because UDisks2 is not running. Volumes that are mounted or unmounted still update.";
    case "CallbackPanic":
      return `Kern's volume watcher hit an internal error and keeps running, but the list may have missed a change; Refresh volumes lists it again. (${detail(e)})`;
  }
  const base = `${e.kind}: ${e.message}`;
  if (d?.k === "EjectIncomplete" && d.unmounted.length > 0) {
    return `${base} (already unmounted: ${d.unmounted.map(displayPath).join(", ")})`;
  }
  return base;
}

/** Why Kern will not act on a volume, or null when it will. */
export const identityNote = (id: Identity): string | null =>
  id.state === "unknown" ? `Cannot be mounted, unmounted or ejected: ${id.reason}` : null;
