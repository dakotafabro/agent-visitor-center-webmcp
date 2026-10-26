import { registerSite } from "../../src/index.js";
import schema from "./schema.json" with { type: "json" };

if (window.top === window) {
  registerSite(schema)
    .then((registration) => console.info(`[agent-visitor-center] registered ${registration.tools.join(", ")}`))
    .catch((error: unknown) => console.error("[agent-visitor-center]", error));
}
