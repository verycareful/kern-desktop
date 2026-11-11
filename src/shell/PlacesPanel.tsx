// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
// The file manager. Docked, its two parts are cells of the
// main grid: the places strip from the window top to the status bar, and the
// folder area beside it under the tab row. Slid in over a document only the strip comes: a
// folder shown there would be a second view of a tab that is not in front. The strip holds Kern's
// logo in its top slot, level with the tab row, then Places, the Library, Volumes and Trash.
import { FileSearch, Trash2, type LucideIcon } from "lucide-react";
import { isMainWindow } from "../ipc";
import { FolderView } from "../files/FolderView";
import { DocumentsView } from "../files/DocumentsView";
import { TrashView } from "../files/TrashView";
import { currentContext, getAction, runAction } from "../keys/actions";
import { activeTab, useTabs, type TabsState } from "../store/tabs";
import type { Side } from "./panel-order";
import { KernLogo } from "./KernLogo";
import { PlacesList } from "./PlacesList";
import { documentsShown, trashShown } from "./place-nav";
import { openOnClick } from "./open-on-click";
import { useSingleClick } from "../files/view-settings";
import { VolumesList } from "./VolumesList";

/** A place of Kern's own in the strip (the Trash, the Library): one entry that opens its tab. */
function OwnPlace(props: {
  label: string;
  action: string;
  Icon: LucideIcon;
  shown(s: TabsState): boolean;
}) {
  const current = useTabs(props.shown);
  const single = useSingleClick("left");
  const action = getAction(props.action);
  const { Icon } = props;
  return (
    <section className="kern-places-group" aria-label={props.label}>
      <ul className="kern-places-list">
        <li>
          <button
            type="button"
            className="kern-place"
            aria-current={current ? "page" : undefined}
            {...openOnClick(() => runAction(action, currentContext()), single)}
          >
            <Icon size={16} strokeWidth={2} aria-hidden />
            <span className="kern-place-label">{props.label}</span>
          </button>
        </li>
      </ul>
    </section>
  );
}

/**
 * The strip. `column` is the strip as the top of the editor layout's left column, which has its
 * width from the column rather than its own. Places and Volumes are left out there: opening one
 * moves the folder tree's root away from the folder being edited. The Trash and the Library are
 * tabs of the main window, so an editor window's strip has neither.
 */
export function PlacesStrip(props: { column?: boolean; side?: Side }) {
  const main = isMainWindow();
  const classes = ["kern-places"];
  if (props.column) classes.push("kern-places-column");
  if (props.side === "right") classes.push("kern-side-right");
  return (
    <nav className={classes.join(" ")} aria-label="Places and volumes" data-testid="places-strip">
      <div className="kern-places-slot">
        <KernLogo onOpen={() => runAction(getAction("place.about"), currentContext())} />
      </div>
      {!props.column && <PlacesList />}
      {main && (
        <OwnPlace
          label="Library"
          action="place.documents"
          Icon={FileSearch}
          shown={documentsShown}
        />
      )}
      {!props.column && <VolumesList />}
      {main && <OwnPlace label="Trash" action="place.trash" Icon={Trash2} shown={trashShown} />}
    </nav>
  );
}

export function FolderArea(props: { docked?: boolean }) {
  const active = useTabs((s) => activeTab(s));
  const region = props.docked ? { role: "region", "aria-label": "File manager" } : {};
  return (
    <div className="kern-folder-area" data-testid="folder-area" {...region}>
      {active?.kind === "trash" ? (
        <TrashView key={active.id} tab={active} />
      ) : active?.kind === "documents" ? (
        <DocumentsView key={active.id} tabId={active.id} />
      ) : (
        active?.kind === "folder" && <FolderView key={active.id} tab={active} />
      )}
    </div>
  );
}

export function PlacesPanel(props: { overlay?: boolean; side?: Side }) {
  if (!props.overlay) {
    return (
      <>
        <PlacesStrip side={props.side} />
        <FolderArea docked />
      </>
    );
  }
  return (
    <section
      className={
        props.side === "right"
          ? "kern-panel kern-panel-left kern-overlay kern-side-right"
          : "kern-panel kern-panel-left kern-overlay"
      }
      aria-label="File manager"
      data-testid="places-panel"
    >
      <PlacesStrip />
    </section>
  );
}
