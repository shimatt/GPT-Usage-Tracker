import type { Settings } from "../lib/types";
import { h, icons, s } from "./dom";
import type { View, WindowView } from "./state";

const RING_R = 8;
const RING_C = 2 * Math.PI * RING_R;

function bar(w: WindowView, loading: boolean): HTMLElement {
  const fill = loading || w.missing ? 0 : w.shown;
  return h("span", { class: `bar${loading ? " skeleton" : ""}` }, h("span", { class: "fill", style: { width: `${fill}%` } }));
}

function windowSegment(w: WindowView, view: View): HTMLElement {
  const loading = view.kind === "loading";
  const seg = h("span", { class: `win level-${w.level}` }, h("span", { class: "label" }, w.short));
  if (!loading && w.level === "limit") {
    seg.append(h("span", { class: "limit-text" }, `Limit · back in ${w.resetIn}`));
    return seg;
  }
  seg.append(bar(w, loading), h("span", { class: `value${loading ? " skeleton" : ""}` }, loading ? "" : w.missing ? "—" : `${w.shown}%`));
  return seg;
}

function ring(w: WindowView, loading: boolean): SVGElement {
  const fill = loading || w.missing ? 0 : w.shown / 100;
  return s(
    "svg",
    { class: `ring level-${w.level}${loading ? " skeleton" : ""}`, width: 20, height: 20, viewBox: "0 0 20 20", "aria-hidden": "true" },
    s("circle", { class: "ring-track", cx: 10, cy: 10, r: RING_R }),
    s("circle", {
      class: "ring-fill",
      cx: 10,
      cy: 10,
      r: RING_R,
      "stroke-dasharray": RING_C.toFixed(2),
      "stroke-dashoffset": (RING_C * (1 - fill)).toFixed(2),
      transform: "rotate(-90 10 10)",
    }),
  );
}

/** Re-renders the pill's contents in place; the button element itself is kept so focus survives. */
export function renderPill(button: HTMLButtonElement, view: View, settings: Settings, open: boolean): void {
  const compact = settings.compact && view.kind !== "signedOut";
  button.className = [
    "pill",
    `state-${view.kind}`,
    `level-${view.level}`,
    view.stale && "stale",
    open && "open",
    compact && "compact",
  ]
    .filter(Boolean)
    .join(" ");
  button.setAttribute("aria-label", view.ariaLabel);
  button.setAttribute("aria-expanded", String(open));

  let title = "";
  if (compact && view.tooltip) title = view.tooltip;
  if (view.stale) title = `${title ? `${title}\n` : ""}Couldn't refresh — click to retry`;
  if (title) button.title = title;
  else button.removeAttribute("title");

  const parts: Node[] = [];
  if (view.kind === "signedOut") {
    parts.push(h("span", { class: "signed-out" }, "Sign in to see usage"));
  } else {
    if (view.level === "critical" || view.level === "limit") parts.push(h("span", { class: "alert-icon" }, icons.warning()));
    if (compact) {
      parts.push(h("span", { class: "rings" }, ...view.windows.map((w) => ring(w, view.kind === "loading"))));
    } else {
      view.windows.forEach((w, i) => {
        if (i > 0) parts.push(h("span", { class: "divider", "aria-hidden": "true" }));
        parts.push(windowSegment(w, view));
      });
    }
    if (view.stale) parts.push(h("span", { class: "age-chip" }, view.staleAge));
  }
  parts.push(h("span", { class: "chevron" }, icons.chevron()));

  // Everything visual is described by aria-label, so hide the children from assistive tech.
  const inner = h("span", { class: "pill-inner", "aria-hidden": "true" }, ...parts);
  button.replaceChildren(inner);
}
