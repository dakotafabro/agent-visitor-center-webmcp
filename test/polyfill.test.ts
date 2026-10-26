// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { registerSite } from "../src/index.js";

interface RealModelContext {
  getTools(): Promise<Array<{ name: string; annotations?: Record<string, boolean> }>>;
  executeTool(tool: unknown, input?: object): Promise<string>;
}

const require = createRequire(import.meta.url);
const polyfillPath = require.resolve("@mcp-b/webmcp-polyfill").replace(/index\.js$/, "index.iife.js");

function securePage(html: string) {
  const dom = new JSDOM(html, { url: "https://example.org/goals/", runScripts: "outside-only" });
  Object.defineProperty(dom.window, "isSecureContext", { value: true, configurable: true });
  Object.assign(dom.window, { MessageChannel });
  return dom;
}

describe("with the real WebMCP polyfill", () => {
  it("registers tools that executeTool can run, and removes them on unregister", async () => {
    // given
    const dom = securePage(`<section id="goal-1"><h2>No Poverty</h2></section>`);
    const schema = {
      version: 1,
      site: { name: "Example" },
      tools: [
        {
          name: "get_goal",
          description: "Get one goal from the page.",
          inputSchema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"] },
          annotations: { readOnlyHint: true },
          source: { type: "selector", selector: "#goal-{number}", fields: { title: { selector: "h2" } } },
        },
      ],
    };

    // when
    const registration = await registerSite(schema, {
      document: dom.window.document,
      installPolyfill: () => {
        dom.window.eval(readFileSync(polyfillPath, "utf8"));
      },
    });
    const context = (dom.window.document as unknown as { modelContext: RealModelContext }).modelContext;
    const tools = await context.getTools();
    const tool = tools.find((candidate) => candidate.name === "get_goal");
    const result = await context.executeTool(tool, { number: 1 });
    registration.unregister();
    const after = await context.getTools();

    // then
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(JSON.parse(result)).toEqual({ title: "No Poverty" });
    expect(after.find((candidate) => candidate.name === "get_goal")).toBeUndefined();
  });
});
