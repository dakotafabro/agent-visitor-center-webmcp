import { appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer-core";

const [startUrl, userscriptPath] = process.argv.slice(2);
if (!startUrl || !userscriptPath) {
  console.error("usage: node scripts/webmcp-bridge.mjs <page url> <userscript path>");
  process.exit(2);
}
const callLog = process.env.AVC_CALL_LOG;
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = join(tmpdir(), `avc-bridge-${process.pid}-${Date.now()}`);

const userscript = await readFile(userscriptPath, "utf8");
const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  userDataDir: profile,
  args: ["--enable-features=WebMCPTesting"],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(userscript);
await page.goto(startUrl, { waitUntil: "networkidle2", timeout: 60000 });

let pendingNavigation = null;
page.on("request", (request) => {
  if (!request.isNavigationRequest() || request.frame() !== page.mainFrame() || pendingNavigation) return;
  pendingNavigation = new Promise((resolve) => {
    const done = (frame) => {
      if (frame !== page.mainFrame()) return;
      page.off("framenavigated", done);
      page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 }).catch(() => {}).finally(resolve);
    };
    page.on("framenavigated", done);
    setTimeout(resolve, 45000);
  }).finally(() => {
    pendingNavigation = null;
  });
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (pendingNavigation) await pendingNavigation;
}

async function pageTools() {
  await page.waitForFunction(async () => (await document.modelContext?.getTools?.())?.length > 0, { timeout: 20000 });
  return page.evaluate(async () =>
    (await document.modelContext.getTools()).map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema: typeof inputSchema === "string" ? JSON.parse(inputSchema) : inputSchema,
      annotations,
    })),
  );
}

async function log(entry) {
  if (callLog) await appendFile(callLog, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

const server = new Server({ name: "webmcp-bridge", version: "0.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await pageTools();
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: input = {} } = request.params;
  await settle();
  await pageTools();
  const urlBefore = page.url();
  let text;
  let isError = false;
  try {
    text = await page.evaluate(
      async (name, input) => {
        const tool = (await document.modelContext.getTools()).find((candidate) => candidate.name === name);
        if (!tool) return JSON.stringify({ error: `No tool named ${name} on this page.` });
        return document.modelContext.executeTool(tool, input);
      },
      name,
      input,
    );
  } catch (error) {
    if (/context was destroyed|navigat/i.test(String(error))) {
      text = JSON.stringify({ navigating: true });
    } else {
      isError = true;
      text = String(error);
    }
  }
  await settle();
  try {
    if (JSON.parse(text)?.error) isError = true;
  } catch {}
  await log({ tool: name, input, page: urlBefore, pageAfter: page.url(), isError, result: text.slice(0, 2000) });
  return { content: [{ type: "text", text }], isError };
});

async function shutdown() {
  await browser.close().catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
}
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await server.connect(new StdioServerTransport());
