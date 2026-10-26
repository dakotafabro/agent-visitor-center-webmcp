import type { ToolInput } from "./types.js";

export class ToolInputError extends Error {
  override name = "ToolInputError";
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const SELECTOR_SAFE = /^[A-Za-z0-9_-]+$/;

export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}

function valueFor(input: ToolInput, key: string): string {
  const value = input[key];
  if (value === undefined || value === null || value === "") {
    throw new ToolInputError(`Missing input "${key}".`);
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new ToolInputError(`Input "${key}" must be a string, number or boolean.`);
  }
  return String(value);
}

export function fillUrl(template: string, input: ToolInput): string {
  return template.replace(PLACEHOLDER, (_, key: string) => encodeURIComponent(valueFor(input, key)));
}

export function fillSelector(template: string, input: ToolInput): string {
  return template.replace(PLACEHOLDER, (_, key: string) => {
    const value = valueFor(input, key);
    if (!SELECTOR_SAFE.test(value)) {
      throw new ToolInputError(`Input "${key}" may only use letters, numbers, "-" and "_".`);
    }
    return value;
  });
}

export function fillText(template: string, input: ToolInput): string {
  return template.replace(PLACEHOLDER, (_, key: string) => valueFor(input, key));
}
