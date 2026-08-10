// Shape-mapping for Workers AI replies. Pure — no binding, no network.
//
// The tool-call case is the one that matters: an OpenAI-shaped reply carrying
// tool calls has `content: null`. A null check that rejects that branch drops
// through to the raw-payload fallback, which puts the entire API envelope into
// `text` and loses finish_reason. Measured against
// @cf/meta/llama-3.3-70b-instruct-fp8-fast.
//
// Nothing in this Worker asks for tools any more — §11 step 9 moved the tutor to
// services/agent-service, and generateStructured never passed any. These cases
// stay because `normalize()` maps whatever the provider sends, not whatever we
// asked for: a model that volunteers a tool call, or an account whose gateway
// injects one, still must not render an API envelope to a learner. The cost of
// keeping them is four assertions; the cost of the bug was a user-visible one.

import { describe, it, expect } from "vitest";
import { normalize } from "../src/ai/providers/cloudflare.js";

const toolReply = {
  choices: [
    {
      finish_reason: "tool_calls",
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "hsk_word_list",
              arguments: '{"level":3,"limit":10}',
            },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 210, completion_tokens: 24 },
};

describe("normalize — tool calls", () => {
  it("returns empty text rather than the raw envelope", () => {
    const out = normalize(toolReply);
    expect(out.text).toBe("");
    // The regression: the whole payload used to land here and render to a user.
    expect(out.text).not.toContain("finish_reason");
    expect(out.text).not.toContain("choices");
  });

  it("keeps the finish reason", () => {
    expect(normalize(toolReply).stopReason).toBe("tool_calls");
  });

  it("parses the calls, including stringified arguments", () => {
    const { toolCalls } = normalize(toolReply);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("hsk_word_list");
    expect(toolCalls[0].input).toEqual({ level: 3, limit: 10 });
  });

  it("reports usage", () => {
    expect(normalize(toolReply).usage).toEqual({
      inputTokens: 210,
      outputTokens: 24,
    });
  });
});

describe("normalize — other shapes still work", () => {
  it("handles a plain text reply", () => {
    const out = normalize({ response: "翻译 means 'to translate'." });
    expect(out.text).toBe("翻译 means 'to translate'.");
    expect(out.toolCalls).toEqual([]);
  });

  it("handles an OpenAI-shaped reply with prose", () => {
    const out = normalize({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "HSK 4." } }],
    });
    expect(out.text).toBe("HSK 4.");
    expect(out.stopReason).toBe("stop");
  });

  it("stringifies an array response so extraction sees consistent input", () => {
    expect(normalize({ response: [{ front: "书" }] }).text).toBe('[{"front":"书"}]');
  });

  it("handles a bare string", () => {
    expect(normalize("hello").text).toBe("hello");
  });

  it("falls back to the raw payload only when nothing is recognised", () => {
    expect(normalize({ mystery: 1 }).text).toBe('{"mystery":1}');
  });
});
