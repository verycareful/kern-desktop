// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useState } from "react";

// A message kept as one string in state. Setting the same words again changes nothing React can
// see, so the user who tries again and fails the same way sees nothing happen. These count such a
// repeat for the flash (repeat-flash.tsx draws it). Words that differ, or words set after the
// message was cleared, are a new message and count nothing.

/** The count after `next` is set on a message that held `held` with `repeats` repeats so far. */
export function repeatsAfter(held: string | null, repeats: number, next: string): number {
  return held === next ? repeats + 1 : 0;
}

interface Raised {
  text: string | null;
  repeats: number;
}

const NONE: Raised = { text: null, repeats: 0 };

/** A message, how many times it was raised again unchanged, and the ways to set and clear it. */
export function useRaisedText(): Raised & { raise(text: string): void; clear(): void } {
  const [raised, setRaised] = useState<Raised>(NONE);
  const raise = useCallback(
    (text: string) =>
      setRaised((held) => ({ text, repeats: repeatsAfter(held.text, held.repeats, text) })),
    []
  );
  const clear = useCallback(() => setRaised(NONE), []);
  return { ...raised, raise, clear };
}
