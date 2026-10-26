import { fillSelector, fillText, fillUrl, ToolInputError } from "./template.js";
import type {
  EndpointSource,
  FieldSpec,
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

function toText(document: Document, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => toText(document, item));
  if (typeof value !== "string") return value;
  const container = document.createElement("template");
  container.innerHTML = value.replace(/<(?:br|\/p|\/h[1-6]|\/li|\/div)\b[^>]*>/gi, "$& ");
  return (container.content.textContent ?? "").replace(/\s+/g, " ").trim();
}

function pick(document: Document, item: unknown, source: EndpointSource): unknown {
  if (!source.pick) return item;
  const picked: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(source.pick)) {
    const value = pathValue(item, path);
    picked[key] = source.text ? toText(document, value) : value;
  }
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

function textOf(element: Element): string {
  const parts: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent && (parent.closest("style, script, template") || parent.closest("svg"))) continue;
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

function readField(element: Element, field: FieldSpec): unknown {
  if (!field.selector) return readValue(element, field);
  if (field.all) return [...element.querySelectorAll(field.selector)].map((target) => readValue(target, field));
  const target = element.querySelector(field.selector);
  return target ? readValue(target, field) : null;
}

function readValue(target: Element, field: FieldSpec): unknown {
  return field.attribute ? target.getAttribute(field.attribute) : textOf(target);
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
