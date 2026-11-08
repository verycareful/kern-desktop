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
  type NewTabDefault,
  type Settings,
  type SettingsPatch,
  type ViewMode,
  type WireError,
  type WirePath,
} from "../ipc";
import { DEFAULT_INTERFACE_SIZE } from "../theme/interface-size";

// The settings the folder view follows: whether hidden files show,
// list or grid, the interface size (the zoom itself is applied by the
// backend), the folders the Library walks, and what a new tab opens. The stored settings
// are the source; this holds their last known value for the view and for the
// actions (Ctrl+H, the view buttons), which write through settings_set.
interface ViewSettingsState {
  loaded: boolean;
  showHidden: boolean;
  /** A single click opens an entry; off means a double-click does. */
  singleClick: boolean;
  viewMode: ViewMode;
  /** The interface size in percent. */
  interfaceSize: number;
  /** What the Library walks: the Documents and Downloads folders when on, and these. */
  scanDocuments: boolean;
  scanDownloads: boolean;
  scanRoots: WirePath[];
  /** The editor: wrap long lines, and the text zoom factor (0.25 to 5.0). */
  wordWrap: boolean;
  editorZoom: number;
  /** The folder a new tab opens; null is Home. */
  newTabFolder: WirePath | null;
  /** Which of the two new tabs Ctrl+T opens. */
  newTabDefault: NewTabDefault;
  /** The last read or write that failed, until the next one succeeds. */
  error: WireError | null;
}

export const useViewSettings = create<ViewSettingsState>()(() => ({
  loaded: false,
  showHidden: false,
  singleClick: false,
  viewMode: "list",
  interfaceSize: DEFAULT_INTERFACE_SIZE,
  scanDocuments: true,
  scanDownloads: true,
  scanRoots: [],
  wordWrap: false,
  editorZoom: 1,
  newTabFolder: null,
  newTabDefault: "folder",
  error: null,
}));

function apply(s: Settings): void {
  useViewSettings.setState({
    loaded: true,
    showHidden: s.show_hidden,
    singleClick: s.single_click,
    viewMode: s.view_mode,
    interfaceSize: s.interface_size,
    scanDocuments: s.scan_documents,
    scanDownloads: s.scan_downloads,
    scanRoots: s.scan_roots,
    wordWrap: s.word_wrap,
    editorZoom: s.editor_zoom,
    newTabFolder: s.new_tab_folder,
    newTabDefault: s.new_tab_default,
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
export const setScanFolder = (folder: "documents" | "downloads", on: boolean) =>
  write(folder === "documents" ? { scan_documents: on } : { scan_downloads: on });

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
