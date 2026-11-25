// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { vi } from "vitest";
import type { PdfController } from "./pdf-controller";
import type { PdfDoc } from "./usePdfDoc";

// What the tests of the viewer's parts hand them: a document that is open and unchanged, and a
// controller whose every command is a spy, each with whatever a test sets differently.

export function testDoc(over: Partial<PdfDoc> = {}): PdfDoc {
  return {
    phase: "ready",
    handle: 3,
    pages: 4,
    revision: 0,
    pageRevisions: Array.from({ length: over.pages ?? 4 }, () => 0),
    changedPages: [],
    canUndo: false,
    canRedo: false,
    modified: false,
    readOnly: null,
    canEdit: true,
    open: async () => undefined,
    cancelPassword: () => undefined,
    apply: async () => undefined,
    undo: async () => undefined,
    redo: async () => undefined,
    busy: () => false,
    ...over,
  };
}

export function testController(over: Partial<PdfController> = {}): PdfController {
  return {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomFit: vi.fn(),
    askGoToPage: vi.fn(),
    goToPage: vi.fn(),
    rotate: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canEdit: () => true,
    canUndo: () => true,
    canRedo: () => true,
    ...over,
  };
}
