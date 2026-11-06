// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef, useState } from "react";
import {
  CopyPlus,
  EllipsisVertical,
  FileSearch,
  FileText,
  Folder,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { ActionMenu, type MenuSection } from "../keys/ActionMenu";
import {
  actions,
  currentContext,
  type Action,
  getAction,
  menuSections,
  runAction,
} from "../keys/actions";
import { useViewSettings } from "../files/view-settings";
import { useLayout } from "../store/layout";
import { ActionButton } from "./ActionButton";
import { PanelToggle } from "./PanelToggle";
import { FILE_KEYS_ATTR } from "../keys/file-keys";
import { activeTab, tabTitle, useTabs } from "../store/tabs";

const TAB_MENU: MenuSection[] = [{ actions: actions.filter((a) => a.id.startsWith("tab.")) }];

/** The sections of a menu limited to the actions `allow` lets through; a section left empty goes. */
function allowed(sections: MenuSection[], allow?: (a: Action) => boolean): MenuSection[] {
  if (!allow) return sections;
  return sections
    .map((s) => ({ ...s, actions: s.actions.filter(allow) }))
    .filter((s) => s.actions.length > 0);
}

type OpenMenu =
  { kind: "tab"; x: number; y: number; targetId: string } | { kind: "app"; x: number; y: number };

// The tab row: the left panel's button where the panels fold, the tabs, New tab and New tab here,
// then Pinned and Recent's button, Settings and the main menu. A folder
// tab's own buttons (navigation, create, the view) are the folder view's toolbar, under this row.
// A window that does not answer an action (`allow`) has no button for it.
export function TabBar(props: { allow?: (a: Action) => boolean }) {
  const { allow } = props;
  const { tabs, activeId, activate } = useTabs();
  const active = useTabs((s) => activeTab(s));
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = (id: string) => runAction(getAction("tab.close"), currentContext(id));
  const has = (id: string) => !allow || allow(getAction(id));
  // The editor layout holds no folder tabs, so it has no new tab buttons.
  const editorLayout = useLayout((s) => s.layout === "editor");
  // The side panels fold away beside a document and in the editor layout; a folder tab shows them.
  const folding = editorLayout || active?.kind === "doc";
  // The new tab buttons show their keys, which Settings can swap, and New tab waits for the settings.
  useViewSettings((s) => s.newTabDefault);
  useViewSettings((s) => s.loaded);

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
    <header className="kern-tabbar" data-testid="tab-bar" {...{ [FILE_KEYS_ATTR]: "" }}>
      {folding && has("panel.left.toggle") && (
        <div className="kern-nav" role="toolbar" aria-label="Left panel">
          <PanelToggle side="left" />
        </div>
      )}
      <div
        ref={list}
        role="tablist"
        aria-label="Open tabs"
        className="kern-tabs"
        onKeyDown={onKeyDown}
      >
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          const Icon = {
            folder: Folder,
            doc: FileText,
            trash: Trash2,
            documents: FileSearch,
            settings: Settings,
          }[t.kind];
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
      <div className="kern-nav" role="toolbar" aria-label="New tab">
        {!editorLayout && has("newTab.folder") && <ActionButton id="newTab.folder" icon={Plus} />}
        {!editorLayout && has("newTab.here") && <ActionButton id="newTab.here" icon={CopyPlus} />}
      </div>
      <div className="kern-nav-fill" />
      <div className="kern-nav" role="toolbar" aria-label="Window">
        {folding && has("panel.right.toggle") && <PanelToggle side="right" />}
        {has("place.settings") && <ActionButton id="place.settings" icon={Settings} />}
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
          sections={menu.kind === "tab" ? TAB_MENU : allowed(menuSections(active), allow)}
          x={menu.x}
          y={menu.y}
          targetId={menu.kind === "tab" ? menu.targetId : undefined}
          onClose={() => setMenu(null)}
        />
      )}
    </header>
  );
}
