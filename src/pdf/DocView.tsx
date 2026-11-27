// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { ComponentProps } from "react";
import type { DocFormat } from "../ipc";
import { TextEditor } from "../editor/TextEditor";
import { PdfViewer } from "./PdfViewer";

type TextProps = ComponentProps<typeof TextEditor>;

/**
 * The view of a document tab: what shows the file is chosen by its format, which the tab
 * carries (the backend names it when it routes the file). Text is the format of a tab that
 * names none.
 */
export function DocView(props: TextProps & { format?: DocFormat }) {
  const { format, ...rest } = props;
  if (format === "pdf") {
    // A PDF has no text to hand over from another window; the window that takes it opens the file.
    const { handed: _handed, ...pdf } = rest;
    return <PdfViewer {...pdf} />;
  }
  return <TextEditor {...rest} />;
}
