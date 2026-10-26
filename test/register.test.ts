import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSite, getModelContext, type ModelContextLike, type ModelContextToolLike } from "../src/index.js";

class FakeModelContext implements ModelContextLike {
  tools = new Map<string, ModelContextToolLike>();
  registerTool(tool: ModelContextToolLike, options?: { signal?: AbortSignal }) {
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener("abort", () => this.tools.delete(tool.name));
  }
  call(name: string, input: Record<string, unknown> = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.execute(input, { signal: new AbortController().signal });
  }
}

const goals = [
  { id: 48, slug: "1-no-poverty", title: { rendered: "No Poverty" }, content: { rendered: "<p>End <b>poverty</b></p>" }, acf: { code: "1" } },
  { id: 51, slug: "2-zero-hunger", title: { rendered: "Zero Hunger" }, content: { rendered: "<p>End hunger</p>" }, acf: { code: "2" } },
];

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const schema = {
  version: 1,
  site: { name: "Example goals" },
  allowedOrigins: ["https://cms.example.org"],
  tools: [
    {
      name: "list_goals",
      description: "List every goal.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      source: { type: "endpoint", url: "https://cms.example.org/goals", pick: { number: "acf.code", title: "title.rendered" } },
      fallback: { type: "selector", selector: ".goal", all: true, fields: { title: { selector: "h2" } } },
    },
    {
      name: "get_goal",
      description: "Get one goal.",
      inputSchema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"] },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      source: {
        type: "endpoint",
        url: "https://cms.example.org/goals",
        find: { field: "acf.code", equals: "{number}" },
        pick: { title: "title.rendered", description: "content.rendered" },
        text: true,
      },
      fallback: { type: "selector", selector: "#goal-{number}", fields: { title: { selector: "h2" } } },
    },
    {
      name: "open_goal",
      description: "Open a goal's page.",
      inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
      source: { type: "navigate", url: "/goals/{slug}/" },
    },
    {
      name: "scroll_to_section",
      description: "Scroll to a section.",
      inputSchema: { type: "object", properties: { section: { type: "string" } }, required: ["section"] },
      source: { type: "scroll", selector: "#{section}" },
    },
  ],
};

beforeEach(() => {
  document.body.innerHTML = `
    <section class="goal" id="goal-1"><h2>No Poverty</h2></section>
    <section class="goal" id="goal-2"><h2>Zero Hunger</h2></section>
    <section id="targets"><h3>Targets</h3></section>`;
});

describe("registerSite", () => {
  it("registers each tool with its annotations and a default input schema", async () => {
    // given
    const context = new FakeModelContext();

    // when
    const registration = await registerSite(schema, { modelContext: context, fetch: jsonFetch(goals) });

    // then
    expect(registration.tools).toEqual(["list_goals", "get_goal", "open_goal", "scroll_to_section"]);
    expect(context.tools.get("list_goals")?.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(context.tools.get("list_goals")?.inputSchema).toEqual({ type: "object", properties: {} });
  });

  it("reads an endpoint and picks fields", async () => {
    // given
    const context = new FakeModelContext();
    const fetch = jsonFetch(goals);
    await registerSite(schema, { modelContext: context, fetch });

    // when
    const result = await context.call("list_goals");

    // then
    expect(result).toEqual([
      { number: "1", title: "No Poverty" },
      { number: "2", title: "Zero Hunger" },
    ]);
    expect(fetch).toHaveBeenCalledWith("https://cms.example.org/goals", expect.objectContaining({ credentials: "omit" }));
  });

  it("finds one item and turns HTML into text", async () => {
    // given
    const context = new FakeModelContext();
    await registerSite(schema, { modelContext: context, fetch: jsonFetch(goals) });

    // when
    const result = await context.call("get_goal", { number: 1 });

    // then
    expect(result).toEqual({ title: "No Poverty", description: "End poverty" });
  });

  it("falls back to the page when the endpoint fails", async () => {
    // given
    const context = new FakeModelContext();
    await registerSite(schema, { modelContext: context, fetch: jsonFetch({}, 500) });

    // when
    const one = await context.call("get_goal", { number: 2 });
    const all = await context.call("list_goals");

    // then
    expect(one).toEqual({ title: "Zero Hunger" });
    expect(all).toEqual([{ title: "No Poverty" }, { title: "Zero Hunger" }]);
  });

  it("joins text from separate elements with spaces and skips styles and icons", async () => {
    // given
    document.body.innerHTML = `<div id="hero"><span>13</span><style>.x{}</style><svg><text>icon</text></svg><p>Take urgent action.</p><a>Find out more</a></div>`;
    const context = new FakeModelContext();
    const heroSchema = {
      version: 1,
      site: { name: "x" },
      tools: [{ name: "hero", description: "Hero text.", source: { type: "selector", selector: "#hero" } }],
    };
    await registerSite(heroSchema, { modelContext: context });

    // when
    const result = await context.call("hero");

    // then
    expect(result).toBe("13 Take urgent action. Find out more");
  });

  it("reads an attribute from the matched element itself", async () => {
    // given
    document.body.innerHTML = `<a class="goal-link" href="/goals/1-no-poverty/">No Poverty</a>`;
    const context = new FakeModelContext();
    const pageSchema = {
      version: 1,
      site: { name: "x" },
      tools: [
        {
          name: "links",
          description: "Goal links.",
          source: { type: "selector", selector: ".goal-link", all: true, fields: { link: { attribute: "href" } } },
        },
      ],
    };
    await registerSite(pageSchema, { modelContext: context });

    // when
    const result = await context.call("links");

    // then
    expect(result).toEqual([{ link: "/goals/1-no-poverty/" }]);
  });

  it("keeps HTML block breaks as spaces when turning a picked list into text", async () => {
    // given
    const context = new FakeModelContext();
    const listSchema = {
      version: 1,
      site: { name: "x" },
      allowedOrigins: ["https://cms.example.org"],
      tools: [
        {
          name: "targets",
          description: "Targets.",
          source: { type: "endpoint", url: "https://cms.example.org/t", pick: { list: "items[].copy" }, text: true },
        },
      ],
    };
    await registerSite(listSchema, { modelContext: context, fetch: jsonFetch({ items: [{ copy: "<h3>ERADICATE</h3><p>By 2030</p>" }] }) });

    // when
    const result = await context.call("targets");

    // then
    expect(result).toEqual({ list: ["ERADICATE By 2030"] });
  });

  it("doesn't fetch from an origin outside allowedOrigins", async () => {
    // given
    const context = new FakeModelContext();
    const fetch = jsonFetch(goals);
    const offsite = {
      ...schema,
      tools: [{ name: "steal", description: "x", source: { type: "endpoint", url: "https://evil.example.net/x" } }],
    };
    await registerSite(offsite, { modelContext: context, fetch });

    // when / then
    expect(await context.call("steal")).toEqual({ error: "https://evil.example.net isn't the page's origin or in allowedOrigins." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports unsafe selector input without trying the fallback", async () => {
    // given
    const context = new FakeModelContext();
    const fallback = vi.fn(() => "fallback ran");
    const inputSchema = {
      version: 1,
      site: { name: "x" },
      tools: [
        {
          name: "section",
          description: "Read a section.",
          inputSchema: { type: "object", properties: { id: { type: "string" } } },
          source: { type: "selector", selector: "#{id}" },
          fallback: { type: "handler", handler: "fallback" },
        },
      ],
    };
    await registerSite(inputSchema, { modelContext: context, handlers: { fallback } });

    // when
    const result = await context.call("section", { id: "x, body" });

    // then
    expect(result).toEqual({ error: 'Input "id" may only use letters, numbers, "-" and "_".' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("navigates only within the site and encodes input", async () => {
    // given
    const context = new FakeModelContext();
    const navigate = vi.fn();
    await registerSite(schema, { modelContext: context, navigate });

    // when
    const result = await context.call("open_goal", { slug: "1-no-poverty" });
    const escaped = await context.call("open_goal", { slug: "../../x?y" });

    // then
    expect(result).toEqual({ opened: "https://example.org/goals/1-no-poverty/" });
    expect(escaped).toEqual({ opened: "https://example.org/goals/..%2F..%2Fx%3Fy/" });
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("scrolls to a section", async () => {
    // given
    const context = new FakeModelContext();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await registerSite(schema, { modelContext: context });

    // when
    const result = await context.call("scroll_to_section", { section: "targets" });

    // then
    expect(result).toEqual({ scrolledTo: "#targets" });
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("runs a handler and refuses to register when one is missing", async () => {
    // given
    const context = new FakeModelContext();
    const handlerSchema = {
      version: 1,
      site: { name: "x" },
      tools: [{ name: "count", description: "Count goals.", source: { type: "handler", handler: "count" } }],
    };

    // when
    await registerSite(handlerSchema, { modelContext: context, handlers: { count: () => 17 } });

    // then
    expect(await context.call("count")).toBe(17);
    await expect(registerSite(handlerSchema, { modelContext: new FakeModelContext() })).rejects.toThrow(
      'Tool "count" needs a handler named "count".',
    );
  });

  it("removes every tool on unregister or when the signal aborts", async () => {
    // given
    const first = new FakeModelContext();
    const second = new FakeModelContext();
    const controller = new AbortController();
    const registration = await registerSite(schema, { modelContext: first });
    await registerSite(schema, { modelContext: second, signal: controller.signal });

    // when
    registration.unregister();
    controller.abort();

    // then
    expect(first.tools.size).toBe(0);
    expect(second.tools.size).toBe(0);
  });

  it("removes the tools right away when the signal is already aborted", async () => {
    // given
    const context = new FakeModelContext();

    // when
    await registerSite(schema, { modelContext: context, signal: AbortSignal.abort() });

    // then
    expect(context.tools.size).toBe(0);
  });
});

describe("getModelContext", () => {
  it("uses the browser's context when there is one", async () => {
    // given
    const native = new FakeModelContext();
    Object.defineProperty(document, "modelContext", { value: native, configurable: true });
    const install = vi.fn();

    // when
    const context = await getModelContext(document, install);

    // then
    expect(context).toBe(native);
    expect(install).not.toHaveBeenCalled();
    delete (document as unknown as { modelContext?: unknown }).modelContext;
  });

  it("installs the polyfill when the browser has none", async () => {
    // given
    const polyfilled = new FakeModelContext();
    const install = vi.fn(() => {
      Object.defineProperty(document, "modelContext", { value: polyfilled, configurable: true });
    });

    // when
    const context = await getModelContext(document, install);

    // then
    expect(install).toHaveBeenCalledOnce();
    expect(context).toBe(polyfilled);
    delete (document as unknown as { modelContext?: unknown }).modelContext;
  });

  it("explains when WebMCP isn't available", async () => {
    await expect(getModelContext(document, () => {})).rejects.toThrow("needs a secure (HTTPS or localhost) page");
  });
});
