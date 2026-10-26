# Demo: The Global Goals

Six WebMCP tools for [globalgoals.org/goals](https://globalgoals.org/goals/), defined in [`schema.json`](schema.json):

- `list_goals`: `[{number, title, summary, slug}]` for all 17 goals
- `get_goal(number)`: `{number, title, summary, introduction: [paragraphs], slug}`
- `get_targets(number)`: `{number, targets: [{title, text}]}`
- `get_actions(number)`: `{number, actions: [text]}`, the goal's "things to do"
- `open_goal(slug)`: opens a goal's page in the same tab
- `scroll_to_section(section)`: scrolls a goal's page to `targets` or `things-to-do`

The read tools use the site's public WordPress API and fall back to reading the page, with the same shape either way. The live check compares the two answers value by value. The fallbacks for one goal only answer on that goal's own page. Nothing is sent to the site, and the repo holds none of its text, logos or icons.

This project isn't affiliated with or endorsed by Project Everyone, the Global Goals Campaign or the United Nations. Goal descriptions on globalgoals.org are published under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

## Try it

1. Build the userscript: `npm install && npm run build:userscript`. It's written to `dist-userscript/globalgoals.user.js`.
2. Use Chrome with `chrome://flags/#enable-webmcp-testing` enabled for native WebMCP. Without the flag, the bundled polyfill provides `document.modelContext`.
3. Load the script on a globalgoals.org goals page, either:
   - in a userscript manager such as Tampermonkey, by creating a new script from the file, or
   - by pasting the file into the DevTools console on the page.
4. Open an agent that reads WebMCP tools, such as Chrome's [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp) extension, and ask something like "What can I do for Goal 13?"

## Check it against the live site

`npm run live-check` loads the script into headless Chrome on the live site, once with native WebMCP and once with the polyfill, calls every tool, and repeats the read tools with the site's API blocked to check that the fallbacks return the same shape and values. It needs Google Chrome installed (set `CHROME_PATH` if it isn't in `/Applications`). It isn't part of CI, since it depends on a third-party site.

## Check it with a real agent

`npm run agent-check` gives the page's tools to [goose](https://github.com/aaif-goose/goose) and asks the questions in [`agent-prompts.json`](agent-prompts.json), such as "What can I do for Goal 13?". A small bridge (`scripts/webmcp-bridge.mjs`) opens the live page in headless Chrome with native WebMCP, lists the tools from `getTools()` as an MCP server, and runs each call through `executeTool()` in the page. goose runs with no other extensions, so the model can only answer from the page's tools.

Each prompt passes when the model made the expected calls and they succeeded on the expected page. The calls, inputs, results and the model's answer are written to `agent-check-results/`. It needs goose with a configured model and Google Chrome.

The userscript only registers in the top-level page (`@noframes` and a `window.top` check). Same-origin `about:blank` iframes on the site would otherwise register their own copies, and `open_goal` could navigate an iframe instead of the tab.
