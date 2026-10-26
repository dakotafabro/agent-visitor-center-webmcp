import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const prompts = JSON.parse(await readFile(join(root, "examples/globalgoals/agent-prompts.json"), "utf8"));
const only = process.argv[2];
const outDir = process.env.AVC_AGENT_OUT ?? join(root, "agent-check-results");
await mkdir(outDir, { recursive: true });

const system = [
  "You are helping someone on globalgoals.org in their browser.",
  "Answer only with the tools from the page's webmcp extension. Don't use any other source.",
  "Keep the final answer short.",
].join(" ");

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function matches(expected, calls) {
  const succeeded = calls.filter((call) => !call.isError);
  if (expected.anyOf) return succeeded.some((call) => expected.anyOf.includes(call.tool));
  return succeeded.some(
    (call) =>
      call.tool === expected.tool &&
      Object.entries(expected.input ?? {}).every(([key, value]) => String(call.input?.[key]) === String(value)) &&
      (expected.pageAfter === undefined || call.pageAfter === expected.pageAfter),
  );
}

const summary = [];
for (const item of prompts.filter((entry) => !only || entry.id === only)) {
  const callLog = join(outDir, `${item.id}.calls.jsonl`);
  await rm(callLog, { force: true });
  const bridge = `webmcp:AVC_CALL_LOG=${callLog} node ${join(root, "scripts/webmcp-bridge.mjs")} ${item.start} ${join(root, "dist-userscript/globalgoals.user.js")}`;
  const started = Date.now();
  const result = await run("goose", ["run", "--no-session", "--no-profile", "--quiet", "--max-turns", "12", "--with-extension", bridge, "--system", system, "-t", item.prompt]);
  const calls = (await readFile(callLog, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const missing = item.expect.filter((expected) => !matches(expected, calls));
  const errors = calls.filter((call) => call.isError);
  const entry = {
    id: item.id,
    prompt: item.prompt,
    passed: result.code === 0 && missing.length === 0,
    seconds: Math.round((Date.now() - started) / 1000),
    calls: calls.map(({ tool, input, isError, pageAfter }) => ({ tool, input, isError, pageAfter })),
    missing,
    errors: errors.map(({ tool, input, result }) => ({ tool, input, result })),
    answer: result.stdout.trim(),
    exitCode: result.code,
  };
  if (result.code !== 0) entry.stderr = result.stderr.slice(-1500);
  await writeFile(join(outDir, `${item.id}.json`), JSON.stringify(entry, null, 2));
  summary.push(entry);
  console.log(`${entry.passed ? "pass" : "FAIL"}  ${item.id} (${entry.seconds}s): ${calls.map((call) => `${call.tool}(${JSON.stringify(call.input)})`).join(" -> ") || "no tool calls"}`);
  if (missing.length) console.log(`      missing (a successful call): ${JSON.stringify(missing)}`);
  for (const error of errors) console.log(`      tool error: ${error.tool}(${JSON.stringify(error.input)}) -> ${error.result.slice(0, 120)}`);
}
await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
const failed = summary.filter((entry) => !entry.passed).length;
console.log(failed === 0 ? `\nAll ${summary.length} agent checks passed.` : `\n${failed} of ${summary.length} agent checks failed.`);
process.exit(failed === 0 ? 0 : 1);
