// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useMemo, useState } from "react";
import { ROTATE_MS, tipsFromActions } from "./welcome-tips";
import { WELCOME_FACTS } from "./welcome-content";

// What the centre of the editor layout shows while no document is open: a keyboard tip and a short
// fact, each rotating on its own. The tips are read from the action table (keys/actions.ts), never
// listed by hand, so a key that changes or goes changes here with it; the facts are
// welcome-content.ts.

/** An index that moves on every `ROTATE_MS` and by hand; wraps at `count`. */
function useRotation(count: number): [number, () => void] {
  const [at, setAt] = useState(0);
  const next = () => setAt((i) => (count === 0 ? 0 : (i + 1) % count));
  useEffect(() => {
    if (count === 0) return;
    const t = setInterval(() => setAt((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(t);
  }, [count]);
  return [count === 0 ? 0 : at % count, next];
}

export function WelcomePane() {
  // The table does not change while the window is open.
  const tips = useMemo(() => tipsFromActions(), []);
  const [tipAt, nextTip] = useRotation(tips.length);
  const [factAt, nextFact] = useRotation(WELCOME_FACTS.length);
  const tip = tips[tipAt];
  const fact = WELCOME_FACTS[factAt];
  return (
    <main className="kern-welcome" data-testid="welcome-pane" aria-label="No document open">
      <h1 className="kern-welcome-title">No document open</h1>
      <p>Pick a file in the folder column to open it here.</p>
      {tip && (
        <section aria-label="Tip" className="kern-welcome-card" data-testid="welcome-tip">
          <h2 className="kern-label">Tip</h2>
          <p>
            {tip.label}: <kbd>{tip.key}</kbd>
          </p>
          <button type="button" className="kern-button" onClick={nextTip}>
            Another tip
          </button>
        </section>
      )}
      {fact && (
        <section aria-label="Did you know" className="kern-welcome-card" data-testid="welcome-fact">
          <h2 className="kern-label">Good to know</h2>
          <p>{fact.text}</p>
          <button type="button" className="kern-button" onClick={nextFact}>
            Another fact
          </button>
        </section>
      )}
    </main>
  );
}
