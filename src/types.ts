export type JsonSchema = Record<string, unknown>;

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
  debugging?: boolean;
}

export interface EndpointSource {
  type: "endpoint";
  url: string;
  pick?: Record<string, string>;
  find?: { field: string; equals: string };
  text?: boolean;
}

export interface FieldSpec {
  selector: string;
  attribute?: string;
  all?: boolean;
}

export interface SelectorSource {
  type: "selector";
  selector: string;
  fields?: Record<string, FieldSpec>;
  all?: boolean;
}

export interface NavigateSource {
  type: "navigate";
  url: string;
}

export interface ScrollSource {
  type: "scroll";
  selector: string;
}

export interface HandlerSource {
  type: "handler";
  handler: string;
}

export type Source =
  | EndpointSource
  | SelectorSource
  | NavigateSource
  | ScrollSource
  | HandlerSource;

export interface ToolSpec {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  source: Source;
  fallback?: Source;
}

export interface SiteSchema {
  version: 1;
  site: { name: string; url?: string };
  allowedOrigins?: string[];
  tools: ToolSpec[];
}

export type ToolInput = Record<string, unknown>;

export type Handler = (input: ToolInput, context: HandlerContext) => unknown;

export interface HandlerContext {
  document: Document;
  signal: AbortSignal;
}

export interface ModelContextToolLike {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: ToolAnnotations;
  execute: (input: ToolInput, options: { signal: AbortSignal }) => Promise<unknown>;
}

export interface ModelContextLike {
  registerTool(
    tool: ModelContextToolLike,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void> | void;
}
