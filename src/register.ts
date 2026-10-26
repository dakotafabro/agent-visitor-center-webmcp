import { parseSchema, sourcesOf } from "./schema.js";
import { runWithFallback, type RunContext } from "./sources.js";
import type { Handler, ModelContextLike, SiteSchema } from "./types.js";

export interface RegisterOptions {
  document?: Document;
  modelContext?: ModelContextLike;
  installPolyfill?: () => void | Promise<void>;
  fetch?: typeof fetch;
  handlers?: Record<string, Handler>;
  navigate?: (url: string) => void;
  signal?: AbortSignal;
}

export interface Registration {
  tools: string[];
  unregister: () => void;
}

async function defaultInstall(): Promise<void> {
  const { installWebMCP } = await import("@mcp-b/webmcp-polyfill");
  installWebMCP();
}

/**
 * Returns the document's `modelContext`, installing the polyfill first when the browser
 * doesn't provide one. Throws when neither is available, for example on an insecure page.
 */
export async function getModelContext(
  document: Document,
  installPolyfill: () => void | Promise<void> = defaultInstall,
): Promise<ModelContextLike> {
  const existing = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (existing) return existing;
  await installPolyfill();
  const installed = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (!installed) throw new Error("WebMCP isn't available here. It needs a secure (HTTPS or localhost) page.");
  return installed;
}

/**
 * Registers every tool in `schema` on the page. Each tool has its own AbortController;
 * `unregister()` or aborting `options.signal` removes all of them.
 */
export async function registerSite(schema: SiteSchema | unknown, options: RegisterOptions = {}): Promise<Registration> {
  const site = parseSchema(schema);
  const document = options.document ?? globalThis.document;
  if (!document) throw new Error("registerSite needs a document.");
  const modelContext = options.modelContext ?? (await getModelContext(document, options.installPolyfill));
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const handlers = options.handlers ?? {};
  const navigate = options.navigate ?? ((url: string) => document.defaultView?.location.assign(url));

  for (const tool of site.tools) {
    for (const source of sourcesOf(tool)) {
      if (source.type === "handler" && !handlers[source.handler]) {
        throw new Error(`Tool "${tool.name}" needs a handler named "${source.handler}".`);
      }
    }
  }

  const Controller = (document.defaultView as (Window & typeof globalThis) | null)?.AbortController ?? AbortController;
  const controllers: AbortController[] = [];
  const unregister = () => controllers.forEach((controller) => controller.abort());
  options.signal?.addEventListener("abort", unregister, { once: true });

  try {
    for (const tool of site.tools) {
      const controller = new Controller();
      controllers.push(controller);
      const sources = sourcesOf(tool);
      await modelContext.registerTool(
        {
          name: tool.name,
          ...(tool.title ? { title: tool.title } : {}),
          description: tool.description,
          inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
          execute: (input, { signal }) => {
            const context: RunContext = {
              document,
              fetch: fetchImpl,
              allowedOrigins: site.allowedOrigins ?? [],
              handlers,
              navigate,
              signal,
            };
            return runWithFallback(sources, input ?? {}, context);
          },
        },
        { signal: controller.signal },
      );
    }
  } catch (error) {
    unregister();
    throw error;
  }

  if (options.signal?.aborted) unregister();
  return { tools: site.tools.map((tool) => tool.name), unregister };
}
