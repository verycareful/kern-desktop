// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useTheme } from "./theme/useTheme";

export default function App() {
  const { error, problems } = useTheme();
  // The shell fills the window so it has a box to be visible in.
  return (
    <main data-testid="shell" style={{ minHeight: "100vh" }}>
      {error && (
        <p role="alert">
          The system theme could not be applied, so Kern shows its own colours: {error.kind}:{" "}
          {error.message}
        </p>
      )}
      {problems.length > 0 && (
        <ul role="status" aria-label="System theme problems">
          {problems.map((p) => (
            <li key={JSON.stringify(p)}>
              {p.kind}: {p.message}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
