import { placeholders } from "./template.js";
import type { SiteSchema, Source } from "./types.js";

export class SchemaError extends Error {
  override name = "SchemaError";
  constructor(readonly errors: string[]) {
    super(`Invalid site schema:\n- ${errors.join("\n- ")}`);
  }
}

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const SOURCE_TYPES = ["endpoint", "selector", "navigate", "scroll", "handler"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function templatesOf(source: Record<string, unknown>): string[] {
  const templates: string[] = [];
  for (const key of ["url", "selector"]) {
    const value = source[key];
    if (typeof value === "string") templates.push(value);
  }
  const find = source["find"];
  if (isObject(find) && typeof find["equals"] === "string") templates.push(find["equals"]);
  return templates;
}

function checkSource(source: unknown, where: string, inputs: Set<string> | undefined, errors: string[]): void {
  if (!isObject(source)) {
    errors.push(`${where} must be an object.`);
    return;
  }
  const type = source["type"];
  if (typeof type !== "string" || !SOURCE_TYPES.includes(type)) {
    errors.push(`${where}.type must be one of ${SOURCE_TYPES.join(", ")}.`);
    return;
  }
  const required = type === "endpoint" || type === "navigate" ? "url" : type === "handler" ? "handler" : "selector";
  if (!isNonEmptyString(source[required])) {
    errors.push(`${where}.${required} is required for a ${type} source.`);
  }
  if (type === "selector" && source["fields"] !== undefined) {
    const fields = source["fields"];
    if (!isObject(fields)) {
      errors.push(`${where}.fields must be an object.`);
    } else {
      for (const [key, field] of Object.entries(fields)) {
        if (!isObject(field)) {
          errors.push(`${where}.fields.${key} must be an object.`);
        } else if (field["selector"] !== undefined && !isNonEmptyString(field["selector"])) {
          errors.push(`${where}.fields.${key}.selector must be a non-empty string when given.`);
        } else if (field["selector"] === undefined && field["attribute"] === undefined) {
          errors.push(`${where}.fields.${key} needs a selector, an attribute, or both.`);
        }
      }
    }
  }
  if (type === "endpoint" && source["pick"] !== undefined && !isObject(source["pick"])) {
    errors.push(`${where}.pick must be an object of output names to field paths.`);
  }
  if (type === "endpoint" && source["find"] !== undefined) {
    const find = source["find"];
    if (!isObject(find) || !isNonEmptyString(find["field"]) || !isNonEmptyString(find["equals"])) {
      errors.push(`${where}.find needs "field" and "equals".`);
    }
  }
  if (inputs) {
    for (const template of templatesOf(source)) {
      for (const key of placeholders(template)) {
        if (!inputs.has(key)) {
          errors.push(`${where} uses {${key}}, which isn't in the tool's inputSchema properties.`);
        }
      }
    }
  }
}

export function validateSchema(value: unknown): { ok: true; schema: SiteSchema } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: ["The schema must be an object."] };
  if (value["version"] !== 1) errors.push("version must be 1.");
  const site = value["site"];
  if (!isObject(site) || !isNonEmptyString(site["name"])) errors.push("site.name is required.");

  const origins = value["allowedOrigins"];
  if (origins !== undefined) {
    if (!Array.isArray(origins)) {
      errors.push("allowedOrigins must be an array of origins.");
    } else {
      origins.forEach((origin, index) => {
        let valid = false;
        try {
          valid = typeof origin === "string" && new URL(origin).origin === origin;
        } catch {
          valid = false;
        }
        if (!valid) errors.push(`allowedOrigins[${index}] must be an origin like "https://example.org".`);
      });
    }
  }

  const tools = value["tools"];
  if (!Array.isArray(tools) || tools.length === 0) {
    errors.push("tools must be a non-empty array.");
  } else {
    const seen = new Set<string>();
    tools.forEach((tool, index) => {
      const where = `tools[${index}]`;
      if (!isObject(tool)) {
        errors.push(`${where} must be an object.`);
        return;
      }
      const name = tool["name"];
      if (typeof name !== "string" || !TOOL_NAME.test(name)) {
        errors.push(`${where}.name must be 1-64 letters, numbers, "-" or "_".`);
      } else if (seen.has(name)) {
        errors.push(`${where}.name "${name}" is used more than once.`);
      } else {
        seen.add(name);
      }
      if (!isNonEmptyString(tool["description"])) errors.push(`${where}.description is required.`);
      let inputs: Set<string> | undefined;
      const inputSchema = tool["inputSchema"];
      if (inputSchema !== undefined) {
        if (!isObject(inputSchema)) {
          errors.push(`${where}.inputSchema must be a JSON Schema object.`);
        } else {
          const properties = inputSchema["properties"];
          inputs = new Set(isObject(properties) ? Object.keys(properties) : []);
        }
      } else {
        inputs = new Set();
      }
      checkSource(tool["source"], `${where}.source`, inputs, errors);
      if (tool["fallback"] !== undefined) checkSource(tool["fallback"], `${where}.fallback`, inputs, errors);
    });
  }

  return errors.length === 0 ? { ok: true, schema: value as unknown as SiteSchema } : { ok: false, errors };
}

export function parseSchema(value: unknown): SiteSchema {
  const input = typeof value === "string" ? JSON.parse(value) : value;
  const result = validateSchema(input);
  if (!result.ok) throw new SchemaError(result.errors);
  return result.schema;
}

export function sourcesOf(tool: { source: Source; fallback?: Source }): Source[] {
  return tool.fallback ? [tool.source, tool.fallback] : [tool.source];
}
