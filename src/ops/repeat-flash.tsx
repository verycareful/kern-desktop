// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRepeatFlash } from "./use-repeat-flash";

// The flash drawn over a message raised again (use-repeat-flash.ts counts the repeats).

/**
 * The flash itself, drawn over its container's edge (the container is positioned, see shell.css
 * `.kern-repeat-flash`). A new element for each count, so the animation plays again.
 */
export function FlashSpan(props: { count: number }) {
  if (props.count === 0) return null;
  return <span key={props.count} className="kern-repeat-flash" aria-hidden="true" />;
}

/** [`FlashSpan`] for a message kept in `watch`. Goes inside the message's container. */
export function RepeatFlash(props: { watch: unknown }) {
  return <FlashSpan count={useRepeatFlash(props.watch)} />;
}
