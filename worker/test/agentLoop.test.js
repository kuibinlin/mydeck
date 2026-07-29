// The agent loop, driven by a scripted model.
//
// callModel is stubbed so the turns are deterministic — the point is the loop's
// control flow, not the model's judgement. The behaviours pinned here are the
// ones that decide whether a weak model produces a usable run or an expensive
// mess: caps, repeated calls, and failures arriving as data.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAgent } from "../src/ai/agentLoop.js";
import * as callModelModule from "../src/ai/callModel.js";

const env = { AI_DEFAULT_PROVIDER: "cloudflare" };

// A model turn. Tool calls first, then a final prose answer.
const turn = (text, toolCalls = []) => ({
  text,
  toolCalls,
  stopReason: toolCalls.length ? "tool_calls" : "stop",
  usage: null,
  raw: {},
});

const call = (name, input, id = "c1") => ({ id, name, input });

function scriptModel(turns) {
  let i = 0;
  return vi.spyOn(callModelModule, "callModel").mockImplementation(async () => {
    const t = turns[Math.min(i, turns.length - 1)];
    i++;
    return t;
  });
}

let spy;
afterEach(() => spy?.mockRestore());
beforeEach(() => vi.restoreAllMocks());

describe("the happy path", () => {
  it("runs a tool, feeds the result back, and answers", async () => {
    spy = scriptModel([
      turn("", [call("hsk_lookup", { word: "书" })]),
      turn("书 means book — one of the first nouns worth knowing."),
    ]);

    const seen = [];
    const out = await runAgent([{ role: "user", content: "what is 书" }], {
      env,
      tools: [{}],
      execute: async (name, args) => {
        seen.push({ name, args });
        return { ok: true, result: { pinyin: "shū" } };
      },
    });

    expect(seen).toEqual([{ name: "hsk_lookup", args: { word: "书" } }]);
    expect(out.text).toMatch(/book/);
    expect(out.stoppedBy).toBe("answered");
    expect(out.steps).toEqual([
      { tool: "hsk_lookup", args: { word: "书" }, ok: true, error: undefined },
    ]);
  });

  it("chains two dependent calls — the flagship pipeline", async () => {
    spy = scriptModel([
      turn("", [call("hsk_word_list", { level: 3 })]),
      turn("", [call("create_activity", { type: "stroke" }, "c2")]),
      turn("Ten HSK 3 words, with a stroke sheet below."),
    ]);

    const out = await runAgent([{ role: "user", content: "10 hsk 3 words then how to write" }], {
      env,
      tools: [{}],
      execute: async () => ({ ok: true, result: {} }),
    });

    expect(out.steps.map((s) => s.tool)).toEqual(["hsk_word_list", "create_activity"]);
    expect(out.stoppedBy).toBe("answered");
  });
});

describe("failures arrive as data, not exceptions", () => {
  it("hands a tool error back so the model can recover", async () => {
    spy = scriptModel([
      turn("", [call("add_flashcard", { deckId: 1 })]),
      turn("That deck is full — shall I start a new one?"),
    ]);

    const out = await runAgent([{ role: "user", content: "add it" }], {
      env,
      tools: [{}],
      execute: async () => ({ ok: false, error: "Deck has reached the 50-card limit" }),
    });

    expect(out.text).toMatch(/full/);
    expect(out.steps[0].ok).toBe(false);
    expect(out.steps[0].error).toMatch(/50-card/);
  });

  it("stops offering tools after two straight failures, and still answers", async () => {
    spy = scriptModel([
      turn("", [call("hsk_lookup", { word: "a" }, "c1")]),
      turn("", [call("hsk_lookup", { word: "b" }, "c2")]),
      turn("I could not reach the dictionary just now."),
    ]);

    const out = await runAgent([{ role: "user", content: "x" }], {
      env,
      tools: [{}],
      execute: async () => ({ ok: false, error: "upstream down" }),
    });

    expect(out.text).toMatch(/could not reach/);
    // Third call was made without tools offered, so no third tool ran.
    expect(out.steps).toHaveLength(2);
  });
});

describe("caps", () => {
  it("breaks a repeated identical call instead of running it again", async () => {
    spy = scriptModel([
      turn("", [call("hsk_lookup", { word: "书" }, "c1")]),
      turn("", [call("hsk_lookup", { word: "书" }, "c2")]),
      turn("书 means book."),
    ]);

    let executions = 0;
    const out = await runAgent([{ role: "user", content: "书" }], {
      env,
      tools: [{}],
      execute: async () => {
        executions++;
        return { ok: true, result: { pinyin: "shū" } };
      },
    });

    expect(executions).toBe(1);
    expect(out.steps[1].repeated).toBe(true);
  });

  it("stops at maxSteps and still returns what it has", async () => {
    // A model that never stops calling tools.
    spy = scriptModel([turn("", [call("hsk_lookup", { word: `${Math.random()}` })])]);

    let n = 0;
    const out = await runAgent([{ role: "user", content: "x" }], {
      env,
      tools: [{}],
      maxSteps: 3,
      execute: async () => {
        n++;
        return { ok: true, result: {} };
      },
    });

    expect(n).toBeLessThanOrEqual(3);
    expect(out).toHaveProperty("steps");
  });

  // Found end to end: asking about 翻译 spent all four steps on tool calls and
  // came back with empty prose — a card on screen with an unexplained silence
  // next to it. The loop now asks for an answer with tools withheld.
  it("asks for an answer when the cap arrives with no prose", async () => {
    let withTools = 0;
    let withoutTools = 0;
    spy = vi.spyOn(callModelModule, "callModel").mockImplementation(async (_m, opts) => {
      if (opts.tools?.length) {
        withTools++;
        return turn("", [call("hsk_lookup", { word: `w${withTools}` }, `c${withTools}`)]);
      }
      withoutTools++;
      return turn("翻译 means to translate.");
    });

    const out = await runAgent([{ role: "user", content: "翻译" }], {
      env,
      tools: [{}],
      maxSteps: 2,
      execute: async () => ({ ok: true, result: {} }),
    });

    expect(withoutTools).toBe(1);
    expect(out.text).toBe("翻译 means to translate.");
    expect(out.stoppedBy).toBe("answered_after_cap");
  });

  it("does not make a rescue call when the model already answered", async () => {
    spy = scriptModel([turn("", [call("hsk_lookup", { word: "书" })]), turn("书 means book.")]);

    await runAgent([{ role: "user", content: "书" }], {
      env,
      tools: [{}],
      execute: async () => ({ ok: true, result: {} }),
    });

    expect(spy).toHaveBeenCalledTimes(2); // no third, rescue call
  });

  it("honours the tool-call budget, which is the shared rate limit's share", async () => {
    let i = 0;
    spy = vi.spyOn(callModelModule, "callModel").mockImplementation(async () => {
      i++;
      return turn("", [call("hsk_lookup", { word: `w${i}` }, `c${i}`)]);
    });

    let executions = 0;
    await runAgent([{ role: "user", content: "x" }], {
      env,
      tools: [{}],
      maxSteps: 10,
      maxToolCalls: 2,
      execute: async () => {
        executions++;
        return { ok: true, result: {} };
      },
    });

    expect(executions).toBeLessThanOrEqual(2);
  });
});

describe("the model itself failing", () => {
  it("retries once on the first turn", async () => {
    let n = 0;
    spy = vi.spyOn(callModelModule, "callModel").mockImplementation(async () => {
      n++;
      if (n === 1) throw new Error("transient");
      return turn("Recovered.");
    });

    const out = await runAgent([{ role: "user", content: "x" }], {
      env,
      tools: [],
      execute: async () => ({ ok: true, result: {} }),
    });

    expect(n).toBe(2);
    expect(out.text).toBe("Recovered.");
  });

  it("throws a 502 when the retry also fails", async () => {
    spy = vi.spyOn(callModelModule, "callModel").mockRejectedValue(new Error("down"));

    const err = await runAgent([{ role: "user", content: "x" }], {
      env,
      tools: [],
      execute: async () => ({ ok: true, result: {} }),
    }).catch((e) => e);

    expect(err.status).toBe(502);
  });
});
