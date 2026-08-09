// Argument repair.
//
// Every case in the first describe block is a shape the model actually emitted
// during the phase-0 probe, not a hypothetical. They are here so a change to
// the coercion rules has to confront real model output.

import { describe, it, expect } from "vitest";
import { repairArgs } from "../src/tools/repair.js";

const wordListSchema = {
  type: "object",
  properties: {
    level: { type: "integer", minimum: 1, maximum: 7 },
    limit: { type: "integer", minimum: 1, maximum: 20 },
    known: { type: "array", items: { type: "string" } },
    scheme: { type: "string", enum: ["new", "old"] },
  },
  required: ["level"],
};

describe("what the model actually sent", () => {
  it('turns {"level":"3","limit":"10"} into numbers', () => {
    const { args, repaired } = repairArgs(wordListSchema, { level: "3", limit: "10" });
    expect(args).toEqual({ level: 3, limit: 10 });
    expect(repaired.sort()).toEqual(["level", "limit"]);
  });

  it('turns a stringified array into an array', () => {
    const schema = { type: "object", properties: { words: { type: "array", items: { type: "string" } } } };
    const { args } = repairArgs(schema, { words: '["帮忙", "改变", "终于"]' });
    expect(args.words).toEqual(["帮忙", "改变", "终于"]);
  });

  it("handles a bare comma-separated list, the other thing models emit", () => {
    const schema = { type: "object", properties: { words: { type: "array", items: { type: "string" } } } };
    expect(repairArgs(schema, { words: "帮忙, 改变 ,终于" }).args.words).toEqual([
      "帮忙",
      "改变",
      "终于",
    ]);
  });

  it("wraps a single value into an array", () => {
    const schema = { type: "object", properties: { known: { type: "array", items: { type: "string" } } } };
    expect(repairArgs(schema, { known: "你好" }).args.known).toEqual(["你好"]);
  });
});

describe("clamping", () => {
  it("pulls an out-of-range level back to the schema bounds", () => {
    expect(repairArgs(wordListSchema, { level: 9 }).args.level).toBe(7);
    expect(repairArgs(wordListSchema, { level: 0 }).args.level).toBe(1);
    expect(repairArgs(wordListSchema, { level: "99" }).args.level).toBe(7);
  });

  it("rounds a float to an integer", () => {
    expect(repairArgs(wordListSchema, { level: 3.7 }).args.level).toBe(4);
  });

  it("caps an over-long array", () => {
    const schema = {
      type: "object",
      properties: { words: { type: "array", items: { type: "string" }, maxItems: 2 } },
    };
    expect(repairArgs(schema, { words: ["a", "b", "c", "d"] }).args.words).toEqual(["a", "b"]);
  });
});

describe("what it must not do", () => {
  it("leaves correct arguments untouched and reports no repair", () => {
    const { args, repaired } = repairArgs(wordListSchema, { level: 3, limit: 10, scheme: "new" });
    expect(args).toEqual({ level: 3, limit: 10, scheme: "new" });
    expect(repaired).toEqual([]);
  });

  it("never rejects — a repaired call that runs beats a retry that costs a turn", () => {
    // Genuinely unusable input passes through for the service to reject, where
    // the real validation lives.
    const { args } = repairArgs(wordListSchema, { level: "not a number" });
    expect(args.level).toBe("not a number");
  });

  it("ignores fields the schema does not describe", () => {
    const { args } = repairArgs(wordListSchema, { level: "3", nonsense: { deep: true } });
    expect(args.nonsense).toEqual({ deep: true });
  });

  it("survives a missing schema or junk args", () => {
    expect(repairArgs(null, { a: 1 }).args).toEqual({ a: 1 });
    expect(repairArgs(wordListSchema, null).args).toEqual({});
    expect(repairArgs(wordListSchema, undefined).args).toEqual({});
  });

  it("does not add fields that were not sent", () => {
    expect(repairArgs(wordListSchema, { level: 3 }).args).toEqual({ level: 3 });
  });

  // No tool declares a nested object today, which is why this shipped broken:
  // the branch returned repairArgs' whole { args, repaired } envelope as the
  // field's value. It fails silently — the service reads the wrapper where it
  // expected the object, every field is undefined, and nothing throws.
  describe("a nested object", () => {
    const schema = {
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: {
            level: { type: "integer", minimum: 1, maximum: 7 },
            words: { type: "array", items: { type: "string" } },
          },
        },
      },
    };

    it("is repaired in place, not replaced by the repair envelope", () => {
      const { args } = repairArgs(schema, { filter: { level: "3", words: "书,银行" } });
      expect(args.filter).toEqual({ level: 3, words: ["书", "银行"] });
      expect(args.filter.args).toBeUndefined();
      expect(args.filter.repaired).toBeUndefined();
    });

    it("reports the change under the parent field", () => {
      const { repaired } = repairArgs(schema, { filter: { level: "3" } });
      expect(repaired).toEqual(["filter"]);
    });

    it("leaves an already-correct nested object untouched", () => {
      const { args, repaired } = repairArgs(schema, { filter: { level: 3 } });
      expect(args.filter).toEqual({ level: 3 });
      expect(repaired).toEqual([]);
    });

    it("passes through a non-object where one was declared", () => {
      expect(repairArgs(schema, { filter: "nope" }).args.filter).toBe("nope");
      expect(repairArgs(schema, { filter: [1, 2] }).args.filter).toEqual([1, 2]);
    });
  });
});
