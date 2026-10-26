// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, FileText, Folder, X } from "lucide-react";
import { ActionMenu } from "../keys/ActionMenu";
import { actions, currentContext, getAction, isEnabled, runAction } from "../keys/actions";
import { tabTitle, useTabs } from "../store/tabs";

const TAB_MENU = actions.filter((a) => a.id.startsWith("tab."));

function NavButton(props: { id: string; icon: typeof ArrowLeft }) {
  const action = getAction(props.id);
  // Subscribing re-renders the button when the tab or its history changes.
  useTabs();
  const ctx = currentContext();
  const Icon = props.icon;
  const key = action.keys[0];
  return (
    <button
      type="button"
      className="kern-icon-button"
      aria-label={action.label}
      title={key ? `${action.label} (${key})` : action.label}
      disabled={!isEnabled(action, ctx)}
      onClick={() => runAction(action, currentContext())}
    >
      <Icon size={20} strokeWidth={2} aria-hidden />
    </button>
  );
}

// Design 4.1: tabs along the top, the location controls beside them. The
// breadcrumb and editable location bar arrive with the folder area (Task 21).
export function TabBar() {
  const { tabs, activeId, activate, close } = useTabs();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <header className="kern-tabbar" data-testid="tab-bar">
      <div role="tablist" aria-label="Open tabs" className="kern-tabs">
        {tabs.map((t) => {
          const active = t.id === activeId;
          const Icon = t.kind === "folder" ? Folder : FileText;
          return (
            <div
              key={t.id}
              role="tab"
              tabIndex={active ? 0 : -1}
              aria-selected={active}
              className={active ? "kern-tab kern-tab-active" : "kern-tab"}
              data-testid="tab"
              onClick={() => activate(t.id)}
              onAuxClick={(e) => e.button === 1 && close(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                activate(t.id);
                setMenu({ x: e.clientX, y: e.clientY });
              }}
            >
              <Icon size={16} strokeWidth={2} aria-hidden />
              <span className="kern-tab-title">{tabTitle(t)}</span>
              {t.kind === "doc" && t.dirty && (
                <span className="kern-dirty" role="img" aria-label="Unsaved changes" />
              )}
              <button
                type="button"
                className="kern-tab-close"
                aria-label={`Close ${tabTitle(t)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.id);
                }}
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      <div className="kern-nav" role="toolbar" aria-label="Navigation">
        <NavButton id="nav.back" icon={ArrowLeft} />
        <NavButton id="nav.forward" icon={ArrowRight} />
        <NavButton id="nav.up" icon={ArrowUp} />
      </div>
      {menu && (
        <ActionMenu actions={TAB_MENU} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </header>
  );
}
