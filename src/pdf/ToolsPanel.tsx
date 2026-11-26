// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  Columns2,
  File,
  LayoutGrid,
  Redo2,
  RefreshCcw,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Rows3,
  Search,
  TextSelect,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { currentContext, getAction, isEnabled, runAction } from "../keys/actions";
import { useBindLabel } from "../keys/binds";
import { useViewSettings } from "../files/view-settings";
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

// Find waits for its own session; selecting the page's text is an action of the table.
const FIND_TOOL: Tool = { id: "find", label: "Find", Icon: Search };
const SELECT_TOOL: Tool = { id: "pdf.selectAll", label: "Select all text", Icon: TextSelect };

export function ToolsPanel(props: { tabId: string; doc: PdfDoc; collapsed: boolean }) {
  const { tabId, doc, collapsed } = props;
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
        <ToolButton tool={FIND_TOOL} collapsed={collapsed} disabled />
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
