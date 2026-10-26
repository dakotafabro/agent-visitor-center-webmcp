import { readFile, rm } from "node:fs/promises";
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

function shapeOf(value) {
  if (Array.isArray(value)) return value.length === 0 ? [] : [shapeOf(value[0])];
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]));
  return typeof value;
}

function firstDifference(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path || "list"} has ${a.length} items from the API and ${b.length} from the page`;
    for (let index = 0; index < a.length; index++) {
      const found = firstDifference(a[index], b[index], `${path}[${index}]`);
      if (found) return found;
    }
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference(a[key], b[key], path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return `${path}: API ${JSON.stringify(a).slice(0, 70)} vs page ${JSON.stringify(b).slice(0, 70)}`;
}

function sameShape(label, fromApi, fromPage) {
  check(`${label} has the same shape from the API and the page`, JSON.stringify(shapeOf(fromApi)) === JSON.stringify(shapeOf(fromPage)), shapeOf(fromPage));
  const difference = firstDifference(fromApi, fromPage);
  console.log(`      values ${difference ? `differ: ${difference}` : "match exactly"}`);
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
  const profile = join(tmpdir(), `avc-live-${Date.now()}`);
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    userDataDir: profile,
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
      check(`${mode}: list_goals returns 17 goals with numeric numbers`, goals.length === 17 && goals[12].number === 13, goals[12]);
      const goal = await call("get_goal", { number: 13 });
      check(`${mode}: get_goal 13 is Climate action`, goal.title === "Climate action", goal.summary);
      const targets = await call("get_targets", { number: 13 });
      check(`${mode}: get_targets 13 has targets`, targets.targets?.length > 0, targets.targets?.[0]);
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
    const fromApi = {};
    await withPage(browser, "https://globalgoals.org/goals/", {}, async (_page, call) => {
      fromApi.list_goals = await call("list_goals");
    });
    await withPage(browser, "https://globalgoals.org/goals/13-climate-action/", {}, async (_page, call) => {
      for (const name of ["get_goal", "get_targets", "get_actions"]) fromApi[name] = await call(name, { number: 13 });
    });
    await withPage(browser, "https://globalgoals.org/goals/", { blockCms: true }, async (_page, call) => {
      const goals = await call("list_goals");
      check(`${mode}: list_goals falls back to the page`, goals.length === 17, goals[0]);
      sameShape(`${mode}: list_goals`, fromApi.list_goals, goals);
    });
    await withPage(browser, "https://globalgoals.org/goals/13-climate-action/", { blockCms: true }, async (_page, call) => {
      for (const name of ["get_goal", "get_targets", "get_actions"]) {
        sameShape(`${mode}: ${name}`, fromApi[name], await call(name, { number: 13 }));
      }
      const other = await call("get_targets", { number: 14 });
      check(`${mode}: fallback won't read another goal's page`, typeof other.error === "string", other);
    });
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
}

console.log(failures.length === 0 ? "\nAll live checks passed." : `\n${failures.length} live checks failed.`);
process.exit(failures.length === 0 ? 0 : 1);
