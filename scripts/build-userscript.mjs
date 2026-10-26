import { mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const banner = [
  "// ==UserScript==",
  "// @name         Agent visitor center: The Global Goals",
  "// @namespace    https://github.com/dakotafabro/agent-visitor-center-webmcp",
  `// @version      ${pkg.version}`,
  "// @description  Registers WebMCP tools for the Global Goals pages so an agent in the browser can read them.",
  "// @match        https://globalgoals.org/goals/*",
  "// @match        https://www.globalgoals.org/goals/*",
  "// @run-at       document-idle",
  "// @grant        none",
  "// ==/UserScript==",
].join("\n");

await mkdir(new URL("../dist-userscript/", import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL("../examples/globalgoals/userscript.ts", import.meta.url).pathname],
  outfile: new URL("../dist-userscript/globalgoals.user.js", import.meta.url).pathname,
  bundle: true,
  format: "iife",
  target: "es2022",
  legalComments: "inline",
  banner: { js: banner },
});
console.log("built dist-userscript/globalgoals.user.js");
