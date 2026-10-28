// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({ thumbRequest: vi.fn(), thumbCancel: vi.fn(), on: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { FileGrid } from "./FileGrid";
import { empty } from "./selection";
import { entry } from "./test-entries";
import { stubLayout } from "./test-layout";
import { useViewSettings } from "./view-settings";

// The interface zoom scales the picture area on screen, so the thumbnail size
// is chosen from the size in device pixels (design 5.4).

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
  useViewSettings.setState({ interfaceSize: 90 });
});

async function sizeAskedAt(interfaceSize: number) {
  useViewSettings.setState({ interfaceSize });
  render(
    <FileGrid
      entries={[entry("a.png", { mime: "image/png" })]}
      sel={empty}
      onItemClick={vi.fn()}
      onItemDoubleClick={vi.fn()}
      onContextMenu={vi.fn()}
      onBand={vi.fn()}
      onBackgroundClick={vi.fn()}
      rootRef={{ current: null }}
      revealTick={0}
      initialScroll={0}
      thumbKey="t"
      onColumns={vi.fn()}
    />
  );
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalled());
  return ipc.thumbRequest.mock.calls[0]![2];
}

test("a_zoomed_out_grid_asks_for_the_normal_size", async () => {
  expect(await sizeAskedAt(90)).toBe("normal");
});

test("a_zoomed_in_grid_asks_for_the_large_size", async () => {
  expect(await sizeAskedAt(125)).toBe("large");
});
