type Child = Node | string | false | null | undefined;
type Props = Record<string, unknown>;

function append(el: Element, children: Child[]): void {
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    el.append(child);
  }
}

/** Minimal element builder: `class`, `style` (object), `on*` listeners, everything else as attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "style") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function s(tag: string, attrs: Record<string, string | number> = {}, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  append(el, children);
  return el as SVGElement;
}

function icon(size: number, ...paths: string[]): SVGElement {
  return s(
    "svg",
    { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "icon" },
    ...paths.map((d) => s("path", { d })),
  );
}

export const icons = {
  chevron: () => icon(14, "M4 6l4 4 4-4"),
  warning: () => icon(14, "M8 2.2L14.5 13.5H1.5L8 2.2Z", "M8 6.5v3", "M8 11.6v.01"),
  refresh: () => icon(14, "M13.5 8a5.5 5.5 0 1 1-1.6-3.9", "M13.5 2.5v3h-3"),
  external: () => icon(12, "M9.5 2.5h4v4", "M13.5 2.5L7.5 8.5", "M12 9.5v3.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5H7"),
  settings: () => icon(13, "M2.5 4.5h7", "M12.5 4.5h1", "M2.5 11.5h1", "M6.5 11.5h7", "M11 3v3", "M5 10v3"),
};
