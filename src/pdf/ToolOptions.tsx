// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef } from "react";
import { PALETTE, INK_WIDTHS, cssColour, sameColour } from "./annotations";
import { usePdfSelection } from "./pdf-selection";
import { usePdfTool } from "./pdf-tool";

// The colour a new annotation is drawn in, and the width of the pen's line. It is never a popup: it
// is a fixed part of the layout while it applies. The pen in hand needs both; selected text needs
// the colour alone, for highlight, underline and strike out. Otherwise nothing is drawn, so the
// space it would take is not taken. The colours are document content, so they are fixed and never
// follow the theme.
//
// `row` runs under or over a bar, `column` stands beside a rail, and `inline` sits among the rows
// of a panel that shows names; that panel scrolls, so the options are brought into view when they
// appear.
export type OptionsLayout = "row" | "column" | "inline";

export function ToolOptions(props: { tabId: string; layout: OptionsLayout }) {
  const { tabId, layout } = props;
  const penInHand = usePdfTool((s) => s.byTab[tabId]?.tool === "ink");
  const textSelected = usePdfSelection((s) => s.byTab[tabId] !== undefined);
  const colour = usePdfTool((s) => s.byTab[tabId]?.colour ?? null);
  const width = usePdfTool((s) => s.byTab[tabId]?.inkWidth);
  const shown = penInHand || textSelected;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown && layout === "inline") box.current?.scrollIntoView?.({ block: "nearest" });
  }, [shown, layout]);
  if (!shown) return null;
  const { setColour, setInkWidth } = usePdfTool.getState();
  const captions = layout !== "column";
  return (
    <div
      ref={box}
      className={`kern-pdf-options kern-pdf-options-${layout}`}
      role="group"
      aria-label={penInHand ? "Colour and pen width" : "Colour"}
      data-testid="pdf-tool-options"
    >
      {captions && <span className="kern-pdf-options-caption">{penInHand ? "Pen" : "Colour"}</span>}
      <div className="kern-pdf-options-set">
        {PALETTE.map((swatch) => (
          <button
            key={swatch.name}
            type="button"
            className="kern-pdf-swatch"
            aria-label={`Colour ${swatch.name}`}
            title={swatch.name}
            aria-pressed={colour ? sameColour(colour, swatch.rgb) : false}
            style={{ background: cssColour(swatch.rgb) }}
            onClick={() => setColour(tabId, swatch.rgb)}
          />
        ))}
      </div>
      {penInHand && (
        <>
          <span className="kern-pdf-options-divider" role="separator" aria-hidden />
          {captions && <span className="kern-pdf-options-caption">Width</span>}
          <div className="kern-pdf-options-set">
            {INK_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className="kern-pdf-width"
                aria-label={`Pen width ${w} points`}
                title={`Pen width ${w} pt`}
                aria-pressed={width === w}
                onClick={() => setInkWidth(tabId, w)}
              >
                {w}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
