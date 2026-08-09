// The Worker's half of the agent boundary.
//
// Every case here is the Worker refusing to believe something. That is the
// point of the file: the agent service is a separate process on public ingress
// (docs/architecture.md §7.3), so its response is input, not truth.
//
// What is NOT tested here, because this layer cannot know it: whether a
// `word_ref` names a real word, whether a deck belongs to the caller, whether
// the save tool was offered this turn. Those need the Worker's own per-request
// state and belong to services/tutor.js.
//
// `env` is synthetic rather than the bound test env — runTurn takes it as an
// argument, so a test can vary the URL, secret and timeout without touching
// wrangler.test.toml. Outbound fetch still goes through the interceptor in
// vitest.config.mjs, which answers `agent.test.invalid` by scenario.

import { describe, it, expect } from "vitest";
import { runTurn, isConfigured, AGENT_CONTRACT } from "../src/integrations/agentService.js";

const URL_OK = "https://agent.test.invalid";

const env = (overrides = {}) => ({ AGENT_SERVICE_URL: URL_OK, ...overrides });

// The scenario travels as the learner's message — see vitest.config.mjs.
function turn(scenario, { envOverrides = {}, ...overrides } = {}) {
  return runTurn(env(envOverrides), {
    messages: [{ role: "user", content: scenario }],
    knownWords: [
      { i: 0, simplified: "医院", pinyin: "yīyuàn", meaning: "hospital", found: true, source: "seed" },
      { i: 1, simplified: "银行", pinyin: "yínháng", meaning: "bank", found: true, source: "prior" },
    ],
    decks: [{ id: 3, name: "HSK 3", card_count: 12 }],
    allowedTools: ["hsk_lookup", "save_words_to_deck"],
    level: 3,
    ...overrides,
  });
}

describe("configuration", () => {
  it("reports whether the service can be called at all", () => {
    expect(isConfigured(env())).toBe(true);
    expect(isConfigured({})).toBe(false);
  });

  it("refuses to call an unconfigured service", async () => {
    await expect(turn("ok", { envOverrides: { AGENT_SERVICE_URL: "" } })).rejects.toThrow(
      /not configured/i,
    );
  });

  it("tolerates a trailing slash on the configured URL", async () => {
    const result = await turn("ok", { envOverrides: { AGENT_SERVICE_URL: `${URL_OK}/` } });
    expect(result.message).toContain("hospital");
  });
});

describe("the request the Worker sends", () => {
  it("carries the contract, the words and the allowlist", async () => {
    const sent = JSON.parse((await turn("echo")).message);

    expect(sent.contract_version).toBe(AGENT_CONTRACT.CONTRACT_VERSION);
    expect(sent.request_id).toBeTruthy();
    expect(sent.allowed_tools).toEqual(["hsk_lookup", "save_words_to_deck"]);
    expect(sent.level).toBe(3);
    expect(sent.known_words).toHaveLength(2);
    expect(sent.decks[0].id).toBe(3);
  });

  it("sends indices, and words only as the Worker resolved them", async () => {
    // The load-bearing property of §7.2: the agent can only ever name a word
    // this Worker produced, because that is all it was given.
    const sent = JSON.parse((await turn("echo")).message);
    expect(sent.known_words.map((w) => w.i)).toEqual([0, 1]);
    expect(sent.known_words[1].source).toBe("prior");
  });

  it("attaches the shared secret when one is configured", async () => {
    await expect(turn("needs_secret")).rejects.toThrow(/502|error/i);

    const result = await turn("needs_secret", {
      envOverrides: { AGENT_SERVICE_SECRET: "test-agent-secret" },
    });
    expect(result.message).toContain("hospital");
  });
});

describe("the envelope", () => {
  it("accepts a well-formed response", async () => {
    const result = await turn("ok");
    expect(result.message).toContain("hospital");
    expect(result.intendedActions).toEqual([]);
    expect(result.usage).toEqual({ modelCalls: 1, inputTokens: 120, outputTokens: 40 });
  });

  it("rejects a different contract version", async () => {
    // A future version is not a superset — it is a different agreement, and
    // reading it as this one is how a boundary stops being one.
    await expect(turn("wrong_contract")).rejects.toThrow(/contract mismatch/i);
  });

  it("rejects a response to a different request", async () => {
    // Shadow mode runs two turns at once by design, so "the wrong one" is a
    // real failure mode rather than a theoretical one.
    await expect(turn("wrong_request")).rejects.toThrow(/different request/i);
  });

  it("rejects a body that is not JSON", async () => {
    await expect(turn("not_json")).rejects.toThrow(/unreadable/i);
  });

  it("rejects an error status", async () => {
    await expect(turn("server_error")).rejects.toThrow(/502|error/i);
  });

  it("times out rather than holding the learner's request open", async () => {
    // Bounded well inside the client-facing request: the cards are already a
    // complete answer, so losing the tutor is a soft failure and losing the
    // request is not.
    await expect(
      turn("slow", { envOverrides: { AGENT_SERVICE_TIMEOUT_MS: "50" } }),
    ).rejects.toThrow(/did not answer within 50ms/i);
  });

  it("says WHY it failed, because the two failures cost different things", async () => {
    // services/tutor.js reads `.reason`: a timeout has already spent the
    // request's budget so retrying locally makes the learner wait twice, while
    // a fast fault costs nothing to retry.
    const reason = async (scenario, envOverrides = {}) =>
      turn(scenario, { envOverrides }).then(
        () => null,
        (err) => err.reason,
      );

    expect(await reason("slow", { AGENT_SERVICE_TIMEOUT_MS: "50" })).toBe("timeout");
    expect(await reason("server_error")).toBe("status");
    expect(await reason("not_json")).toBe("unreadable");
    expect(await reason("wrong_contract")).toBe("contract");
    expect(await reason("wrong_request")).toBe("mismatch");
    expect(await reason("unknown_action")).toBe("shape");
  });
});

describe("intended actions", () => {
  it("normalises both action types", async () => {
    const { intendedActions } = await turn("actions");

    expect(intendedActions).toEqual([
      { type: "save_words_to_deck", wordRefs: [0, 1], deckId: 3, deckName: null },
      { type: "create_activity", activityType: "match", wordRefs: [0], deckId: null, level: 3, title: null },
    ]);
  });

  it("rejects an unknown action type outright", async () => {
    // Not filtered out. A service asking for something this Worker does not
    // implement must not get a 200 and a reply implying it happened — and the
    // type nobody here has heard of is exactly the one a filter would hide.
    await expect(turn("unknown_action")).rejects.toThrow(/unknown agent action/i);
  });

  it("rejects an activity type outside the Worker's own vocabulary", async () => {
    await expect(turn("bad_activity")).rejects.toThrow(/unknown activity type/i);
  });

  it("rejects a negative word reference", async () => {
    await expect(turn("negative_ref")).rejects.toThrow(/bad word reference/i);
  });

  it("rejects more actions than a turn can produce", async () => {
    await expect(turn("too_many_actions")).rejects.toThrow(/too many actions/i);
  });
});

describe("discovered words", () => {
  it("keeps only things shaped like words, deduplicated", async () => {
    // The one place characters travel back, so it gets the same treatment
    // conversation.js gives words the browser sends: Han, short, and re-resolved
    // against the index before anything is done with them.
    const { discoveredWords } = await turn("dirty_words");
    expect(discoveredWords).toEqual(["银行"]);
  });
});

describe("numbers", () => {
  it("clamps junk to something a caller can safely act on", async () => {
    const result = await turn("junk_numbers");

    // save_attempts gates saveFailed, so a negative number must not survive.
    expect(result.saveAttempts).toBe(0);
    expect(result.stoppedBy).toBe("answered");
    expect(result.usage.modelCalls).toBe(3); // "3" — quota is billed per call
    expect(result.usage.inputTokens).toBe(0);
  });
});
