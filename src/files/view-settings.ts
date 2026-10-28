// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { create } from "zustand";
import {
  EVENT_SETTINGS_CHANGED,
  on,
  settingsGet,
  settingsSet,
  toWireError,
  type Density,
  type Settings,
  type SettingsPatch,
  type ViewMode,
  type WireError,
} from "../ipc";
import { DEFAULT_INTERFACE_SIZE, stepInterfaceSize } from "../theme/interface-size";

// The settings the folder view follows (design 7.2): whether hidden files show,
// list or grid, the density that sets the row height, and the interface size
// (the zoom itself is applied by the backend; the actions step it). The stored settings
// are the source; this holds their last known value for the view and for the
// actions (Ctrl+H, the view buttons), which write through settings_set.
interface ViewSettingsState {
  loaded: boolean;
  showHidden: boolean;
  viewMode: ViewMode;
  density: Density;
  /** The interface size in percent. */
  interfaceSize: number;
  /** The last read or write that failed, until the next one succeeds. */
  error: WireError | null;
}

export const useViewSettings = create<ViewSettingsState>()(() => ({
  loaded: false,
  showHidden: false,
  viewMode: "list",
  density: "cozy",
  interfaceSize: DEFAULT_INTERFACE_SIZE,
  error: null,
}));

function apply(s: Settings): void {
  useViewSettings.setState({
    loaded: true,
    showHidden: s.show_hidden,
    viewMode: s.view_mode,
    density: s.density,
    interfaceSize: s.interface_size,
    error: null,
  });
}

/** Reads the stored settings; a failure is kept in `error`. */
export async function loadViewSettings(): Promise<void> {
  try {
    apply(await settingsGet());
  } catch (e) {
    useViewSettings.setState({ error: toWireError(e) });
  }
}

async function write(patch: SettingsPatch): Promise<void> {
  try {
    apply(await settingsSet(patch));
  } catch (e) {
    useViewSettings.setState({ error: toWireError(e) });
  }
}

export const toggleHidden = () => write({ show_hidden: !useViewSettings.getState().showHidden });
export const setViewMode = (view_mode: ViewMode) => write({ view_mode });
export const setInterfaceSize = (interface_size: number) => write({ interface_size });
export const stepSize = (direction: 1 | -1) =>
  setInterfaceSize(stepInterfaceSize(useViewSettings.getState().interfaceSize, direction));

/** Keeps the store in step with the stored settings while a folder view is mounted. */
export function useViewSettingsSync(): void {
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void loadViewSettings();
    on(EVENT_SETTINGS_CHANGED, apply).then(
      (u) => (alive ? (unlisten = u) : u()),
      (e: unknown) => alive && useViewSettings.setState({ error: toWireError(e) })
    );
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
}
