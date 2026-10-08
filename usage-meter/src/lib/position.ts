/** Where the user dragged the pill, measured from the viewport's top and right edges. */
export type PillPosition = { top: number; right: number };

// Local, not sync: a spot that suits one screen is often wrong on another.
export const POSITION_KEY = "pillPosition";
const EDGE_MARGIN_PX = 4;

export function normalizePosition(raw: unknown): PillPosition | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { top, right } = raw as Partial<PillPosition>;
  return typeof top === "number" && Number.isFinite(top) && typeof right === "number" && Number.isFinite(right) ? { top, right } : null;
}

/** Keeps the whole pill on screen, e.g. after the window shrinks. */
export function clampPosition(pos: PillPosition, size: { width: number; height: number }, viewport: { width: number; height: number }): PillPosition {
  const maxRight = Math.max(EDGE_MARGIN_PX, viewport.width - size.width - EDGE_MARGIN_PX);
  const maxTop = Math.max(EDGE_MARGIN_PX, viewport.height - size.height - EDGE_MARGIN_PX);
  return {
    top: Math.round(Math.min(Math.max(pos.top, EDGE_MARGIN_PX), maxTop)),
    right: Math.round(Math.min(Math.max(pos.right, EDGE_MARGIN_PX), maxRight)),
  };
}

export async function readPosition(area: chrome.storage.StorageArea = chrome.storage.local): Promise<PillPosition | null> {
  const got = await area.get(POSITION_KEY);
  return normalizePosition(got[POSITION_KEY]);
}

export async function writePosition(pos: PillPosition | null, area: chrome.storage.StorageArea = chrome.storage.local): Promise<void> {
  if (pos) await area.set({ [POSITION_KEY]: pos });
  else await area.remove(POSITION_KEY);
}
