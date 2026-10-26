// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
// Design 4.1 and 4.2: Pinned on top, Recent below, right third. Task 24 fills
// the two lists.
export function SidePanel(props: { overlay?: boolean }) {
  return (
    <aside
      className={
        props.overlay ? "kern-panel kern-panel-right kern-overlay" : "kern-panel kern-panel-right"
      }
      aria-label="Pinned and Recent"
      data-testid="side-panel"
    >
      <section className="kern-side-section" aria-labelledby="kern-pinned" data-testid="pinned">
        <h2 id="kern-pinned" className="kern-label">
          Pinned
        </h2>
      </section>
      <section className="kern-side-section" aria-labelledby="kern-recent" data-testid="recent">
        <h2 id="kern-recent" className="kern-label">
          Recent
        </h2>
      </section>
    </aside>
  );
}
