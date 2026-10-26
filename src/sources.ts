import { fillSelector, fillText, fillUrl, ToolInputError } from "./template.js";
import type {
  EndpointSource,
  FieldSpec,
  PickSpec,
  ValueSpec,
  Handler,
  SelectorSource,
  Source,
  ToolInput,
} from "./types.js";

export class SourceError extends Error {
  override name = "SourceError";
}

export interface RunContext {
  document: Document;
  fetch: typeof fetch;
  allowedOrigins: string[];
  handlers: Record<string, Handler>;
  navigate: (url: string) => void;
  signal: AbortSignal;
}

const SEGMENT = /^([^[\]]*)(?:\[([^\]]*)\])?$/;

function step(current: unknown, key: string): unknown {
  if (key === "") return current;
  if (current === null || typeof current !== "object") return undefined;
  return (current as Record<string, unknown>)[key];
}

function walk(current: unknown, parts: string[]): unknown {
  const [part, ...rest] = parts;
  if (part === undefined) return current;
  const match = SEGMENT.exec(part);
  if (!match) return undefined;
  const [, key = "", filter] = match;
  const value = step(current, key);
  if (filter === undefined) return walk(value, rest);
  if (!Array.isArray(value)) return undefined;
  if (filter === "") return value.map((item) => walk(item, rest));
  const separator = filter.indexOf("=");
  if (separator < 0) return undefined;
  const field = filter.slice(0, separator);
  const expected = filter.slice(separator + 1);
  const found = value.find((item) => String(step(item, field)) === expected);
  return found === undefined ? undefined : walk(found, rest);
}

/**
 * Reads a dot path. `list[]` maps the rest of the path over an array, and
 * `list[field=value]` picks the first item whose field, as a string, equals value.
 */
export function pathValue(value: unknown, path: string): unknown {
  return walk(value, path.split("."));
}

function fragment(document: Document, html: string): DocumentFragment {
  const container = document.createElement("template");
  container.innerHTML = html;
  return container.content;
}

function toText(document: Document, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => toText(document, item));
  if (typeof value !== "string") return value;
  return textOf(fragment(document, value));
}

/** Applies `match` (first capture group, or the whole match) and then `type` to a value or each item of a list. */
export function shapeValue(value: unknown, spec: ValueSpec): unknown {
  if (Array.isArray(value)) return value.map((item) => shapeValue(item, spec));
  let result = value;
  if (spec.match !== undefined && result !== null && result !== undefined) {
    const found = new RegExp(spec.match).exec(String(result));
    result = found ? (found[1] ?? found[0]) : null;
  }
  if (spec.type === "number" && result !== null && result !== undefined) {
    const number = Number(result);
    result = Number.isFinite(number) ? number : null;
  }
  if (spec.type === "string" && result !== null && result !== undefined) result = String(result);
  return result;
}

function readHtml(document: Document, value: unknown, fields: Record<string, FieldSpec>): unknown {
  if (Array.isArray(value)) return value.map((item) => readHtml(document, item, fields));
  if (typeof value !== "string") return null;
  const root = fragment(document, value);
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) result[key] = readField(root, field);
  return result;
}

function pickOne(document: Document, item: unknown, spec: string | PickSpec, text: boolean): unknown {
  const options: PickSpec = typeof spec === "string" ? { path: spec } : spec;
  const raw = pathValue(item, options.path);
  if (options.html) return readHtml(document, raw, options.html);
  return shapeValue(text ? toText(document, raw) : raw, options);
}

function pick(document: Document, item: unknown, source: EndpointSource): unknown {
  if (!source.pick) return item;
  const picked: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(source.pick)) picked[key] = pickOne(document, item, spec, source.text === true);
  return picked;
}

function resolveUrl(raw: string, context: RunContext): URL {
  const url = new URL(raw, context.document.baseURI);
  const pageOrigin = new URL(context.document.baseURI).origin;
  if (url.origin !== pageOrigin && !context.allowedOrigins.includes(url.origin)) {
    throw new SourceError(`${url.origin} isn't the page's origin or in allowedOrigins.`);
  }
  return url;
}

async function runEndpoint(source: EndpointSource, input: ToolInput, context: RunContext): Promise<unknown> {
  const url = resolveUrl(fillUrl(source.url, input), context);
  const response = await context.fetch(url.toString(), {
    signal: context.signal,
    headers: { accept: "application/json" },
    credentials: "omit",
  });
  if (!response.ok) throw new SourceError(`${url.toString()} returned ${response.status}.`);
  const body: unknown = await response.json();
  if (source.find) {
    if (!Array.isArray(body)) throw new SourceError("find needs the endpoint to return an array.");
    const target = fillText(source.find.equals, input);
    const match = body.find((item) => String(pathValue(item, source.find!.field)) === target);
    if (match === undefined) throw new SourceError(`No item where ${source.find.field} is ${target}.`);
    return pick(context.document, match, source);
  }
  return Array.isArray(body) ? body.map((item) => pick(context.document, item, source)) : pick(context.document, body, source);
}

const SKIPPED = new Set(["STYLE", "SCRIPT", "TEMPLATE", "SVG", "svg", "NOSCRIPT"]);
const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/;

function collectText(node: Node, parts: string[]): void {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      parts.push(child.nodeValue ?? "");
    } else if (child.nodeType === 1) {
      const tag = (child as Element).tagName;
      if (SKIPPED.has(tag)) continue;
      const block = BLOCK.test(tag.toUpperCase());
      if (block) parts.push(" ");
      collectText(child, parts);
      if (block) parts.push(" ");
    }
  }
}

/** Text as a reader sees it: inline elements run together, block elements are separated by a space. */
function textOf(root: Node): string {
  const parts: string[] = [];
  collectText(root, parts);
  return parts.join("").replace(/\s+/g, " ").trim();
}

type Root = Element | DocumentFragment;

function readField(root: Root, field: FieldSpec): unknown {
  if (!field.selector) return "getAttribute" in root ? readValue(root, field) : null;
  if (field.all) return [...root.querySelectorAll(field.selector)].map((target) => readValue(target, field));
  const target = root.querySelector(field.selector);
  return target ? readValue(target, field) : null;
}

function readValue(target: Element, field: FieldSpec): unknown {
  if (field.fields) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(field.fields)) result[key] = readField(target, child);
    return result;
  }
  return shapeValue(field.attribute ? target.getAttribute(field.attribute) : textOf(target), field);
}

function readElement(element: Element, source: SelectorSource): unknown {
  if (!source.fields) return textOf(element);
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(source.fields)) result[key] = readField(element, field);
  return result;
}

function runSelector(source: SelectorSource, input: ToolInput, context: RunContext): unknown {
  const selector = fillSelector(source.selector, input);
  if (source.all) {
    const elements = [...context.document.querySelectorAll(selector)];
    if (elements.length === 0) throw new SourceError(`Nothing on the page matches ${selector}.`);
    return elements.map((element) => readElement(element, source));
  }
  const element = context.document.querySelector(selector);
  if (!element) throw new SourceError(`Nothing on the page matches ${selector}.`);
  return readElement(element, source);
}

export async function runSource(source: Source, input: ToolInput, context: RunContext): Promise<unknown> {
  switch (source.type) {
    case "endpoint":
      return runEndpoint(source, input, context);
    case "selector":
      return runSelector(source, input, context);
    case "navigate": {
      const url = resolveUrl(fillUrl(source.url, input), context);
      const pageOrigin = new URL(context.document.baseURI).origin;
      if (url.origin !== pageOrigin) throw new SourceError("navigate only opens pages on the same site.");
      context.navigate(url.toString());
      return { opened: url.toString() };
    }
    case "scroll": {
      const selector = fillSelector(source.selector, input);
      const element = context.document.querySelector(selector);
      if (!element) throw new SourceError(`Nothing on the page matches ${selector}.`);
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      return { scrolledTo: selector };
    }
    case "handler": {
      const handler = context.handlers[source.handler];
      if (!handler) throw new SourceError(`No handler named "${source.handler}" was provided.`);
      return handler(input, { document: context.document, signal: context.signal });
    }
  }
}

export async function runWithFallback(sources: Source[], input: ToolInput, context: RunContext): Promise<unknown> {
  let lastError: unknown;
  for (const source of sources) {
    try {
      return await runSource(source, input, context);
    } catch (error) {
      if (error instanceof ToolInputError || context.signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
