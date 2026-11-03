// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useId } from "react";
import type { Settings } from "../ipc";
import { useSettings } from "./settings-store";

// Editor: word wrap, and the zoom of the text editor's font.

/** The zoom the store accepts (src-tauri/src/store.rs ZOOM_MIN, ZOOM_MAX). */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
/** A quarter of the unzoomed size per step: 25% steps, as the range shows them. */
const ZOOM_STEP = 0.25;

export function EditorSection(props: { settings: Settings }) {
  const { settings } = props;
  const id = useId();
  const change = useSettings((s) => s.change);
  const percent = Math.round(settings.editor_zoom * 100);
  return (
    <section className="kern-settings-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Editor</h2>
      <label className="kern-settings-choice">
        <input
          type="checkbox"
          checked={settings.word_wrap}
          onChange={(e) => void change({ word_wrap: e.target.checked }, "Word wrap")}
        />
        Wrap long lines
      </label>
      <label htmlFor={`${id}-zoom`}>Text size</label>
      <input
        id={`${id}-zoom`}
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={ZOOM_STEP}
        value={settings.editor_zoom}
        aria-valuetext={`${percent}%`}
        onChange={(e) => void change({ editor_zoom: Number(e.target.value) }, "The text size")}
      />
      <output htmlFor={`${id}-zoom`}>{percent}%</output>
    </section>
  );
}
