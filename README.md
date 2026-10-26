# agent-visitor-center-webmcp

A visitor center for agents. When you arrive at a national park, the visitor center tells you what's there, what you can do and how to get around. This kit gives a website the same thing for AI agents: the site describes its tools in one small file, and the kit registers them through [WebMCP](https://github.com/webmachinelearning/webmcp) so an agent in the browser can use them.

## Status

Early development. The core library and the Global Goals demo work in Chrome 156, with native WebMCP and with the polyfill. Not published to npm yet.

## Use it

```ts
import { registerSite } from "agent-visitor-center-webmcp";

const registration = await registerSite({
  version: 1,
  site: { name: "Example" },
  tools: [
    {
      name: "get_section",
      description: "Read one section of this page by its id.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      annotations: { readOnlyHint: true },
      source: { type: "selector", selector: "#{id}" },
    },
  ],
});

registration.unregister();
```

`registerSite` uses the browser's `document.modelContext` when it has one, and installs [`@mcp-b/webmcp-polyfill`](https://www.npmjs.com/package/@mcp-b/webmcp-polyfill) when it doesn't. WebMCP only runs on secure pages (HTTPS or localhost).

## Site schema

Each tool has a `name`, a `description`, an optional JSON Schema `inputSchema`, optional WebMCP `annotations`, a `source`, and an optional `fallback` source that runs when the first one fails. `{name}` in a source fills in that input.

- **`endpoint`**: fetches JSON from `url`. `pick` maps output names to field paths (`"title.rendered"`; `list[]` maps over a list and `list[field=value]` picks one item), `find` returns the one array item whose `field` equals a value, and `text: true` turns picked HTML into plain text. Requests go to the page's own origin or to one listed in `allowedOrigins`, without cookies.
- **`selector`**: reads text from the page. `fields` reads named parts of the match (a field with only an `attribute` reads it from the match itself), and `all: true` returns every match. Selector inputs may only use letters, numbers, `-` and `_`.
- **`navigate`**: opens a page on the same site.
- **`scroll`**: scrolls the page to an element.
- **`handler`**: calls a function you pass in `registerSite(schema, { handlers })`.

A tool that can't answer returns `{ "error": "..." }` with the reason, because browsers pass a failed tool call to the agent only as a generic error. `validateSchema` lists every problem in a schema at once.

## What's planned

- **Core library (built):** registers a site's tools through `document.modelContext`, with a polyfill when the browser doesn't have it yet.
- **Site schema:** one JSON or YAML file that maps each tool to page content or a data endpoint. It's the only file a site owner writes.
- **Loader (built):** a userscript build that applies a schema to a site that hasn't adopted the kit, for prototypes and demos.
- **Demo (built):** [globalgoals.org/goals](https://globalgoals.org/goals/), with read-only and navigation tools for the 17 Global Goals. See [examples/globalgoals](examples/globalgoals/).

## Not affiliated

This project isn't affiliated with or endorsed by Project Everyone, the Global Goals Campaign or the United Nations. The demos read their public content at runtime with attribution; the repo doesn't include their text, logos or icons.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
