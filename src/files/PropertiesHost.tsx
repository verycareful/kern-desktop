// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pathKey } from "../ipc";
import { PropertiesDialog } from "./PropertiesDialog";
import { useProperties } from "./properties-store";

/** The Properties dialog of the window, whichever tab asked for it (properties-store.ts). */
export function PropertiesHost() {
  const paths = useProperties((s) => s.paths);
  const close = useProperties((s) => s.close);
  // A new request is a new dialog, so nothing from the last one carries over.
  return (
    paths && <PropertiesDialog key={paths.map(pathKey).join("\n")} paths={paths} onClose={close} />
  );
}
