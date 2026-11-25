// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  Columns2,
  File,
  LayoutGrid,
  Rows3,
  Search,
  TextSelect,
  type LucideIcon,
} from "lucide-react";
import { currentContext, getAction, isEnabled, runAction } from "../keys/actions";
import { useBindLabel } from "../keys/binds";
import { useViewSettings } from "../files/view-settings";

// The tools beside an open PDF: Find and Select (their sessions switch them on) and the page
// layout. Expanded each is an icon and its name; collapsed only the icon is left, and the name
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

const UNAVAILABLE_TOOLS: readonly Tool[] = [
  { id: "find", label: "Find", Icon: Search },
  { id: "select", label: "Select", Icon: TextSelect },
];

export function ToolsPanel(props: { tabId: string; collapsed: boolean }) {
  const { tabId, collapsed } = props;
  return (
    <div
      className="kern-pdf-tools"
      role="toolbar"
      aria-label="PDF tools"
      aria-orientation="vertical"
      data-testid="pdf-tools"
    >
      <ToolGroup title="Search and select" collapsed={collapsed}>
        {UNAVAILABLE_TOOLS.map((tool) => (
          <ToolButton key={tool.id} tool={tool} collapsed={collapsed} disabled />
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
