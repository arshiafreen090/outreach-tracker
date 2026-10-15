import { parse } from "parse5";

/**
 * Flattens an HTML email into a list of events in document order. parse5 is the HTML5
 * reference parser, so nested/broken markup (common in emails) is handled exactly like a
 * browser would. Parsers read this list instead of CSS classes, which LinkedIn can rename.
 */
export type DomEvent =
  | { type: "text"; text: string; /** hrefs of the enclosing <a> elements, innermost last */ anchors: string[] }
  | { type: "anchor"; href: string }
  | { type: "img"; src: string; alt: string; anchors: string[] };

interface P5Node {
  nodeName: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
}

const SKIP = new Set(["head", "style", "script", "noscript", "title", "template"]);

/** Collapses whitespace and drops the invisible filler characters emails use in preheaders. */
export function cleanText(s: string): string {
  return s
    .replace(/[͏​-‏⁠﻿]/g, "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function walk(html: string): DomEvent[] {
  const events: DomEvent[] = [];
  const anchors: string[] = [];

  const visit = (node: P5Node): void => {
    if (node.nodeName === "#text") {
      const text = cleanText(node.value ?? "");
      if (text) events.push({ type: "text", text, anchors: [...anchors] });
      return;
    }
    if (node.nodeName.startsWith("#")) {
      node.childNodes?.forEach(visit); // document, comments
      return;
    }
    if (SKIP.has(node.nodeName)) return;

    const attr = (name: string) => node.attrs?.find((a) => a.name === name)?.value;
    if (node.nodeName === "img") {
      events.push({ type: "img", src: attr("src") ?? "", alt: cleanText(attr("alt") ?? ""), anchors: [...anchors] });
      return;
    }
    const href = node.nodeName === "a" ? attr("href") : undefined;
    if (href !== undefined) {
      anchors.push(href);
      events.push({ type: "anchor", href });
    }
    node.childNodes?.forEach(visit);
    if (href !== undefined) anchors.pop();
  };

  visit(parse(html) as unknown as P5Node);
  return events;
}
