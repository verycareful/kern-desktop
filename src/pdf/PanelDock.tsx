// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, EllipsisVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useViewSettings } from "../files/view-settings";
import { ActionMenu, type MenuSection } from "../keys/ActionMenu";
import { currentContext, getAction, runAction } from "../keys/actions";
import { useBindLabel } from "../keys/binds";
import {
  ALLOWED_SIDES,
  PANEL_TITLES,
  arrangePanels,
  type PanelId,
  type PanelPlacement,
  type Side,
} from "./panel-placement";
import { PdfPages } from "./PdfPages";
import { ThumbnailStrip } from "./ThumbnailStrip";
import { thumbCache } from "./thumb-cache";
import { ToolsPanel } from "./ToolsPanel";
import type { PdfDoc } from "./usePdfDoc";
import { usePageSizes } from "./usePageSizes";

// The pages of an open PDF with its two panels around them, each on the side the settings name.
// The thumbnails and the pages are given the sizes of the pages read once here.
export function PanelDock(props: { tabId: string; doc: PdfDoc; active: boolean }) {
  const { tabId, doc, active } = props;
  const panels = useViewSettings((s) => s.pdfPanels);
  const { sizes, readAt, error } = usePageSizes(
    doc.handle,
    doc.pages,
    doc.revision,
    doc.pageRevisions
  );
  const arranged = arrangePanels(panels);

  // A closed document's thumbnails are of no use to a handle the engine may give out again.
  const { handle } = doc;
  useEffect(
    () => () => {
      if (handle !== undefined) thumbCache.dropDocument(handle);
    },
    [handle]
  );

  const column = (side: "left" | "right") =>
    arranged[side].length > 0 && (
      <div
        className={`kern-pdf-dock-column kern-pdf-dock-${side}`}
        data-testid={`pdf-dock-${side}`}
      >
        {arranged[side].map((id) => (
          <Panel key={id} id={id} tabId={tabId} placement={panels[id]}>
            {id === "thumbnails" ? (
              <ThumbnailStrip
                tabId={tabId}
                doc={doc}
                sizes={sizes}
                sizesAt={readAt}
                horizontal={false}
              />
            ) : (
              <ToolsPanel tabId={tabId} doc={doc} collapsed={panels[id].collapsed} />
            )}
          </Panel>
        ))}
      </div>
    );

  const row = (side: "top" | "bottom") =>
    arranged[side].length > 0 && (
      <div className={`kern-pdf-dock-row kern-pdf-dock-${side}`} data-testid={`pdf-dock-${side}`}>
        {arranged[side].map((id) => (
          <Panel key={id} id={id} tabId={tabId} placement={panels[id]}>
            {id === "thumbnails" ? (
              <ThumbnailStrip tabId={tabId} doc={doc} sizes={sizes} sizesAt={readAt} horizontal />
            ) : (
              <ToolsPanel tabId={tabId} doc={doc} collapsed={panels[id].collapsed} />
            )}
          </Panel>
        ))}
      </div>
    );

  return (
    <div className="kern-pdf-dock" data-testid="pdf-dock">
      {row("top")}
      <div className="kern-pdf-dock-main">
        {column("left")}
        <div className="kern-pdf-dock-centre">
          <PdfPages
            tabId={tabId}
            doc={doc}
            active={active}
            sizes={sizes}
            sizesAt={readAt}
            sizeError={error}
          />
        </div>
        {column("right")}
      </div>
      {row("bottom")}
    </div>
  );
}

// The chevron that folds a panel points where the panel goes: toward its own side's edge.
const FOLD_ICON: Record<Side, { fold: typeof ChevronLeft; unfold: typeof ChevronLeft }> = {
  top: { fold: ChevronUp, unfold: ChevronDown },
  left: { fold: ChevronLeft, unfold: ChevronRight },
  right: { fold: ChevronRight, unfold: ChevronLeft },
  bottom: { fold: ChevronDown, unfold: ChevronUp },
};

// A panel: a header with its name, a menu that moves it and a button that folds it to its
// icons, over what it holds. Both buttons run the actions of the table.
function Panel(props: {
  id: PanelId;
  tabId: string;
  placement: PanelPlacement;
  children: React.ReactNode;
}) {
  const { id, tabId, placement } = props;
  const { side, collapsed } = placement;
  const title = PANEL_TITLES[id];
  const toggle = getAction(`pdf.panel.${id}.toggle`);
  const toggleKey = useBindLabel(toggle);
  const moveButton = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const icons = FOLD_ICON[side];
  const Fold = collapsed ? icons.unfold : icons.fold;
  const foldLabel = `${collapsed ? "Expand" : "Collapse"} ${title}`;
  const sections: MenuSection[] = [
    {
      title: `Move ${title}`,
      actions: ALLOWED_SIDES[id].map((to) => getAction(`pdf.panel.${id}.move.${to}`)),
    },
  ];
  return (
    <aside
      className={`kern-pdf-panel kern-pdf-panel-${side}`}
      aria-label={title}
      data-testid={`pdf-panel-${id}`}
      data-side={side}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <header className="kern-pdf-panel-header">
        {!collapsed && <h2 className="kern-pdf-panel-title">{title}</h2>}
        {!collapsed && (
          <button
            ref={moveButton}
            type="button"
            className="kern-icon-button kern-pdf-panel-button"
            aria-label={`Move ${title}`}
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            onClick={() => {
              const box = moveButton.current?.getBoundingClientRect();
              setMenuAt({ x: box?.left ?? 0, y: box?.bottom ?? 0 });
            }}
          >
            <EllipsisVertical size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="kern-icon-button kern-pdf-panel-button"
          aria-label={foldLabel}
          aria-expanded={!collapsed}
          title={toggleKey ? `${foldLabel} (${toggleKey})` : foldLabel}
          onClick={() => runAction(toggle, currentContext(tabId))}
        >
          <Fold size={16} strokeWidth={2} aria-hidden />
        </button>
      </header>
      {/* A folded thumbnail strip has nothing to show; the tools stay as their icons. */}
      {(id === "tools" || !collapsed) && (
        <div className="kern-pdf-panel-body">{props.children}</div>
      )}
      {menuAt && (
        <ActionMenu
          sections={sections}
          x={menuAt.x}
          y={menuAt.y}
          targetId={tabId}
          onClose={() => setMenuAt(null)}
        />
      )}
    </aside>
  );
}
