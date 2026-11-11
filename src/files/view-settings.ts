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
  type Panel,
  type Settings,
  type SettingsPatch,
  type TimeFormat,
  type ViewMode,
  type WireError,
  type WirePath,
} from "../ipc";
import { DEFAULT_EDITOR_PANEL_ORDER, DEFAULT_PANEL_ORDER } from "../shell/panel-order";
import { DEFAULT_INTERFACE_SIZE } from "../theme/interface-size";

// The settings the folder view follows: whether hidden files show,
// list or grid, the interface size (the zoom itself is applied by the
// backend), the folders the Library walks, and what a new tab opens. The stored settings
// are the source; this holds their last known value for the view and for the
// actions (Ctrl+H, the view buttons), which write through settings_set.
interface ViewSettingsState {
  loaded: boolean;
  showHidden: boolean;
  /** Per area, a single click opens an entry; off means a double-click does. */
  singleClickLeft: boolean;
  singleClickRight: boolean;
  singleClickCentre: boolean;
  singleClickEditor: boolean;
  viewMode: ViewMode;
  /** The clock the time of day is shown in. */
  timeFormat: TimeFormat;
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
  /** The file manager's three columns, and the editor layout's two panels, left to right. */
  panelOrder: Panel[];
  editorPanelOrder: Panel[];
  /** The last read or write that failed, until the next one succeeds. */
  error: WireError | null;
}

export const useViewSettings = create<ViewSettingsState>()(() => ({
  loaded: false,
  showHidden: false,
  singleClickLeft: true,
  singleClickRight: false,
  singleClickCentre: false,
  singleClickEditor: false,
  viewMode: "list",
  timeFormat: "system",
  interfaceSize: DEFAULT_INTERFACE_SIZE,
  scanDocuments: true,
  scanDownloads: true,
  scanRoots: [],
  wordWrap: false,
  editorZoom: 1,
  newTabFolder: null,
  newTabDefault: "folder",
  panelOrder: DEFAULT_PANEL_ORDER,
  editorPanelOrder: DEFAULT_EDITOR_PANEL_ORDER,
  error: null,
}));

function apply(s: Settings): void {
  useViewSettings.setState({
    loaded: true,
    showHidden: s.show_hidden,
    singleClickLeft: s.single_click_left,
    singleClickRight: s.single_click_right,
    singleClickCentre: s.single_click_centre,
    singleClickEditor: s.single_click_editor,
    viewMode: s.view_mode,
    timeFormat: s.time_format,
    interfaceSize: s.interface_size,
    scanDocuments: s.scan_documents,
    scanDownloads: s.scan_downloads,
    scanRoots: s.scan_roots,
    wordWrap: s.word_wrap,
    editorZoom: s.editor_zoom,
    newTabFolder: s.new_tab_folder,
    newTabDefault: s.new_tab_default,
    panelOrder: s.panel_order,
    editorPanelOrder: s.editor_panel_order,
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

/** The parts of a window that each have their own click setting. */
export type ClickArea = "left" | "right" | "centre" | "editor";

/** Whether a single click opens an entry in `area`; off means a double-click does. */
export function useSingleClick(area: ClickArea): boolean {
  return useViewSettings((v) => {
    switch (area) {
      case "left":
        return v.singleClickLeft;
      case "right":
        return v.singleClickRight;
      case "centre":
        return v.singleClickCentre;
      case "editor":
        return v.singleClickEditor;
    }
  });
}

/** The file manager's three columns, left to right. */
export function usePanelOrder(): Panel[] {
  return useViewSettings((v) => v.panelOrder);
}

/** The editor layout's two panels, left to right around the editor. */
export function useEditorPanelOrder(): Panel[] {
  return useViewSettings((v) => v.editorPanelOrder);
}
