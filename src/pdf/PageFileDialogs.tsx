// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { MergeDialog } from "./MergeDialog";
import { usePageDialog } from "./pdf-page-dialog";
import { RangeDialog } from "./RangeDialog";
import type { PdfDoc } from "./usePdfDoc";

// The page-file dialog the tab asked for, if any (pdf-page-dialog.ts).
export function PageFileDialogs(props: { tabId: string; doc: PdfDoc }) {
  const { tabId, doc } = props;
  const dialog = usePageDialog((s) => s.byTab[tabId]);
  const close = usePageDialog((s) => s.close);
  if (!dialog || doc.phase !== "ready") return null;
  if (dialog.kind === "merge") return <MergeDialog doc={doc} onClose={() => close(tabId)} />;
  return (
    <RangeDialog
      key={dialog.kind}
      mode={dialog.kind}
      doc={doc}
      initial={dialog.pages}
      onClose={() => close(tabId)}
    />
  );
}
