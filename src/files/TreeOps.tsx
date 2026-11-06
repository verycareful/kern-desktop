// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useMemo, useState } from "react";
import { rename as renameItem, type WireEntry } from "../ipc";
import { NameDialog } from "../ops/NameDialog";
import { nameIsText } from "../ops/names";
import { useOps } from "../ops/useOps";
import { isFolder } from "./file-type";
import { FileOpsUi } from "./FileOpsUi";
import { treeMenuFolder, useTreeMenu, type TreeFileOps } from "./tree-menu-store";
import { selectedRange, useFileOps } from "./use-file-ops";

/** What a name's bytes that are not UTF-8 are shown as. */
const REPLACEMENT = "�";

/**
 * The file operations of the folder tree: create, rename, copy, cut, paste, trash and delete for
 * good, each aimed at what the tree's menu was opened on (tree-menu-store). The tree follows its
 * open folders, so what an operation changes shows there by itself. Renaming goes through a
 * dialog, the tree having no name to edit in place. Problems, the question before a permanent
 * delete and the dialogs show in the column, above the tree.
 */
export function TreeOps(props: {
  /** The column the delete question holds the keyboard of. */
  scope: React.RefObject<HTMLElement | null>;
  /** Gives the keyboard back to the tree. */
  focusTree(): void;
}) {
  const current = useTreeMenu((s) => s.current);
  // Read again whenever what the menu is aimed at changes.
  useTreeMenu((s) => s.root);
  const folder = treeMenuFolder();
  const [renaming, setRenaming] = useState<WireEntry | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  const ops = useFileOps({
    // Unused while `ready` says false: nothing is created or pasted without a folder.
    folder: folder ?? { k: "Utf8", v: "/" },
    selected: () => (current ? [current] : []),
    ready: () => folder !== null,
    relist: () => Promise.resolve(true),
    selectKeys: () => undefined,
    reveal: () => undefined,
    focusList: props.focusTree,
  });
  const { controller } = ops;

  const fileOps = useMemo<TreeFileOps>(
    () => ({
      newFolder: controller.newFolder,
      newFile: controller.newFile,
      rename: () => {
        const e = useTreeMenu.getState().current;
        if (e) setRenaming(e);
      },
      copy: controller.copy,
      cut: controller.cut,
      paste: controller.paste,
      trash: controller.trash,
      askDelete: controller.askDelete,
      note: (text) => setNotes((n) => (n.includes(text) ? n : [...n, text])),
    }),
    [controller]
  );
  useEffect(() => {
    useTreeMenu.getState().setOps(fileOps);
    return () => {
      if (useTreeMenu.getState().ops === fileOps) useTreeMenu.getState().setOps(null);
    };
  }, [fileOps]);

  const closeRename = () => {
    setRenaming(null);
    props.focusTree();
  };

  return (
    <>
      {notes.length > 0 && (
        <div role="alert" className="kern-banner" data-testid="tree-notes">
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <button type="button" className="kern-button" onClick={() => setNotes([])}>
            Dismiss
          </button>
        </div>
      )}
      <FileOpsUi ops={ops} scope={props.scope} active />
      {renaming && (
        <NameDialog
          title={`Rename ${renaming.name}`}
          initial={renaming.name}
          confirmLabel="Rename"
          select={selectedRange(renaming.name, !isFolder(renaming))}
          // A name that is not UTF-8 is shown with U+FFFD for its bad bytes; typing that back
          // would make a different name.
          check={(name) =>
            !nameIsText(renaming.path) && name.includes(REPLACEMENT)
              ? `The name has bytes that are not text, shown as ${REPLACEMENT}. Type the new name without them.`
              : null
          }
          onSubmit={async (name) => {
            if (name !== renaming.name) {
              await renameItem(renaming.path, name);
              void useOps.getState().refreshUndo();
            }
            closeRename();
          }}
          onCancel={closeRename}
        />
      )}
    </>
  );
}
