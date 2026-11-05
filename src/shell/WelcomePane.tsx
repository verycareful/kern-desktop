// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useMemo, useState } from "react";
import { ROTATE_MS, tipsFromActions } from "./welcome-tips";
import { openUrl, settingsGet, toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { WELCOME_ROTATION } from "./welcome-content";

// What the centre of the editor layout shows while no document is open: a keyboard tip and a fun
// fact, each rotating on its own. The tips are read from the action table (keys/actions.ts), never
// listed by hand, so a key that changes or goes changes here with it, and come in the table's
// order. The facts (welcome-content.ts) come in an order shuffled for each pane, so a fact comes
// back only after every other one has been shown. A word from the author takes its turn among them,
// with a button that opens a page in the default application for https links: Kern connects to
// nothing.

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

/** The indices 0 to n - 1 in a random order (Fisher and Yates). */
function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

export function WelcomePane() {
  // The table does not change while the window is open.
  const tips = useMemo(() => tipsFromActions(), []);
  const [tipAt, nextTip] = useRotation(tips.length);
  const [factOrder] = useState(() => shuffled(WELCOME_ROTATION.length));
  const [factAt, nextFact] = useRotation(factOrder.length);
  // A page that could not be opened, said while its word is on show.
  const [askError, setAskError] = useState<{ url: string; text: string } | null>(null);
  const openAsk = async (url: string) => {
    setAskError(null);
    try {
      const terminal = (await settingsGet()).terminal;
      await openUrl(url, terminal ?? undefined);
    } catch (e) {
      setAskError({ url, text: `${url} could not be opened: ${errorText(toWireError(e))}` });
    }
  };
  const tip = tips[tipAt];
  const fact = WELCOME_ROTATION[factOrder[factAt] ?? 0];
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
        <section aria-label="Fun fact" className="kern-welcome-card" data-testid="welcome-fact">
          <h2 className="kern-label">{fact.link ? "From the author" : "Fun fact"}</h2>
          <p>{fact.text}</p>
          <span className="kern-welcome-actions">
            {fact.link && (
              <button
                type="button"
                className="kern-button"
                onClick={() => void openAsk(fact.link!.url)}
              >
                {fact.link.label}
              </button>
            )}
            <button type="button" className="kern-button" onClick={nextFact}>
              Another fact
            </button>
          </span>
          {askError && askError.url === fact.link?.url && <p role="alert">{askError.text}</p>}
        </section>
      )}
    </main>
  );
}
