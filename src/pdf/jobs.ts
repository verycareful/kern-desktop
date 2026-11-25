// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The numbers a render, a text read or a search is cancelled by. The engine keeps one list of
// running jobs for the whole app, and every window counts from 1 on its own, so a bare counter
// would let one window cancel another's job. The high bits are drawn once per page load and
// the low bits count, which keeps a number inside what a JavaScript number holds exactly.

const COUNTER_BITS = 32;
const SALT_BITS = 20;
const COUNTER_LIMIT = 2 ** COUNTER_BITS;

let salt: number | undefined;
let counter = 0;

function drawSalt(): number {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  const drawn = bytes[0];
  if (drawn === undefined) throw new Error("no random number for the job numbers");
  return drawn % 2 ** SALT_BITS;
}

/** A job number no other call of this window, and very likely no other window, has used. */
export function nextJobId(): number {
  salt ??= drawSalt();
  counter += 1;
  if (counter >= COUNTER_LIMIT) throw new Error("the job numbers of this window ran out");
  return salt * COUNTER_LIMIT + counter;
}
