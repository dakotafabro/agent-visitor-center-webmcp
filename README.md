# agent-visitor-center-mcp

A visitor center for agents. When you arrive at a national park, the visitor center tells you what's there, what you can do and how to get around. This kit gives a website the same thing for AI agents: the site describes its tools in one small file, and the kit registers them through [WebMCP](https://github.com/webmachinelearning/webmcp) so an agent in the browser can use them.

## Status

Early planning. Nothing here is ready to use yet.

## What's planned

- **Core library:** registers a site's tools through `navigator.modelContext`, with a polyfill when the browser doesn't have it yet.
- **Site schema:** one JSON or YAML file that maps each tool to page content or a data endpoint. It's the only file a site owner writes.
- **Loader:** a userscript or extension build that applies a schema to a site that hasn't adopted the kit, for prototypes and demos.
- **Demos:**
  - [globalgoals.org/goals](https://globalgoals.org/goals/): read-only and navigation tools for the 17 Global Goals.
  - The [UN SDG API](https://unstats.un.org/sdgs/): the same goals as structured data.

## Not affiliated

This project isn't affiliated with or endorsed by Project Everyone, the Global Goals Campaign or the United Nations. The demos read their public content at runtime with attribution; the repo doesn't include their text, logos or icons.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
