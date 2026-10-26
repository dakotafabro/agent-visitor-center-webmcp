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

export function pathValue(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function toText(document: Document, value: unknown): unknown {
  if (typeof value !== "string") return value;
  const container = document.createElement("template");
  container.innerHTML = value;
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

function readField(element: Element, field: FieldSpec): unknown {
  const read = (target: Element) =>
    field.attribute ? target.getAttribute(field.attribute) : (target.textContent ?? "").replace(/\s+/g, " ").trim();
  if (field.all) return [...element.querySelectorAll(field.selector)].map(read);
  const target = element.querySelector(field.selector);
  return target ? read(target) : null;
}

function readElement(element: Element, source: SelectorSource): unknown {
  if (!source.fields) return (element.textContent ?? "").replace(/\s+/g, " ").trim();
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
