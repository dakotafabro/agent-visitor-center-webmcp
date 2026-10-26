import { describe, expect, it } from "vitest";
import { pathValue } from "../src/sources.js";

const goal = {
  acf: {
    id: "1",
    flexible_content: [
      { acf_fc_layout: "single_column", column: [{ copy: "<h2>About</h2>" }] },
      { acf_fc_layout: "list", things_to_do: false, list: [{ copy: "Target 1.1" }, { copy: "Target 1.2" }] },
      { acf_fc_layout: "list", things_to_do: true, list: [{ copy: "Donate" }] },
    ],
  },
};

describe("pathValue", () => {
  it("reads nested keys", () => {
    expect(pathValue(goal, "acf.id")).toBe("1");
  });

  it("picks an array item by a field and maps over a list", () => {
    expect(pathValue(goal, "acf.flexible_content[things_to_do=false].list[].copy")).toEqual(["Target 1.1", "Target 1.2"]);
    expect(pathValue(goal, "acf.flexible_content[things_to_do=true].list[].copy")).toEqual(["Donate"]);
    expect(pathValue(goal, "acf.flexible_content[acf_fc_layout=single_column].column[].copy")).toEqual(["<h2>About</h2>"]);
  });

  it("returns undefined for a missing path or no match", () => {
    expect(pathValue(goal, "acf.missing.deeper")).toBeUndefined();
    expect(pathValue(goal, "acf.flexible_content[acf_fc_layout=video].list")).toBeUndefined();
    expect(pathValue(goal, "acf.id[]")).toBeUndefined();
  });
});
