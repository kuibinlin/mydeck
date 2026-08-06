// The composition layer: which implementation answers, and what the Worker does
// with what comes back.
//
// This is the layer the whole extraction rests on. agentService.test.js proves
// the Worker will not believe a malformed response; this file proves it will not
// act on a well-formed one that asks for something the learner never authorised,
// and that the JavaScript tutor stays in charge until it is deliberately not.
//
// Driven through `respond` rather than the route, because the flags live in
// `env` and a route test cannot vary them — SELF.fetch uses the worker's own
// bindings. The one thing only the route can prove, that `ctx` still reaches
// it, is asserted at the bottom.
//
// The remote service is stubbed in vitest.config.mjs and selected by the LAST
// WORD of the message, which is why the messages below read the way they do.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { respond, TUTOR } from "../src/services/tutor.js";
import { createDeck } from "../src/services/flashcards.js";
import * as callModelModule from "../src/ai/callModel.js";
import { createUser, createUserWithSession, BASE } from "./helpers.js";

const turn = (text, toolCalls = []) => ({
  text,
  toolCalls,
  stopReason: toolCalls.length ? "tool_calls" : "stop",
  usage: null,
  raw: {},
});

function scriptModel(turns) {
  let i = 0;
  return vi.spyOn(callModelModule, "callModel").mockImplementation(async () => {
    const t = turns[Math.min(i, turns.length - 1)];
    i++;
    return t;
  });
}

const card = (word, pinyin, meaning, level = 1) => ({
  word,
  pinyin,
  meaning,
  level,
  found: true,
  source: "bundle",
});

const usageRows = (user) =>
  env.DB.prepare("SELECT COUNT(*) as n FROM ai_usage_log WHERE user_id = ?")
    .bind(String(user.id))
    .first()
    .then((r) => r.n);

const cardsIn = (deckId) =>
  env.DB.prepare("SELECT front, meaning FROM flashcards WHERE deck_id = ? AND is_deleted = 0")
    .bind(deckId)
    .all()
    .then((r) => r.results);

let spy;
let user;

beforeEach(async () => {
  vi.restoreAllMocks();
  user = await createUser();
});
afterEach(() => spy?.mockRestore());

// Flags, per test. The defaults in wrangler.test.toml are all off.
const remote = (u = user) => ({
  ...env,
  AGENT_ENABLED: "true",
  AGENT_ALLOWED_USERS: u.email,
});

const shadowed = (u = user) => ({
  ...env,
  AGENT_SHADOW: "true",
  AGENT_ALLOWED_USERS: u.email,
});

describe("which implementation answers", () => {
  it("uses JavaScript when every flag is off", () => {
    expect(TUTOR.agentMode(env, user)).toBe("local");
  });

  it("uses JavaScript for a user who is not on the allowlist", () => {
    const e = { ...env, AGENT_ENABLED: "true", AGENT_ALLOWED_USERS: "someone@else.com" };
    expect(TUTOR.agentMode(e, user)).toBe("local");
  });

  it("treats an empty allowlist as nobody, not everybody", () => {
    const e = { ...env, AGENT_ENABLED: "true", AGENT_ALLOWED_USERS: "" };
    expect(TUTOR.agentMode(e, user)).toBe("local");
  });

  it("matches the allowlist on email, case-insensitively, ignoring spacing", () => {
    const e = {
      ...env,
      AGENT_ENABLED: "true",
      AGENT_ALLOWED_USERS: ` other@x.com , ${user.email.toUpperCase()} `,
    };
    expect(TUTOR.agentMode(e, user)).toBe("remote");
  });

  it("prefers the remote path over shadowing when both are on", () => {
    // The one combination with no value: two turns of model budget spent to
    // compare a result against the thing it already replaced.
    const e = {
      ...env,
      AGENT_ENABLED: "true",
      AGENT_SHADOW: "true",
      AGENT_ALLOWED_USERS: user.email,
    };
    expect(TUTOR.agentMode(e, user)).toBe("remote");
  });

  it("stays local when the service has no URL, whatever the flags say", () => {
    const e = { ...env, AGENT_SERVICE_URL: "", AGENT_ENABLED: "true", AGENT_ALLOWED_USERS: user.email };
    expect(TUTOR.agentMode(e, user)).toBe("local");
  });
});

describe("the local path is untouched", () => {
  it("still runs the scripted model and never calls the service", async () => {
    spy = scriptModel([turn("医院 is a hospital.")]);

    const out = await respond(env, {
      user,
      message: "what is 医院",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(spy).toHaveBeenCalled();
    expect(out.text).toBe("医院 is a hospital.");
    // New field, and false here on purpose: a failed activity comes back to the
    // model mid-run on this path, so it says so itself.
    expect(out.activityFailed).toBe(false);
  });
});

describe("the remote path", () => {
  it("answers from the service without touching the model", async () => {
    spy = scriptModel([turn("should never run")]);

    const out = await respond(remote(), {
      user,
      message: "what is 医院 ok",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(spy).not.toHaveBeenCalled();
    expect(out.text).toContain("hospital");
    expect(out.stoppedBy).toBe("answered");
  });

  it("bills one usage row per model call the service reports", async () => {
    // Quota counts model calls, not requests — the same accounting the local
    // path uses, sourced one process away.
    await respond(remote(), { user, message: "ok", seed: [] });
    expect(await usageRows(user)).toBe(1);
  });

  it("sends the seeded and carried words in order, with provenance", async () => {
    const out = await respond(remote(), {
      user,
      message: "echo",
      seed: [card("医院", "yīyuàn", "hospital")],
      context: { turns: [{ q: "what is 书", a: "a book" }], words: ["书"] },
    });

    const sent = JSON.parse(out.text);
    expect(sent.known_words.map((w) => [w.i, w.simplified, w.source])).toEqual([
      [0, "医院", "seed"],
      [1, "书", "prior"],
    ]);
    // Ordering is priority: deckSave keeps the first MAX_SAVE, so "save that"
    // has to mean the word just discussed.
    expect(sent.level).toBe(null);
  });

  it("offers the save tool only when the learner asked to save", async () => {
    const plain = JSON.parse(
      (await respond(remote(), { user, message: "echo", seed: [] })).text,
    );
    expect(plain.allowed_tools).not.toContain("save_words_to_deck");

    const asked = JSON.parse(
      (await respond(remote(), { user, message: "save this echo", seed: [] })).text,
    );
    expect(asked.allowed_tools).toContain("save_words_to_deck");
  });

  it("offers only the learner's own decks", async () => {
    const other = await createUser({ email: "other@example.com", username: "other" });
    await createDeck(env, { user, title: "Mine", category: "Language" });
    await createDeck(env, { user: other, title: "Theirs", category: "Language" });

    const sent = JSON.parse((await respond(remote(), { user, message: "echo", seed: [] })).text);
    expect(sent.decks.map((d) => d.name)).toEqual(["Mine"]);
  });
});

describe("materialising a save", () => {
  it("writes real cards for a referenced word", async () => {
    const out = await respond(remote(), {
      user,
      message: "please save putref",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(out.saves).toHaveLength(1);
    expect(out.saveFailed).toBe(false);
    expect(await cardsIn(out.saves[0].deckId)).toEqual([
      { front: "医院", meaning: "hospital" },
    ]);
  });

  it("falls back to the words on screen when the action names none", async () => {
    const out = await respond(remote(), {
      user,
      message: "please save putpool",
      seed: [card("医院", "yīyuàn", "hospital"), card("书", "shū", "book")],
    });

    expect(out.saves[0].added.map((a) => a.word)).toEqual(["医院", "书"]);
  });

  it("saves into a deck the learner named", async () => {
    const out = await respond(remote(), {
      user,
      message: "please save putnamed",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(out.saves[0].title).toBe("Hospital words");
  });

  it("carries a word the run discovered, re-resolved through the index", async () => {
    // 银行 never appeared in the request. It comes back as discovered_words and
    // is looked up locally — the service says which word, the dictionary says
    // what it means.
    const out = await respond(remote(), {
      user,
      message: "please save discovered",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    const saved = out.saves[0].added.map((a) => a.word);
    expect(saved).toContain("银行");
    expect(out.saves[0].added.find((a) => a.word === "银行").meaning).toBeTruthy();
  });

  it("refuses a save the learner never asked for, and still counts it", async () => {
    // The measured rule: saveFailed is gated on the attempt count, and counting
    // after the refusal made the signal unreachable in exactly this case.
    const out = await respond(remote(), {
      user,
      message: "what is 医院 putref",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(out.saves).toEqual([]);
    expect(out.saveFailed).toBe(true);
    expect(await cardsIn(1)).toEqual([]);
  });

  it("reports saveFailed when the service claims a save it never asked for", async () => {
    const out = await respond(remote(), {
      user,
      message: "please save claimed",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(out.saves).toEqual([]);
    expect(out.saveFailed).toBe(true);
  });
});

describe("materialising an activity", () => {
  it("builds one from a referenced word", async () => {
    const out = await respond(remote(), {
      user,
      message: "practise writing stroke",
      seed: [card("书", "shū", "book")],
    });

    expect(out.activities).toHaveLength(1);
    expect(out.activities[0].type).toBe("stroke");
    expect(out.activities[0].items.map((i) => i.word)).toEqual(["书"]);
    expect(out.activityFailed).toBe(false);
  });

  it("sets activityFailed instead of losing the whole turn", async () => {
    // A matching game with one word throws in services/activities.js. Letting
    // that out would cost the learner the tutor's reply over a failed game.
    const out = await respond(remote(), {
      user,
      message: "quiz me matchfail",
      seed: [card("书", "shū", "book")],
    });

    expect(out.activities).toEqual([]);
    expect(out.activityFailed).toBe(true);
    expect(out.text).toBeTruthy();
  });
});

describe("refusing a well-formed but unauthorised response", () => {
  const fallback = async (message) => {
    spy = scriptModel([turn("the local tutor answered instead")]);
    return respond(remote(), { user, message, seed: [card("医院", "yīyuàn", "hospital")] });
  };

  it("rejects a word reference outside the list we sent", async () => {
    const out = await fallback("please save outofrange");
    expect(out.text).toBe("the local tutor answered instead");
    expect(out.saves).toEqual([]);
  });

  it("rejects a reference to a word we could not resolve", async () => {
    spy = scriptModel([turn("the local tutor answered instead")]);
    const out = await respond(remote(), {
      user,
      message: "please save unfound",
      // index 1 is a miss, so it is sent with found:false and cannot be named.
      seed: [card("医院", "yīyuàn", "hospital"), { word: "zzz", found: false }],
    });
    expect(out.text).toBe("the local tutor answered instead");
    expect(out.saves).toEqual([]);
  });

  it("rejects a deck id that was never offered", async () => {
    const out = await fallback("please save baddeck");
    expect(out.text).toBe("the local tutor answered instead");
    expect(await cardsIn(9999)).toEqual([]);
  });

  it("rejects an unknown action type", async () => {
    const out = await fallback("unknown_action");
    expect(out.text).toBe("the local tutor answered instead");
  });
});

describe("failure policy", () => {
  it("falls back to JavaScript on a malformed response", async () => {
    spy = scriptModel([turn("local answer")]);
    const out = await respond(remote(), { user, message: "not_json", seed: [] });
    expect(out.text).toBe("local answer");
  });

  it("falls back to JavaScript on a service error", async () => {
    spy = scriptModel([turn("local answer")]);
    const out = await respond(remote(), { user, message: "server_error", seed: [] });
    expect(out.text).toBe("local answer");
  });

  it("does NOT fall back on a timeout — the request's time is already spent", async () => {
    // Rethrown so http/routes/zh.js degrades to the cards, which is a complete
    // answer. Running a second loop would make the learner wait twice for a
    // turn that was already too slow.
    spy = scriptModel([turn("local answer")]);

    await expect(
      respond({ ...remote(), AGENT_SERVICE_TIMEOUT_MS: "50" }, {
        user,
        message: "slow",
        seed: [],
      }),
    ).rejects.toThrow(/did not answer/i);

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("shadow mode", () => {
  it("returns the JavaScript answer and schedules the remote call", async () => {
    spy = scriptModel([turn("the local answer the learner sees")]);
    const scheduled = [];

    const out = await respond(shadowed(), {
      user,
      message: "ok",
      seed: [card("医院", "yīyuàn", "hospital")],
      waitUntil: (p) => scheduled.push(p),
    });

    expect(out.text).toBe("the local answer the learner sees");
    expect(scheduled).toHaveLength(1);
    await Promise.all(scheduled);
  });

  it("never materialises the remote actions", async () => {
    spy = scriptModel([turn("local")]);
    const scheduled = [];

    const out = await respond(shadowed(), {
      user,
      message: "please save putref",
      seed: [card("医院", "yīyuàn", "hospital")],
      waitUntil: (p) => scheduled.push(p),
    });
    await Promise.all(scheduled);

    // The scenario asked for a save. Shadow mode observes; it does not write.
    expect(out.saves).toEqual([]);
    expect(await cardsIn(1)).toEqual([]);
  });

  it("never writes a usage row for the shadowed call", async () => {
    // AI_DAILY_LIMIT_FREE counts model calls, so a shadow row would halve the
    // learner's real allowance to pay for an experiment they cannot see.
    spy = scriptModel([turn("local")]);
    const scheduled = [];

    await respond(shadowed(), {
      user,
      message: "ok",
      seed: [],
      waitUntil: (p) => scheduled.push(p),
    });
    await Promise.all(scheduled);

    // One, from the local loop's single model call. The remote reports one too.
    expect(await usageRows(user)).toBe(1);
  });

  it("survives a remote failure without touching the answer", async () => {
    spy = scriptModel([turn("local answer")]);
    const scheduled = [];

    const out = await respond(shadowed(), {
      user,
      message: "not_json",
      seed: [],
      waitUntil: (p) => scheduled.push(p),
    });
    await expect(Promise.all(scheduled)).resolves.toBeDefined();

    expect(out.text).toBe("local answer");
  });

  it("does nothing at all without a waitUntil", async () => {
    // A tool or a test calling respond has no context to schedule against, and
    // an observation must not run on the learner's request instead.
    spy = scriptModel([turn("local answer")]);

    const out = await respond(shadowed(), { user, message: "ok", seed: [] });
    expect(out.text).toBe("local answer");
    expect(await usageRows(user)).toBe(1);
  });
});

describe("both entry points", () => {
  it("routes an activity result through the same selection", async () => {
    // http/routes/zh.js has two callers of respond — a typed message and a
    // finished activity. The flag is read inside respond precisely so the
    // second one cannot be left behind on the old path.
    const out = await respond(remote(), {
      user,
      message: "The learner just finished a quick check: 3 of 4 correct ok",
      seed: [],
    });

    expect(out.text).toContain("hospital");
  });

  it("still serves the route with ctx threaded through", async () => {
    const { token } = await createUserWithSession({
      email: "ctx@example.com",
      username: "ctx",
    });

    const res = await SELF.fetch(`${BASE}/api/zh/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${token}` },
      body: JSON.stringify({
        activityResult: {
          activity: { type: "stroke", items: [{ word: "书" }] },
          total: 1,
          completed: 1,
        },
      }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe("activity_result");
  });
});
