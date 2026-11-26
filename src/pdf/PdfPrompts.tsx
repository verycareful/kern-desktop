// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef } from "react";
import { displayPath, type WirePath } from "../ipc";
import { ExternalModificationPrompt, RecreatePrompt, SaveAsDialog } from "../editor/DocPrompts";
import { Modal } from "../ops/Modal";
import { baseName } from "../ops/labels";
import { compactedName } from "./compacted-name";
import { CopyFirstPrompt } from "./CopyFirstPrompt";
import type { PdfDoc } from "./usePdfDoc";

// The question of `doc.prompt`, if there is one. They are the questions of a text document with the
// words of a PDF, and the questions only a PDF asks (keep a copy first, a compacted copy).

function ReloadPrompt(props: { path: WirePath; onReload(): void; onCancel(): void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const name = baseName(props.path);
  return (
    <Modal
      role="alertdialog"
      label="Reload the PDF"
      initialFocus={cancel}
      onEscape={props.onCancel}
      testId="reload-prompt"
    >
      <h2 className="kern-modal-title">Reload {name} and lose your changes?</h2>
      <p className="kern-modal-text">
        Reload reads {name} from the disk again. The changes you made to it here and did not save
        are discarded.
      </p>
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" onClick={props.onReload}>
          Discard my changes and reload
        </button>
        <button ref={cancel} type="button" className="kern-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function PdfPrompts(props: { path: WirePath; doc: PdfDoc }) {
  const { path, doc } = props;
  switch (doc.prompt) {
    case "external":
      return (
        <ExternalModificationPrompt
          path={path}
          holds="pdf"
          dirty={doc.modified}
          onReload={() => void doc.reload()}
          onOverwrite={() => void doc.overwrite()}
          onSaveAs={doc.askSaveAs}
          onCancel={doc.cancelPrompt}
        />
      );
    case "recreate":
      return (
        <RecreatePrompt
          path={path}
          onRecreate={() => void doc.overwrite()}
          onSaveAs={doc.askSaveAs}
          onCancel={doc.cancelPrompt}
        />
      );
    case "saveAs":
      return (
        <SaveAsDialog path={path} lossyNote={null} save={doc.saveAs} onCancel={doc.cancelPrompt} />
      );
    case "compact":
      return (
        <SaveAsDialog
          path={path}
          title="Save a compacted copy"
          suggestion={compactedName(displayPath(path))}
          lossyNote="A compacted copy is a new file. It holds the PDF as it is now without the history of earlier saves, and the file shown here is left alone."
          save={(target) => doc.saveCompactedCopy(target)}
          onCancel={doc.cancelPrompt}
        />
      );
    case "copyFirst":
      return (
        <CopyFirstPrompt
          path={path}
          copying={doc.copying}
          onChoose={(choice) => void doc.answerCopyFirst(choice)}
        />
      );
    case "reload":
      return (
        <ReloadPrompt path={path} onReload={() => void doc.reload()} onCancel={doc.cancelPrompt} />
      );
    case null:
      return null;
  }
}
