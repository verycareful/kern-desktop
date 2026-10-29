// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useLayoutEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { displayPath, parent, pathKey, type WirePath } from "../ipc";
import { DROP_TARGET_ATTR, dropTargetValue } from "../ops/dnd";

// The folders from the root down to `path`, each a button that goes there
// (design 5.1). The chain is built with parent(), which splits Bytes paths
// exactly, so a folder whose name is not UTF-8 has working segments too.
function chain(path: WirePath): WirePath[] {
  const out: WirePath[] = [];
  for (let p: WirePath | null = path; p !== null; p = parent(p)) out.unshift(p);
  return out;
}

function label(p: WirePath): string {
  const text = displayPath(p).replace(/\/+$/, "");
  return text.slice(text.lastIndexOf("/") + 1) || "/";
}

export function Breadcrumb(props: {
  path: WirePath;
  onNavigate(path: WirePath): void;
  /** A click on the empty part of the bar switches to the typed location. */
  onEdit(): void;
}) {
  const { path } = props;
  const box = useRef<HTMLElement>(null);
  const segments = chain(path);

  // A deep path overflows the bar; keep its end, the current folder, in view.
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path]);

  return (
    <nav
      ref={box}
      className="kern-crumbs"
      aria-label="Path"
      data-testid="breadcrumb"
      onClick={(e) => e.target === e.currentTarget && props.onEdit()}
    >
      {segments.map((s, i) => {
        const last = i === segments.length - 1;
        return (
          <span
            key={pathKey(s)}
            className="kern-crumb"
            // The folders above this one take a drop; the one on show is where the items already are.
            {...(last ? {} : { [DROP_TARGET_ATTR]: dropTargetValue(s) })}
          >
            {i > 1 && <ChevronRight size={14} strokeWidth={2} aria-hidden />}
            <button
              type="button"
              aria-current={last ? "location" : undefined}
              title={displayPath(s)}
              onClick={() => props.onNavigate(s)}
            >
              {label(s)}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
