// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { ActionMenu } from "../keys/ActionMenu";
import { treeSortMenu } from "./tree-menu";

/**
 * The button of the tree's heading that opens the sort menu: the field, then the order, the
 * chosen ones marked. The menu opens under the button.
 */
export function TreeSortButton() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        className="kern-icon-button kern-tree-tool"
        aria-label="Sort the tree"
        title="Sort the tree"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ x: r.left, y: r.bottom });
        }}
      >
        <ArrowDownUp size={16} strokeWidth={2} aria-hidden />
      </button>
      {at && <ActionMenu sections={treeSortMenu()} x={at.x} y={at.y} onClose={() => setAt(null)} />}
    </>
  );
}
