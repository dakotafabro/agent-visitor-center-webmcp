import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/index.js";
import schema from "../examples/globalgoals/schema.json" with { type: "json" };

describe("the Global Goals example schema", () => {
  it("is valid", () => {
    expect(validateSchema(schema)).toEqual({ ok: true, schema });
  });
});
