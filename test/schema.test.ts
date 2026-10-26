import { describe, expect, it } from "vitest";
import { parseSchema, SchemaError, validateSchema } from "../src/index.js";

const valid = {
  version: 1,
  site: { name: "Example" },
  allowedOrigins: ["https://cms.example.org"],
  tools: [
    {
      name: "get_goal",
      description: "Get one goal.",
      inputSchema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"] },
      source: { type: "endpoint", url: "https://cms.example.org/goals", find: { field: "code", equals: "{number}" } },
      fallback: { type: "selector", selector: "#goal-{number}" },
    },
  ],
};

describe("validateSchema", () => {
  it("accepts a valid schema", () => {
    // given / when
    const result = validateSchema(valid);

    // then
    expect(result.ok).toBe(true);
  });

  it("parses a JSON string", () => {
    expect(parseSchema(JSON.stringify(valid)).tools[0]?.name).toBe("get_goal");
  });

  it("reports every problem at once", () => {
    // given
    const broken = {
      version: 2,
      site: {},
      allowedOrigins: ["https://cms.example.org/path"],
      tools: [
        { name: "has space", description: "", source: { type: "teleport" } },
        { name: "dup", description: "a", source: { type: "selector", selector: ".a" } },
        { name: "dup", description: "b", source: { type: "navigate" } },
      ],
    };

    // when
    const result = validateSchema(broken);

    // then
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "version must be 1.",
        "site.name is required.",
        'allowedOrigins[0] must be an origin like "https://example.org".',
        'tools[0].name must be 1-64 letters, numbers, "-" or "_".',
        "tools[0].description is required.",
        "tools[0].source.type must be one of endpoint, selector, navigate, scroll, handler.",
        'tools[2].name "dup" is used more than once.',
        "tools[2].source.url is required for a navigate source.",
      ]),
    );
  });

  it("rejects a placeholder that isn't an input", () => {
    // given
    const schema = {
      ...valid,
      tools: [{ ...valid.tools[0], fallback: { type: "selector", selector: "#goal-{id}" } }],
    };

    // when
    const result = validateSchema(schema);

    // then
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("tools[0].fallback uses {id}, which isn't in the tool's inputSchema properties.");
  });

  it("throws SchemaError from parseSchema", () => {
    expect(() => parseSchema({ version: 1 })).toThrow(SchemaError);
  });
});
