# agent-visitor-center-webmcp

A visitor center for agents. When you arrive at a national park, the visitor center tells you what's there, what you can do and how to get around. This kit gives a website the same thing for AI agents: the site describes its tools in one small file, and the kit registers them through [WebMCP](https://github.com/webmachinelearning/webmcp) so an agent in the browser can use them.

## Status

Early development. The core library and the Global Goals demo work in Chrome 156, with native WebMCP and with the polyfill, and the MCP bridge serves a page's tools to goose or any MCP client. Not published to npm yet.

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

## Use it from goose or any MCP client

WebMCP tools live in a browser tab. To use them from an agent outside the browser, the bridge (`scripts/webmcp-bridge.mjs`) opens the page in headless Chrome with WebMCP turned on, loads a userscript with the site's schema, and serves the page's tools as an MCP server over stdio. Each call runs in the page through `document.modelContext.executeTool`, so the agent gets the same answer an agent in the browser would.

The package isn't on npm yet, so run it from a clone. It needs Node 22+ and Chrome (checked with Chrome 156; the bridge turns on `--enable-features=WebMCPTesting`). Set `CHROME_PATH` if Chrome isn't in its usual place.

```sh
git clone https://github.com/dakotafabro/agent-visitor-center-webmcp.git
cd agent-visitor-center-webmcp
npm install
npm run bridge-check
```

`npm run bridge-check` builds the Global Goals userscript, starts the bridge, and checks over MCP that the six tools are listed and answer.

**goose, for one session:**

```sh
goose session --with-extension "node $PWD/scripts/webmcp-bridge.mjs https://globalgoals.org/goals/ $PWD/dist-userscript/globalgoals.user.js"
```

Then ask, for example: "I mentor new engineers and build free lessons for people learning to code. Which Global Goals and targets overlap with that work?" The agent reads the goals and targets from globalgoals.org and compares them with what you told it. Nothing about your work is sent to the site.

**goose, every session** (`~/.config/goose/config.yaml`):

```yaml
extensions:
  globalgoals:
    type: stdio
    name: globalgoals
    description: The Global Goals and their targets, read from globalgoals.org
    cmd: node
    args:
      - /path/to/agent-visitor-center-webmcp/scripts/webmcp-bridge.mjs
      - https://globalgoals.org/goals/
      - /path/to/agent-visitor-center-webmcp/dist-userscript/globalgoals.user.js
    enabled: true
    timeout: 300
```

**Other MCP clients:** the same command as a stdio server, `{"command": "node", "args": ["<repo>/scripts/webmcp-bridge.mjs", "<page url>", "<userscript path>"]}`.

Notes:

- Use absolute paths, since clients start the bridge from their own working directory.
- One bridge serves one site. To follow several nonprofits, add one extension per site schema.
- `AVC_SHOW_BROWSER=1` opens a visible Chrome window instead of a headless one, and `AVC_CALL_LOG=<file>` writes each tool call as a line of JSON.
- Tool results are the site's own content. The read tools set `untrustedContentHint`, and an agent should treat what they return as data, not instructions.
- `npm run agent-check` runs goose against the bridge with the prompts in [`examples/globalgoals/agent-prompts.json`](examples/globalgoals/agent-prompts.json) and checks which tools it called.

## Site schema

Each tool has a `name`, a `description`, an optional JSON Schema `inputSchema`, optional WebMCP `annotations`, a `source`, and an optional `fallback` source that runs when the first one fails. `{name}` in a source fills in that input.

- **`endpoint`**: fetches JSON from `url`. `pick` maps output names to field paths (`"title.rendered"`; `list[]` maps over a list and `list[field=value]` picks one item), or to `{path, match, type, html}` to take a regular-expression capture, convert to a number, or read fields out of an HTML string the same way a `selector` source reads the page, `find` returns the one array item whose `field` equals a value, and `text: true` turns picked HTML into plain text. Requests go to the page's own origin or to one listed in `allowedOrigins`, without cookies.
- **`selector`**: reads text from the page. `fields` reads named parts of the match (a field with only an `attribute` reads it from the match itself, and fields can nest), `all: true` returns every match, and `match` and `type` work as in `pick`. Text reads the way a person sees it: block elements are separated by a space, and inline links stay in the sentence. Selector inputs may only use letters, numbers, `-` and `_`.
- **`navigate`**: opens a page on the same site.
- **`scroll`**: scrolls the page to an element.
- **`handler`**: calls a function you pass in `registerSite(schema, { handlers })`.

A tool that can't answer returns `{ "error": "..." }` with the reason, because browsers pass a failed tool call to the agent only as a generic error. `validateSchema` lists every problem in a schema at once.

## What's planned

- **Core library (built):** registers a site's tools through `document.modelContext`, with a polyfill when the browser doesn't have it yet.
- **Site schema:** one JSON or YAML file that maps each tool to page content or a data endpoint. It's the only file a site owner writes.
- **Loader (built):** a userscript build that applies a schema to a site that hasn't adopted the kit, for prototypes and demos.
- **MCP bridge (built):** serves a page's WebMCP tools to goose or any MCP client, through headless Chrome.
- **Demo (built):** [globalgoals.org/goals](https://globalgoals.org/goals/), with read-only and navigation tools for the 17 Global Goals. See [examples/globalgoals](examples/globalgoals/).

## Not affiliated

This project isn't affiliated with or endorsed by Project Everyone, the Global Goals Campaign or the United Nations. The demos read their public content at runtime with attribution; the repo doesn't include their text, logos or icons.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
