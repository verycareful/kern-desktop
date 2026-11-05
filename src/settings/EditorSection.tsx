// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Settings } from "../ipc";
import { useSettingsDraft } from "./settings-draft";
import { Group, Row, Toggle } from "./settings-ui";

// Editor: word wrap, and the zoom of the text editor's font.

/** The zoom the store accepts (src-tauri/src/store.rs ZOOM_MIN, ZOOM_MAX). */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
/** A quarter of the unzoomed size per step: 25% steps. */
const ZOOM_STEP = 0.25;

const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function EditorSection(props: { settings: Settings }) {
  const { settings } = props;
  const edit = useSettingsDraft((s) => s.edit);
  const percent = Math.round(settings.editor_zoom * 100);
  const step = (direction: 1 | -1) =>
    edit({ editor_zoom: clampZoom(settings.editor_zoom + direction * ZOOM_STEP) });
  return (
    <Group rows={["word_wrap", "text_size"]}>
      <Row id="word_wrap" note="Lines longer than the window wrap instead of scrolling">
        <Toggle
          label="Wrap long lines"
          on={settings.word_wrap}
          onChange={(word_wrap) => edit({ word_wrap })}
        />
      </Row>
      <Row id="text_size" note="Editor text only">
        <div className="kern-settings-stepper">
          <button
            type="button"
            className="kern-button"
            aria-label="Smaller text"
            disabled={settings.editor_zoom <= ZOOM_MIN}
            onClick={() => step(-1)}
          >
            −
          </button>
          <output aria-label="Text size">{percent}%</output>
          <button
            type="button"
            className="kern-button"
            aria-label="Larger text"
            disabled={settings.editor_zoom >= ZOOM_MAX}
            onClick={() => step(1)}
          >
            +
          </button>
        </div>
      </Row>
    </Group>
  );
}
