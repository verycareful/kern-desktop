// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireReadOnly } from "../ipc";
import { readOnlyText } from "./read-only-text";

// Above a document that is shown but not saved (kernkraft_text::ReadOnly): says
// which of the five reasons it is, in plain words, and the backend's detail
// where it says more. Save As is the way out and stays available.
export function ReadOnlyBanner(props: { readOnly: WireReadOnly }) {
  const { sentence, detail } = readOnlyText(props.readOnly);
  return (
    <div className="kern-doc-banner" role="note" data-testid="read-only-banner">
      <div>
        <p>{sentence}</p>
        {detail && <p className="kern-doc-banner-detail">{detail}</p>}
      </div>
    </div>
  );
}
