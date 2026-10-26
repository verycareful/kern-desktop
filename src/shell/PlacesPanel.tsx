// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
// Design 4.1: the file manager, left two thirds. Its strip (Places, Volumes,
// Trash) and folder area are filled by Tasks 21 and 22; these are their
// stable boundaries.
export function PlacesPanel(props: { overlay?: boolean }) {
  return (
    <section
      className={
        props.overlay ? "kern-panel kern-panel-left kern-overlay" : "kern-panel kern-panel-left"
      }
      aria-label="File manager"
      data-testid="places-panel"
    >
      <nav className="kern-places" aria-label="Places" data-testid="places-strip" />
      <div className="kern-folder-area" data-testid="folder-area" />
    </section>
  );
}
