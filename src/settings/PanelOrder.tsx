// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Panel } from "../ipc";
import { canMovePanel, movePanel } from "../shell/panel-order";

// The control of a panel order row: the panels in the order they have on the screen, each with a
// button to move it one place left and one to move it right. `between` is a fixed piece that
// lies between the first and the second panel and cannot move (the editor in the editor layout).

export function PanelOrder(props: {
  label: string;
  order: readonly Panel[];
  names: Readonly<Partial<Record<Panel, string>>>;
  between?: string;
  onChange(order: Panel[]): void;
}) {
  const { order, names } = props;
  return (
    <div className="kern-settings-panel-order" role="group" aria-label={props.label}>
      {order.map((panel, i) => {
        const name = names[panel] ?? panel;
        return (
          <div key={panel} className="kern-settings-panel-order-item">
            {i === 1 && props.between && (
              <span className="kern-settings-panel-order-fixed" aria-hidden>
                {props.between}
              </span>
            )}
            <span className="kern-settings-panel-order-chip" data-panel={panel}>
              <button
                type="button"
                className="kern-icon-button"
                aria-label={`Move ${name} left`}
                disabled={!canMovePanel(order, panel, -1)}
                onClick={() => props.onChange(movePanel(order, panel, -1))}
              >
                <ChevronLeft size={16} strokeWidth={2} aria-hidden />
              </button>
              <span>{name}</span>
              <button
                type="button"
                className="kern-icon-button"
                aria-label={`Move ${name} right`}
                disabled={!canMovePanel(order, panel, 1)}
                onClick={() => props.onChange(movePanel(order, panel, 1))}
              >
                <ChevronRight size={16} strokeWidth={2} aria-hidden />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
