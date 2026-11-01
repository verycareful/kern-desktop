// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WirePath } from "./wire-path";
import type { WireError } from "./invoke";
import type {
  DirEvent,
  OpConflictEvent,
  OpDoneEvent,
  OpProgressEvent,
  SearchHitEvent,
  ThumbEvent,
  VolumesChanged,
  WireTheme,
} from "./kernkraft";
import type {
  CorruptReport,
  DragFiles,
  DragLeave,
  DragOver,
  DragRefusal,
  DropPayload,
  DropRefused,
  Directive,
  Pins,
  Recents,
  Settings,
} from "./app";

export type { UnlistenFn };

// kernkraft's events (kernkraft-tauri: EVENT_* constants).
export const EVENT_OP_PROGRESS = "kernkraft://op-progress";
export const EVENT_OP_CONFLICT = "kernkraft://op-conflict";
export const EVENT_OP_DONE = "kernkraft://op-done";
export const EVENT_SEARCH_HIT = "kernkraft://search-hit";
export const EVENT_DIR_CHANGED = "kernkraft://dir-changed";
export const EVENT_DIR_GONE = "kernkraft://dir-gone";
export const EVENT_THUMB = "kernkraft://thumb";
export const EVENT_THEME_CHANGED = "kernkraft://theme-changed";
export const EVENT_VOLUMES_CHANGED = "kernkraft://volumes-changed";

// Kern's own events (src-tauri: store_cmds.rs, windows.rs, dnd.rs).
export const EVENT_SETTINGS_CHANGED = "kern://settings-changed";
export const EVENT_PINS_CHANGED = "kern://pins-changed";
export const EVENT_RECENTS_CHANGED = "kern://recents-changed";
export const EVENT_STORE_ERROR = "kern://store-error";
export const EVENT_DROP = "kern://drop";
export const EVENT_DROP_REFUSED = "kern://drop-refused";
export const EVENT_DRAG_OVER = "kern://drag-over";
export const EVENT_DRAG_FILES = "kern://drag-files";
export const EVENT_DRAG_REFUSAL = "kern://drag-refusal";
export const EVENT_DRAG_LEAVE = "kern://drag-leave";
export const EVENT_OPEN = "kern://open";
export const EVENT_ADOPT_DOC = "kern://adopt-doc";
export const EVENT_ADOPT_CANCELLED = "kern://adopt-cancelled";
export const EVENT_OPEN_ERROR = "kern://open-error";
export const EVENT_CLOSE_REQUESTED = "kern://close-requested";
export const EVENT_SELECT = "kern://select";
export const EVENT_PROPERTIES = "kern://properties";

// Event name to payload. `kern://close-requested` is emitted with the unit
// value, which arrives as null. `kern://select` and `kern://properties` are
// shaped as the doc comments of their constants in windows.rs describe.
export interface EventPayloads {
  "kernkraft://op-progress": OpProgressEvent;
  "kernkraft://op-conflict": OpConflictEvent;
  "kernkraft://op-done": OpDoneEvent;
  "kernkraft://search-hit": SearchHitEvent;
  "kernkraft://dir-changed": DirEvent;
  "kernkraft://dir-gone": DirEvent;
  "kernkraft://thumb": ThumbEvent;
  "kernkraft://theme-changed": WireTheme;
  "kernkraft://volumes-changed": VolumesChanged;
  "kern://settings-changed": Settings;
  "kern://pins-changed": Pins;
  "kern://recents-changed": Recents;
  "kern://store-error": CorruptReport;
  "kern://drop": DropPayload;
  "kern://drop-refused": DropRefused;
  "kern://drag-over": DragOver;
  "kern://drag-files": DragFiles;
  "kern://drag-refusal": DragRefusal;
  "kern://drag-leave": DragLeave;
  "kern://open": Directive;
  "kern://adopt-doc": { path: WirePath; text_state: unknown; from: string };
  "kern://adopt-cancelled": { label: string };
  "kern://open-error": WireError;
  "kern://close-requested": null;
  "kern://select": { tab: WirePath; paths: WirePath[] };
  "kern://properties": { paths: WirePath[] };
}

export type EventName = keyof EventPayloads;

// Subscribes to an event; the handler gets the payload itself. Call the
// returned function to unsubscribe.
export function on<K extends EventName>(
  name: K,
  handler: (payload: EventPayloads[K]) => void
): Promise<UnlistenFn> {
  return listen<EventPayloads[K]>(name, (event) => handler(event.payload));
}
