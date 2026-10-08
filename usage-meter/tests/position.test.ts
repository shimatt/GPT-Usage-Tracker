import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPosition, normalizePosition, readPosition, writePosition } from "../src/lib/position";
import { fakeArea } from "./helpers";

const PILL = { width: 220, height: 36 };
const VIEW = { width: 1280, height: 800 };

test("a position inside the viewport is kept", () => {
  assert.deepEqual(clampPosition({ top: 120, right: 300 }, PILL, VIEW), { top: 120, right: 300 });
});

test("off-screen positions are pulled back in (e.g. after the window shrinks)", () => {
  assert.deepEqual(clampPosition({ top: -50, right: -10 }, PILL, VIEW), { top: 4, right: 4 });
  assert.deepEqual(clampPosition({ top: 2000, right: 2000 }, PILL, VIEW), { top: 800 - 36 - 4, right: 1280 - 220 - 4 });
});

test("garbage in storage means no saved position", () => {
  assert.equal(normalizePosition(undefined), null);
  assert.equal(normalizePosition({ top: "1", right: 2 }), null);
  assert.equal(normalizePosition({ top: Number.NaN, right: 2 }), null);
  assert.deepEqual(normalizePosition({ top: 1, right: 2 }), { top: 1, right: 2 });
});

test("save, read back, reset", async () => {
  const area = fakeArea();
  assert.equal(await readPosition(area), null);
  await writePosition({ top: 80, right: 140 }, area);
  assert.deepEqual(await readPosition(area), { top: 80, right: 140 });
  await writePosition(null, area);
  assert.equal(await readPosition(area), null);
});
