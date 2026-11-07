# Contributing to Kern Desktop

Bug reports, fixes, features, tests and documentation are all welcome. This file
covers how to report a problem, how to send a change, and the rules a change has to
meet before it is merged.

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

Kern Desktop is licensed under AGPL-3.0-or-later, and contributions are accepted
under the same licence: inbound equals outbound. By opening a pull request you agree
that your change is released under AGPL-3.0-or-later as part of Kern Desktop, and you
confirm that you have the right to submit it. You keep the copyright on what you
wrote.

Code copied from another project has to come under a licence compatible with
AGPL-3.0, and the pull request has to say where it came from.

Every source file starts with an SPDX line and the project's copyright line, and CI
checks the first five lines of each file for both:

```
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
```

Use the file's own comment syntax. If you want credit for a file you wrote, add your
own copyright line directly beneath these two.

## Reporting a bug

Open an issue with the **Bug report** form. The form asks for:

- **Kern version**, from Settings > About > Version.
- **How you installed it** (install script, deb, AppImage or source), your
  **distribution** and your **desktop or compositor**. Kern takes its look from the
  desktop, so theme problems often depend on it.
- **The area** the problem is in, and **where the files live** (local disk, removable
  drive, another mount).
- **Whether a file was lost or changed unexpectedly.** These reports are looked at
  first.
- **Steps to reproduce**, starting from a fresh launch of Kern, then **what you
  expected** and **what happened**, with the exact text of any error.
- **Terminal output**, if you can. Kern keeps no log file and writes its diagnostics
  to the terminal, so launch `kern` from a terminal, repeat the steps, and paste the
  lines that start with `kern:`.

Attach a screenshot or the file itself when you can share it. If the file is private,
say so and describe it instead (its size, how it was made, what it contains).

One problem per issue. Write the title as the symptom and where it shows, for
example `Trash: restore fails after the folder was renamed`. Put the version in the
body, not the title.

An issue with too little to act on gets the `needs info` label and a question. It may
be closed if the details do not follow; reopening it with them is welcome.

Security problems are different: do not open a public issue. See
[SECURITY.md](SECURITY.md).

## Requesting a feature

Open an issue with the **Feature request** form. Start from the problem: what you
were trying to do, and where Kern stopped you. A proposed design is optional.
`Trash: dark mode` cannot be acted on; `Trash: I cannot tell which deleted file came
from which folder` can, because it says what the change is for.

Kern never opens a network connection, so a request that needs one is out of scope.
For a question, or an idea you are not ready to turn into a request, use
[Discussions](https://github.com/verycareful/kern-desktop/discussions).

## Labels

Maintainers set labels when triaging. Suggesting them in a report is welcome.

- **Type**: `bug`, `enhancement`, `documentation`, `performance`, `regression`,
  `question`.
- **Area**: `area:folders`, `area:file-ops`, `area:trash`, `area:volumes`,
  `area:search`, `area:editor`, `area:theme`, `area:desktop-integration`,
  `area:settings`, `area:packaging`.
- **Severity**, on bugs only, exactly one:
  - `severity:critical`: a file is lost, corrupted or changed without the user's say,
    or Kern crashes on a main path.
  - `severity:high`: a main feature does not work and there is no reasonable
    workaround.
  - `severity:medium`: a clear failure with a workaround.
  - `severity:low`: cosmetic or minor, with no effect on files or main features.
- **Status**: `needs info`, `confirmed`, `out of scope`, `blocked upstream`
  (caused by WebKitGTK, Tauri or another dependency), `duplicate`, `wontfix`.

## Sending a change

1. Fork the repository and branch from `main`. Name the branch for the change:
   `fix/trash-restore-renamed-folder`, `feat/search-by-extension`.
2. A bug fix can go straight to a pull request. A feature, or any change to how Kern
   behaves, needs an issue first, so that the design is agreed before the work starts.
3. All file and format logic lives in
   [kernkraft](https://github.com/verycareful/kernkraft). This repository holds the
   interface, the Tauri command glue and the desktop integration, so a change to how a
   file is read, written, copied or trashed usually belongs there.
4. Make the change, with tests where it adds logic.
5. Run the checks below and make sure they pass. CI runs them on every pull request.
6. Open the pull request against `main`. Describe what changed and why, and link the
   issue.

Do not change the version. Version strings, `CHANGELOG.md` and releases are handled by
the maintainer when the change is merged.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): summary`, with the scope naming the area.

```
fix(trash): restore a file whose folder was renamed
feat(search): match on file extension
test(file-ops): conflict prompt on a read-only target
docs(readme): list the supported desktops
```

### Running the checks

You need a stable Rust toolchain, Node.js, and the system libraries Tauri needs on
Linux. The CI workflow (`.github/workflows/ci.yml`) lists the exact Debian package
names: WebKitGTK 4.1, GTK 3, librsvg and the Ayatana appindicator development
packages among them. Install the dependencies with `npm ci --ignore-scripts`, then run
from the repository root:

```
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
npx tsc --noEmit
npx tsc -p tsconfig.node.json
npx tsc -p e2e-app
npx eslint . --max-warnings 0
npx prettier --check .
npx vitest run
scripts/check-no-network.sh
scripts/check-headers.sh
```

CI also runs the Playwright flows, the real-app driver suite and a smoke run with no
network. Running those locally is optional.

### Changes that also touch kernkraft

Send the kernkraft change first. Kern Desktop pins kernkraft by tag, and the
maintainer moves the pin once the kernkraft change is merged and released. To try both
together before then, point your own local Cargo configuration at a checkout of
kernkraft with a `[patch]` entry; do not commit that configuration.

### Know what you submit

Read every line of your change before you submit it, and be able to explain why each
line is there. Whatever produced the code (you, a generator, an AI tool, another
project), you are the one submitting it, and review questions go to you. A pull
request whose author cannot answer for its contents is closed.

## Rules for code

These hold everywhere in Kern Desktop. A change that breaks one is not merged.

- **No network.** Kern never opens a network connection: no analytics, telemetry,
  crash reporting, update checks, and no font or script loaded from the web. This is
  enforced three ways: `cargo deny` bans HTTP and socket crates, ESLint bans `fetch`,
  `XMLHttpRequest` and `WebSocket`, and the Tauri content security policy allows no
  remote origin. The `updater` and `http` plugins are not used. Unix-domain sockets,
  such as the session D-Bus, are local and allowed; nothing may open an internet
  socket.
- **Never lose or corrupt a user's file.** Kern reads and writes files where they
  live and keeps no app folder of copies. Saves go through kernkraft's atomic writer.
  Permanent deletion asks first.
- **Constants have a source**: a specification, `std` or the type's limits.
- **Tests come with logic.** Frontend tests sit beside the file
  (`Thing.test.tsx`); Rust tests go in `src-tauri/tests/`; Playwright flows go in
  `e2e/`. Expected values are derived from the specification or the behaviour, never
  copied from a run of the code under test.
- **Comments explain the code as it stands**: how it works, why it is there, what
  breaks without it. What changed, when, and why it changed belong in the commit
  message and the pull request, not in a comment.
- **No em dashes and no double hyphens** in code, comments, documentation, commit
  messages or pull request text, except where the syntax needs them (command-line
  flags). Use a colon, a comma, parentheses or two sentences.
- Follow the language conventions: `PascalCase.tsx` for React components,
  `useThing.ts` for hooks, `kebab-case.ts` for other TypeScript modules, `snake_case`
  for Rust. `rustfmt`, Clippy, ESLint and Prettier have no backlog: they pass.

## Good first issues

Issues labelled `good first issue` are small and self-contained. Comment on one before
starting, so that two people do not work on it at once.
