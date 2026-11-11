// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({ thumbRequest: vi.fn(), thumbCancel: vi.fn(), on: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { FileGrid } from "./FileGrid";
import { empty } from "./selection";
import { entry } from "./test-entries";
import { clearCut, setCut } from "../ops/cut-store";
import { stubLayout } from "./test-layout";

let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
  ipc.thumbRequest.mockResolvedValue(undefined);
  ipc.thumbCancel.mockResolvedValue(undefined);
  ipc.on.mockResolvedValue(() => {});
});
afterEach(() => {
  cleanup();
  restore();
  vi.clearAllMocks();
});

test("every_card_carries_the_key_of_its_item", () => {
  render(
    <FileGrid
      entries={[entry("a"), entry("b")]}
      sel={empty}
      onItemClick={vi.fn()}
      onItemDoubleClick={vi.fn()}
      onContextMenu={vi.fn()}
      onBand={vi.fn()}
      onBackgroundClick={vi.fn()}
      onSeedCursor={vi.fn()}
      rootRef={{ current: null }}
      revealTick={0}
      initialScroll={0}
      thumbKey="t"
      onColumns={vi.fn()}
    />
  );
  const keys = screen.getAllByTestId("file-card").map((c) => c.getAttribute("data-key"));
  expect(keys).toEqual(["Utf8:/d/a", "Utf8:/d/b"]);
});

test("a_card_the_clipboard_holds_as_a_cut_is_marked_and_the_others_are_not", () => {
  setCut([entry("b").path]);
  render(
    <FileGrid
      entries={[entry("a"), entry("b")]}
      sel={empty}
      onItemClick={vi.fn()}
      onItemDoubleClick={vi.fn()}
      onContextMenu={vi.fn()}
      onBand={vi.fn()}
      onBackgroundClick={vi.fn()}
      onSeedCursor={vi.fn()}
      rootRef={{ current: null }}
      revealTick={0}
      initialScroll={0}
      thumbKey="t"
      onColumns={vi.fn()}
    />
  );
  const cards = screen.getAllByTestId("file-card");
  expect(cards.map((c) => c.classList.contains("kern-cut"))).toEqual([false, true]);
  clearCut();
});

test("every_card_is_cut_when_the_folder_listed_lies_inside_a_cut_folder", () => {
  setCut([{ k: "Utf8", v: "/" }]);
  render(
    <FileGrid
      entries={[entry("a"), entry("b")]}
      cutFolder={{ k: "Utf8", v: "/d" }}
      sel={empty}
      onItemClick={vi.fn()}
      onItemDoubleClick={vi.fn()}
      onContextMenu={vi.fn()}
      onBand={vi.fn()}
      onBackgroundClick={vi.fn()}
      onSeedCursor={vi.fn()}
      rootRef={{ current: null }}
      revealTick={0}
      initialScroll={0}
      thumbKey="t"
      onColumns={vi.fn()}
    />
  );
  const cards = screen.getAllByTestId("file-card");
  expect(cards.map((c) => c.classList.contains("kern-cut"))).toEqual([true, true]);
  clearCut();
});
