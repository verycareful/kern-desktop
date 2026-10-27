// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useState } from "react";
import { HardDrive, Usb, X } from "lucide-react";
import { displayPath, type Device, type WireError } from "../ipc";
import { formatSize } from "../files/format";
import { ActionMenu, type MenuSection } from "../keys/ActionMenu";
import { actions } from "../keys/actions";
import { showFolder } from "./place-nav";
import { useCurrentPlace } from "./use-current-place";
import { useVolumes, type Volume } from "./volumes-store";

// Design 4.1 and 5.3: the Volumes group of the strip. Mounted volumes first,
// then the filesystems UDisks knows that are not mounted, each with a Mount
// button. Unmount and Eject are in the right-click menu (and the Menu key);
// they run through the action table, aimed at the volume the menu was opened
// on. A volume being worked on shows what is happening and the rest of the
// window stays usable. A failure is shown beside its volume in UDisks' own
// words; what an incomplete eject already unmounted is listed too.

const MENU: MenuSection[] = [
  {
    title: "Volume",
    actions: ["volume.unmount", "volume.eject", "volume.mount"].map((id) =>
      actions.find((a) => a.id === id)!
    ),
  },
];

function errorText(e: WireError): string {
  const base = `${e.kind}: ${e.message}`;
  const d = e.details;
  if (d?.k === "EjectIncomplete" && d.unmounted.length > 0) {
    return `${base} (already unmounted: ${d.unmounted.map(displayPath).join(", ")})`;
  }
  return base;
}

const deviceText = (d: Device) =>
  [d.fs_type, d.size > 0 ? formatSize(d.size) : "", d.system ? "internal" : ""]
    .filter(Boolean)
    .join(", ");

export function VolumesList() {
  const s = useVolumes();
  const currentKey = useCurrentPlace();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // No event announces a volume appearing, so the list is read when the strip
  // appears, when the window comes back into use and after every action.
  useEffect(() => {
    const refresh = () => void useVolumes.getState().refresh();
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const volumes = s.volumes();
  const label = (v: Volume) =>
    v.kind === "mounted" ? v.mount.label : v.device.label || v.device.device;

  const openMenu = (v: Volume, at: { x: number; y: number }, button: HTMLElement | null) => {
    s.setCurrent(v.key);
    button?.focus();
    setMenu(at);
  };

  return (
    <section className="kern-places-group" aria-label="Volumes">
      <h2 className="kern-label kern-places-heading">Volumes</h2>
      {s.loadError && (
        <div role="alert" className="kern-places-error">
          <span>The volumes could not be listed: {errorText(s.loadError)}</span>{" "}
          <button type="button" className="kern-button" onClick={() => void s.refresh()}>
            Retry
          </button>
        </div>
      )}
      {s.problems.map((p, i) => (
        <div key={i} role="alert" className="kern-places-error">
          {errorText(p)}
        </div>
      ))}
      <ul className="kern-places-list">
        {volumes.map((v) => {
          const busy = s.busy[v.key];
          const error = s.errors[v.key];
          return (
            <li key={v.key} className="kern-volume">
              {v.kind === "mounted" ? (
                <button
                  type="button"
                  className="kern-place"
                  aria-busy={busy ? true : undefined}
                  aria-current={currentKey === v.key ? "page" : undefined}
                  title={`${label(v)} (${displayPath(v.mount.mount_point)})`}
                  onFocus={() => s.setCurrent(v.key)}
                  onClick={() => showFolder(v.mount.mount_point)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(v, { x: e.clientX, y: e.clientY }, e.currentTarget);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    openMenu(v, { x: r.left, y: r.bottom }, e.currentTarget);
                  }}
                >
                  {v.mount.removable ? (
                    <Usb size={16} strokeWidth={2} aria-hidden />
                  ) : (
                    <HardDrive size={16} strokeWidth={2} aria-hidden />
                  )}
                  <span className="kern-place-label">{label(v)}</span>
                </button>
              ) : (
                <div
                  className="kern-place kern-place-unmounted"
                  title={`${v.device.device}: ${deviceText(v.device)}`}
                >
                  <HardDrive size={16} strokeWidth={2} aria-hidden />
                  <span className="kern-place-label">{label(v)}</span>
                  <button
                    type="button"
                    className="kern-button kern-mount"
                    aria-label={`Mount ${label(v)}`}
                    aria-busy={busy ? true : undefined}
                    disabled={Boolean(busy)}
                    onFocus={() => s.setCurrent(v.key)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(v, { x: e.clientX, y: e.clientY }, e.currentTarget);
                    }}
                    onClick={() => void s.run(v, "mount")}
                  >
                    Mount
                  </button>
                </div>
              )}
              {busy && (
                <p role="status" className="kern-place-busy">
                  {busy}
                </p>
              )}
              {error && (
                <div role="alert" className="kern-places-error">
                  <span>{errorText(error)}</span>
                  <button
                    type="button"
                    className="kern-icon-button"
                    aria-label={`Dismiss the error for ${label(v)}`}
                    onClick={() => s.clearError(v.key)}
                  >
                    <X size={14} strokeWidth={2} aria-hidden />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {s.loaded && volumes.length === 0 && !s.loadError && (
        <p className="kern-places-none">No volumes.</p>
      )}
      {menu && <ActionMenu sections={MENU} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </section>
  );
}
