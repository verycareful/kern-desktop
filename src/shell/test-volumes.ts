// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Device, Identity, WireMount, WirePath, WireVolumes } from "../ipc";

// Fixtures for the volume tests. A volume's identity is derived from its label, so two volumes
// with different labels are on different disks and the same label is the same disk.

const p = (v: string): WirePath => ({ k: "Utf8", v });

export const known = (label: string): Identity => {
  const sum = [...label].reduce((n, c) => n + c.charCodeAt(0), 0);
  return { state: "known", major: 8, minor: sum % 256, diskseq: 1000 + sum };
};

/** The `disk` argument for the identity `known(label)`. */
export const diskOf = (label: string) => {
  const id = known(label);
  if (id.state !== "known") throw new Error("known() is known");
  return { major: id.major, minor: id.minor, diskseq: id.diskseq };
};

export const mount = (label: string, over: Partial<WireMount> = {}): WireMount => ({
  mount_point: p(`/run/media/t/${label}`),
  identity: known(label),
  device: "/dev/sdb1",
  fs_type: "vfat",
  label,
  removable: true,
  read_only: false,
  ...over,
});

export const device = (label: string, over: Partial<Device> = {}): Device => ({
  object_path: `/org/freedesktop/UDisks2/block_devices/${label}`,
  device: `/dev/${label}`,
  label,
  fs_type: "ext4",
  size: 8_000_000_000,
  system: false,
  uuid: `uuid-${label}`,
  identity: known(label),
  ...over,
});

export const volumes = (v: Partial<WireVolumes>): WireVolumes => ({
  mounted: [],
  unmounted: [],
  problems: [],
  ...v,
});

export const problem = (kind: string, message = kind) => ({
  kind,
  message,
  path: null,
  details: null,
});
