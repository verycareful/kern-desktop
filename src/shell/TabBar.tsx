// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  EllipsisVertical,
  FileText,
  Folder,
  X,
} from "lucide-react";
import { ActionMenu, type MenuSection } from "../keys/ActionMenu";
import {
  actions,
  currentContext,
  getAction,
  isEnabled,
  menuSections,
  runAction,
} from "../keys/actions";
import { activeTab, tabTitle, useTabs } from "../store/tabs";

const TAB_MENU: MenuSection[] = [{ actions: actions.filter((a) => a.id.startsWith("tab.")) }];

function NavButton(props: { id: string; icon: typeof ArrowLeft }) {
  const action = getAction(props.id);
  // The selector returns the active tab object, which changes when its history moves.
  useTabs((s) => activeTab(s));
  const Icon = props.icon;
  const key = action.keys[0];
  return (
    <button
      type="button"
      className="kern-icon-button"
      aria-label={action.label}
      title={key ? `${action.label} (${key})` : action.label}
      disabled={!isEnabled(action, currentContext())}
      onClick={() => runAction(action, currentContext())}
    >
      <Icon size={20} strokeWidth={2} aria-hidden />
    </button>
  );
}

type OpenMenu =
  { kind: "tab"; x: number; y: number; targetId: string } | { kind: "app"; x: number; y: number };

// Design 4.1: the tab row and the location controls sit over the left two
// thirds. The breadcrumb and editable location bar arrive with the folder
// area (Task 21).
export function TabBar() {
  const { tabs, activeId, activate } = useTabs();
  const active = useTabs((s) => activeTab(s));
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = (id: string) => runAction(getAction("tab.close"), currentContext(id));

  // WAI-ARIA tabs: arrows move focus and select, Home and End jump.
  // Only plain arrows on a tab itself: Alt+Left is Back, and the close button is not a tab.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if ((e.target as HTMLElement).getAttribute("role") !== "tab") return;
    const i = tabs.findIndex((t) => t.id === activeId);
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined || tabs.length === 0) return;
    e.preventDefault();
    const t = tabs[(to + tabs.length) % tabs.length];
    if (!t) return;
    activate(t.id);
    list.current?.querySelector<HTMLElement>(`[data-tab-id="${t.id}"]`)?.focus();
  };

  return (
    <header className="kern-tabbar" data-testid="tab-bar">
      <div
        ref={list}
        role="tablist"
        aria-label="Open tabs"
        className="kern-tabs"
        onKeyDown={onKeyDown}
      >
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          const Icon = t.kind === "folder" ? Folder : FileText;
          return (
            <div
              key={t.id}
              className={isActive ? "kern-tab kern-tab-active" : "kern-tab"}
              onAuxClick={(e) => e.button === 1 && close(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ kind: "tab", x: e.clientX, y: e.clientY, targetId: t.id });
              }}
            >
              <button
                type="button"
                role="tab"
                data-tab-id={t.id}
                data-testid="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                className="kern-tab-main"
                onClick={() => activate(t.id)}
              >
                <Icon size={16} strokeWidth={2} aria-hidden />
                <span className="kern-tab-title">{tabTitle(t)}</span>
                {t.kind === "doc" && t.dirty && (
                  <span className="kern-dirty" role="img" aria-label="Unsaved changes" />
                )}
              </button>
              <button
                type="button"
                className="kern-tab-close"
                aria-label={`Close ${tabTitle(t)}`}
                onClick={() => close(t.id)}
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
        <button
          type="button"
          className="kern-icon-button"
          aria-label="Main menu"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "app"}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ kind: "app", x: r.right, y: r.bottom });
          }}
        >
          <EllipsisVertical size={20} strokeWidth={2} aria-hidden />
        </button>
      </div>
      {menu && (
        <ActionMenu
          sections={menu.kind === "tab" ? TAB_MENU : menuSections(active)}
          x={menu.x}
          y={menu.y}
          targetId={menu.kind === "tab" ? menu.targetId : undefined}
          onClose={() => setMenu(null)}
        />
      )}
    </header>
  );
}
