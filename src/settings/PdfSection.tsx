// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PanelSide, PdfLayout, Settings } from "../ipc";
import { ALLOWED_SIDES, SIDE_TITLES, type PanelId } from "../pdf/panel-placement";
import { GRID_ACROSS_MAX, GRID_ACROSS_MIN } from "../pdf/view-layout";
import { useSettingsDraft } from "./settings-draft";
import { Choices, Group, Row } from "./settings-ui";

// PDF: how the pages of every PDF are laid out, how many a row of the grid holds, and the side
// each of the two panels sits on (the thumbnails never on top). The View menu and its keys change the layout at once, and the
// panels' own buttons move and fold them; these are what a PDF opens with next time.

const LAYOUTS: readonly { value: PdfLayout; label: string }[] = [
  { value: "scroll", label: "Continuous scroll" },
  { value: "single", label: "Single page" },
  { value: "spread", label: "Two pages" },
  { value: "grid", label: "Grid" },
];

const sideOptions = (id: PanelId): readonly { value: PanelSide; label: string }[] =>
  ALLOWED_SIDES[id].map((value) => ({ value, label: SIDE_TITLES[value] }));

export function PdfSection(props: { settings: Settings }) {
  const { settings } = props;
  const edit = useSettingsDraft((s) => s.edit);
  const step = (direction: 1 | -1) =>
    edit({
      pdf_grid_across: Math.min(
        GRID_ACROSS_MAX,
        Math.max(GRID_ACROSS_MIN, settings.pdf_grid_across + direction)
      ),
    });
  const place = (id: PanelId, side: PanelSide) =>
    edit({
      pdf_panels: {
        ...settings.pdf_panels,
        [id]: { ...settings.pdf_panels[id], side },
      },
    });
  return (
    <>
      <Group rows={["pdf_layout", "pdf_grid_across"]}>
        <Row
          id="pdf_layout"
          note="Every PDF follows it; View in the menu changes it while one is open"
        >
          <Choices
            label="Page layout"
            value={settings.pdf_layout}
            options={LAYOUTS}
            onChange={(pdf_layout) => edit({ pdf_layout })}
          />
        </Row>
        <Row id="pdf_grid_across" note="Pages in a row of the grid layout">
          <div className="kern-settings-stepper">
            <button
              type="button"
              className="kern-button"
              aria-label="Fewer columns"
              disabled={settings.pdf_grid_across <= GRID_ACROSS_MIN}
              onClick={() => step(-1)}
            >
              −
            </button>
            <output aria-label="Grid columns">{settings.pdf_grid_across}</output>
            <button
              type="button"
              className="kern-button"
              aria-label="More columns"
              disabled={settings.pdf_grid_across >= GRID_ACROSS_MAX}
              onClick={() => step(1)}
            >
              +
            </button>
          </div>
        </Row>
      </Group>
      <Group rows={["pdf_thumbnails_panel", "pdf_tools_panel"]}>
        <Row id="pdf_thumbnails_panel" note="The small pictures of the pages, beside every PDF">
          <Choices
            label="Thumbnails panel"
            value={settings.pdf_panels.thumbnails.side}
            options={sideOptions("thumbnails")}
            onChange={(side) => place("thumbnails", side)}
          />
        </Row>
        <Row id="pdf_tools_panel" note="Find, select and the page layout, beside every PDF">
          <Choices
            label="Tools panel"
            value={settings.pdf_panels.tools.side}
            options={sideOptions("tools")}
            onChange={(side) => place("tools", side)}
          />
        </Row>
      </Group>
    </>
  );
}
