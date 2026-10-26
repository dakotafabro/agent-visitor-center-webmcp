import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const script = await readFile(new URL("../dist-userscript/globalgoals.user.js", import.meta.url), "utf8");
const failures = [];

function check(label, ok, detail) {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail === undefined ? "" : `: ${JSON.stringify(detail).slice(0, 160)}`}`);
  if (!ok) failures.push(label);
}

async function withPage(browser, url, { blockCms = false } = {}, run) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  if (blockCms) {
    await page.setRequestInterception(true);
    page.on("request", (request) => (request.url().includes("globalgoalscms.co.uk/wp-json") ? request.abort() : request.continue()));
  }
  await page.evaluate(script);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const call = (name, input = {}) =>
    page.evaluate(
      async (name, input) => {
        const context = document.modelContext;
        const tool = (await context.getTools()).find((candidate) => candidate.name === name);
        return JSON.parse(await context.executeTool(tool, input));
      },
      name,
      input,
    );
  try {
    await run(page, call);
  } finally {
    await page.close();
  }
}

for (const native of [true, false]) {
  const mode = native ? "native WebMCP" : "polyfill";
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    userDataDir: join(tmpdir(), `avc-live-${Date.now()}`),
    args: native ? ["--enable-features=WebMCPTesting"] : [],
  });
  console.log(`\n${mode} (${await browser.version()})`);
  try {
    await withPage(browser, "https://globalgoals.org/goals/13-climate-action/", {}, async (page, call) => {
      const hasNative = await page.evaluate(() => typeof document.modelContext?.getTools === "function");
      check(`${mode}: document.modelContext present`, hasNative);
      const tools = await page.evaluate(async () => (await document.modelContext.getTools()).map((tool) => tool.name).sort());
      check(`${mode}: six tools registered`, tools.length === 6, tools);
      const goals = await call("list_goals");
      check(`${mode}: list_goals returns 17 goals`, goals.length === 17, goals[12]);
      const goal = await call("get_goal", { number: 13 });
      check(`${mode}: get_goal 13 is Climate action`, goal.title === "Climate action", goal.summary);
      const targets = await call("get_targets", { number: 13 });
      check(`${mode}: get_targets 13 has targets`, targets.targets?.length > 0, targets.targets?.length);
      const actions = await call("get_actions", { number: 13 });
      check(`${mode}: get_actions 13 has actions`, actions.actions?.length > 0, actions.actions?.length);
      const scrolled = await call("scroll_to_section", { section: "targets" });
      check(`${mode}: scroll_to_section`, scrolled.scrolledTo === "#targets", scrolled);
      const bad = await call("get_goal", { number: "13, body" });
      check(`${mode}: unsafe input is refused with a reason`, typeof bad.error === "string", bad);
      await page.evaluate(async () => {
        const tool = (await document.modelContext.getTools()).find((candidate) => candidate.name === "open_goal");
        document.modelContext.executeTool(tool, { slug: "14-life-below-water" });
      });
      await page.waitForNavigation({ timeout: 20000 }).catch(() => {});
      check(`${mode}: open_goal navigates`, page.url() === "https://globalgoals.org/goals/14-life-below-water/", page.url());
    });
    await withPage(browser, "https://globalgoals.org/goals/", { blockCms: true }, async (_page, call) => {
      const goals = await call("list_goals");
      check(`${mode}: list_goals falls back to the page`, goals.length === 17, goals[0]);
    });
    await withPage(browser, "https://globalgoals.org/goals/13-climate-action/", { blockCms: true }, async (_page, call) => {
      const targets = await call("get_targets", { number: 13 });
      check(`${mode}: get_targets falls back to the page`, targets.length > 0, targets[0]);
      const other = await call("get_targets", { number: 14 });
      check(`${mode}: fallback won't read another goal's page`, typeof other.error === "string", other);
    });
  } finally {
    await browser.close();
  }
}

console.log(failures.length === 0 ? "\nAll live checks passed." : `\n${failures.length} live checks failed.`);
process.exit(failures.length === 0 ? 0 : 1);
