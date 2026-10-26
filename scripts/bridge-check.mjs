import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "scripts/webmcp-bridge.mjs"), "https://globalgoals.org/goals/", join(root, "dist-userscript/globalgoals.user.js")],
  stderr: "inherit",
});
const client = new Client({ name: "bridge-check", version: "0.0.0" });
await client.connect(transport);

const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError, value: JSON.parse(result.content[0].text) };
};

try {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  const expected = ["get_actions", "get_goal", "get_targets", "list_goals", "open_goal", "scroll_to_section"];
  check("lists the six page tools over MCP", JSON.stringify(names) === JSON.stringify(expected), names.join(", "));
  check("read tools keep their readOnlyHint", tools.filter((t) => t.name.startsWith("get_") || t.name === "list_goals").every((t) => t.annotations?.readOnlyHint === true));

  const goals = await call("list_goals", {});
  check("list_goals returns 17 goals", !goals.isError && Array.isArray(goals.value) && goals.value.length === 17);

  const targets = await call("get_targets", { number: 4 });
  check("get_targets(4) returns targets", !targets.isError && targets.value.number === 4 && targets.value.targets?.length > 0, `${targets.value.targets?.length ?? 0} targets`);

  const bad = await call("get_goal", { number: 99 });
  check("an out-of-range goal comes back as an MCP error", bad.isError === true && typeof bad.value.error === "string", bad.value.error);
} finally {
  await client.close();
}

console.log(failures.length === 0 ? "\nBridge check passed." : `\n${failures.length} bridge checks failed.`);
process.exit(failures.length === 0 ? 0 : 1);
