// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  Columns2,
  Eraser,
  File,
  FileOutput,
  Highlighter,
  LayoutGrid,
  Merge,
  MousePointer2,
  Pen,
  Redo2,
  RefreshCcw,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Rows3,
  Search,
  Split,
  StickyNote,
  Strikethrough,
  TextSelect,
  Trash2,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { currentContext, getAction, isEnabled, runAction } from "../keys/actions";
import { useBindLabel } from "../keys/binds";
import { useViewSettings } from "../files/view-settings";
import { PALETTE, INK_WIDTHS, cssColour, sameColour } from "./annotations";
import { usePageSelection } from "./page-selection";
import { usePdfSelection } from "./pdf-selection";
import { usePdfTool, type PdfTool } from "./pdf-tool";
import type { PdfDoc } from "./usePdfDoc";

// The tools beside an open PDF: Find (its session switches it on), Select all text, the edits
// (rotate, undo, redo) and the page layout. Expanded each is an icon and its name; collapsed only the icon is left, and the name
// is its title. Later tools join this list.

interface Tool {
  id: string;
  label: string;
  Icon: LucideIcon;
}

const LAYOUT_TOOLS: readonly Tool[] = [
  { id: "pdf.layout.scroll", label: "Continuous scroll", Icon: Rows3 },
  { id: "pdf.layout.single", label: "Single page", Icon: File },
  { id: "pdf.layout.spread", label: "Two pages", Icon: Columns2 },
  { id: "pdf.layout.grid", label: "Grid of pages", Icon: LayoutGrid },
];

// An edit tool is available while the document can be changed, and undo and redo while the
// engine has a step to go back or forward to.
type EditNeeds = "edit" | "undo" | "redo";

const EDIT_TOOLS: readonly (Tool & { needs: EditNeeds })[] = [
  { id: "pdf.rotate.cw", label: "Rotate page clockwise", Icon: RotateCw, needs: "edit" },
  { id: "pdf.rotate.ccw", label: "Rotate page counterclockwise", Icon: RotateCcw, needs: "edit" },
  { id: "pdf.rotateAll.cw", label: "Rotate all pages clockwise", Icon: RefreshCw, needs: "edit" },
  {
    id: "pdf.rotateAll.ccw",
    label: "Rotate all pages counterclockwise",
    Icon: RefreshCcw,
    needs: "edit",
  },
  { id: "pdf.undo", label: "Undo", Icon: Undo2, needs: "undo" },
  { id: "pdf.redo", label: "Redo", Icon: Redo2, needs: "redo" },
];

// What is done to whole pages: the ones chosen in the strip or the grid (Remove), and new files made
// from the document (Merge, Extract, Split), which are available whenever it is open.
const REMOVE_TOOL: Tool = { id: "pdf.page.remove", label: "Remove chosen pages", Icon: Trash2 };
const FILE_TOOLS: readonly Tool[] = [
  { id: "pdf.merge", label: "Merge PDFs…", Icon: Merge },
  { id: "pdf.extract", label: "Extract pages…", Icon: FileOutput },
  { id: "pdf.split", label: "Split into files…", Icon: Split },
];

// The tools in hand: Select picks text and annotations, Pen and Note act on the page where they
// are pressed. One is in hand at a time.
const HAND_TOOLS: readonly (Tool & { hand: PdfTool })[] = [
  {
    id: "pdf.tool.select",
    label: "Select text and annotations",
    Icon: MousePointer2,
    hand: "select",
  },
  { id: "pdf.tool.ink", label: "Draw with the pen", Icon: Pen, hand: "ink" },
  { id: "pdf.note.add", label: "Add a note", Icon: StickyNote, hand: "note" },
];

// Marking the selected text, and taking away the annotation that is picked.
const MARK_TOOLS: readonly Tool[] = [
  { id: "pdf.markup.highlight", label: "Highlight the selected text", Icon: Highlighter },
  { id: "pdf.markup.underline", label: "Underline the selected text", Icon: Underline },
  { id: "pdf.markup.strikeout", label: "Strike out the selected text", Icon: Strikethrough },
];
const DELETE_ANNOTATION_TOOL: Tool = {
  id: "pdf.annotation.delete",
  label: "Delete the picked annotation",
  Icon: Eraser,
};

// Find and selecting the page's text are actions of the table.
const FIND_TOOL: Tool = { id: "pdf.find", label: "Find", Icon: Search };
const SELECT_TOOL: Tool = { id: "pdf.selectAll", label: "Select all text", Icon: TextSelect };

export function ToolsPanel(props: { tabId: string; doc: PdfDoc; collapsed: boolean }) {
  const { tabId, doc, collapsed } = props;
  const chosen = usePageSelection((st) => (st.byTab[tabId]?.pages.length ?? 0) > 0);
  const textSelected = usePdfSelection((st) => st.byTab[tabId] !== undefined);
  const annotationPicked = usePdfTool((st) => (st.byTab[tabId]?.picked ?? null) !== null);
  const available: Record<EditNeeds, boolean> = {
    edit: doc.canEdit,
    undo: doc.canEdit && doc.canUndo,
    redo: doc.canEdit && doc.canRedo,
  };
  return (
    <div
      className="kern-pdf-tools"
      role="toolbar"
      aria-label="PDF tools"
      aria-orientation="vertical"
      data-testid="pdf-tools"
    >
      <ToolGroup title="Search and select" collapsed={collapsed}>
        <ActionButton
          tabId={tabId}
          tool={FIND_TOOL}
          collapsed={collapsed}
          available={doc.phase === "ready" && doc.pages > 0}
        />
        <ActionButton
          tabId={tabId}
          tool={SELECT_TOOL}
          collapsed={collapsed}
          available={doc.phase === "ready" && doc.pages > 0}
        />
      </ToolGroup>
      <ToolGroup title="Edit" collapsed={collapsed}>
        {EDIT_TOOLS.map((tool) => (
          <ActionButton
            key={tool.id}
            tabId={tabId}
            tool={tool}
            collapsed={collapsed}
            available={available[tool.needs]}
          />
        ))}
      </ToolGroup>
      <ToolGroup title="Annotate" collapsed={collapsed}>
        {HAND_TOOLS.map((tool) => (
          <HandButton
            key={tool.id}
            tabId={tabId}
            tool={tool}
            collapsed={collapsed}
            available={tool.hand === "select" ? doc.phase === "ready" : doc.canEdit}
          />
        ))}
        {MARK_TOOLS.map((tool) => (
          <ActionButton
            key={tool.id}
            tabId={tabId}
            tool={tool}
            collapsed={collapsed}
            available={doc.canEdit && textSelected}
          />
        ))}
        <ActionButton
          tabId={tabId}
          tool={DELETE_ANNOTATION_TOOL}
          collapsed={collapsed}
          available={doc.canEdit && annotationPicked}
        />
        <ColourRow tabId={tabId} />
      </ToolGroup>
      <ToolGroup title="Pages" collapsed={collapsed}>
        <ActionButton
          tabId={tabId}
          tool={REMOVE_TOOL}
          collapsed={collapsed}
          available={doc.canEdit && chosen}
        />
        {FILE_TOOLS.map((tool) => (
          <ActionButton
            key={tool.id}
            tabId={tabId}
            tool={tool}
            collapsed={collapsed}
            available={doc.phase === "ready" && doc.pages > 0 && !doc.moving}
          />
        ))}
      </ToolGroup>
      <ToolGroup title="Layout" collapsed={collapsed}>
        {LAYOUT_TOOLS.map((tool) => (
          <LayoutButton key={tool.id} tabId={tabId} tool={tool} collapsed={collapsed} />
        ))}
      </ToolGroup>
    </div>
  );
}

function ToolGroup(props: { title: string; collapsed: boolean; children: React.ReactNode }) {
  return (
    <div className="kern-pdf-tool-group" role="group" aria-label={props.title}>
      {!props.collapsed && <h3 className="kern-pdf-tool-group-title">{props.title}</h3>}
      {props.children}
    </div>
  );
}

function ToolButton(props: {
  tool: Tool;
  collapsed: boolean;
  disabled?: boolean;
  pressed?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const { tool, collapsed, disabled, pressed, onClick } = props;
  const { Icon } = tool;
  return (
    <button
      type="button"
      className="kern-pdf-tool"
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={tool.label}
      title={props.title ?? tool.label}
      data-collapsed={collapsed ? "true" : undefined}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={2} aria-hidden />
      {!collapsed && <span className="kern-pdf-tool-label">{tool.label}</span>}
    </button>
  );
}

// A layout is an action of the table, so the button runs it as the menu and the key do, and is
// pressed while the setting is the layout it stands for.
function LayoutButton(props: { tabId: string; tool: Tool; collapsed: boolean }) {
  const { tabId, tool, collapsed } = props;
  const action = getAction(tool.id);
  const key = useBindLabel(action);
  const layout = useViewSettings((s) => s.pdfLayout);
  const pressed = tool.id === `pdf.layout.${layout}`;
  const ctx = currentContext(tabId);
  return (
    <ToolButton
      tool={tool}
      collapsed={collapsed}
      pressed={pressed}
      disabled={!isEnabled(action, ctx)}
      title={key ? `${tool.label} (${key})` : tool.label}
      onClick={() => runAction(action, currentContext(tabId))}
    />
  );
}

// An edit is an action of the table too. The panel shows whether it is available from the
// document it was given, so the button follows each edit as it is made.
function ActionButton(props: {
  tabId: string;
  tool: Tool;
  collapsed: boolean;
  available: boolean;
}) {
  const { tabId, tool, collapsed, available } = props;
  const action = getAction(tool.id);
  const key = useBindLabel(action);
  return (
    <ToolButton
      tool={tool}
      collapsed={collapsed}
      disabled={!available}
      title={key ? `${tool.label} (${key})` : tool.label}
      onClick={() => runAction(action, currentContext(tabId))}
    />
  );
}

// A tool in hand is an action of the table, and is pressed while it is the one in hand.
function HandButton(props: {
  tabId: string;
  tool: Tool & { hand: PdfTool };
  collapsed: boolean;
  available: boolean;
}) {
  const { tabId, tool, collapsed, available } = props;
  const action = getAction(tool.id);
  const key = useBindLabel(action);
  const inHand = usePdfTool((s) => (s.byTab[tabId]?.tool ?? "select") === tool.hand);
  return (
    <ToolButton
      tool={tool}
      collapsed={collapsed}
      pressed={inHand}
      disabled={!available}
      title={key ? `${tool.label} (${key})` : tool.label}
      onClick={() => runAction(action, currentContext(tabId))}
    />
  );
}

// The colour a new annotation is drawn in, and the width of the pen's line. The colours are
// document content, so they are fixed and never follow the theme.
function ColourRow(props: { tabId: string }) {
  const { tabId } = props;
  const colour = usePdfTool((s) => s.byTab[tabId]?.colour ?? null);
  const width = usePdfTool((s) => s.byTab[tabId]?.inkWidth);
  const { setColour, setInkWidth } = usePdfTool.getState();
  return (
    <div className="kern-pdf-colours" role="group" aria-label="Colour and pen width">
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
  );
}
