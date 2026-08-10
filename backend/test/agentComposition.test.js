// The composition layer: what the Worker does with what the service sends back.
//
// This is the layer the whole extraction rests on. agentService.test.js proves
// the Worker will not believe a malformed response; this file proves it will not
// act on a well-formed one that asks for something the learner never authorised.
//
// Driven through `respond` rather than the route, because `respond` is where
// policy lives and it has two callers — a typed message and a finished
// activity. Anything asserted at the route would leave the other one behind.
//
// The remote service is stubbed in vitest.config.mjs and selected by the LAST
// WORD of the message, which is why the messages below read the way they do.
// A scenario name must never contain a save verb: `\bsave` matches inside
// `saveref`, which silently arms the write tool the refusal tests exist to
// check. That is why they read `putref` rather than `saveref`.

import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { respond, TUTOR } from "../src/services/tutor.js";
import { createDeck } from "../src/services/flashcards.js";
import { createUser, createUserWithSession, BASE } from "./helpers.js";

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

const decksOf = (user) =>
  env.DB.prepare("SELECT id FROM flashcard_decks WHERE created_by = ? ORDER BY id")
    .bind(String(user.id))
    .all()
    .then((r) => r.results.map((d) => d.id));

const cardsIn = (deckId) =>
  env.DB.prepare("SELECT front, meaning FROM flashcards WHERE deck_id = ? AND is_deleted = 0")
    .bind(deckId)
    .all()
    .then((r) => r.results);

let user;

beforeEach(async () => {
  user = await createUser();
});

// There are no flags left to set. AGENT_ENABLED, AGENT_SHADOW and
// AGENT_ALLOWED_USERS existed to choose between two implementations, and §11
// step 9 left one — the only question now is whether the service is reachable,
// which AGENT_SERVICE_URL answers. wrangler.test.toml points it at
// agent.test.invalid, answered by scenario in vitest.config.mjs.
const agent = () => ({ ...env });

describe("the remote path", () => {
  it("answers from the service", async () => {
    // This used to also spy on ai/callModel and assert it was never called.
    // That assertion could not fail after step 9: the tutor path no longer
    // imports callModel at all, so the spy was watching a door that had been
    // bricked up. safety.test.js is what keeps the suite off a real model.
    const out = await respond(agent(), {
      user,
      message: "what is 医院 ok",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(out.text).toContain("hospital");
    expect(out.stoppedBy).toBe("answered");
  });

  it("bills one usage row per model call the service reports", async () => {
    // Quota counts model calls, not requests. Driven with a scenario reporting
    // FOUR calls, because the default reports one — and against one row, "per
    // call" and "per request" are the same number, so the assertion that used
    // to live here could not fail.
    await respond(agent(), { user, message: "ok billing", seed: [] });
    expect(await usageRows(user)).toBe(4);
  });

  it("stops billing at the cap when the service reports an absurd count", async () => {
    // model_calls is the only response field anything loops on, and each turn
    // of that loop is an awaited D1 write inside a request Workers kills at
    // 30s. Clamped rather than refused: the payload still holds the learner's
    // reply, and spending the reply to protect the quota is the wrong way
    // round.
    await respond(agent(), { user, message: "ok overbilled", seed: [] });
    expect(await usageRows(user)).toBe(12);
  });

  it("sends the seeded and carried words in order, with provenance", async () => {
    const out = await respond(agent(), {
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

  it("drops a carried word the dictionary does not know", async () => {
    // The client says WHICH words came up; the dictionary says what they are.
    // A carried word that does not resolve is not carried — there is nothing
    // useful to do with characters we cannot read, and passing them on would
    // hand the model a word it could then retype badly.
    const out = await respond(agent(), {
      user,
      message: "echo",
      seed: [card("医院", "yīyuàn", "hospital")],
      context: { turns: [{ q: "?", a: "?" }], words: ["书", "zzzz"] },
    });

    const sent = JSON.parse(out.text);
    expect(sent.known_words.map((w) => w.simplified)).toEqual(["医院", "书"]);
  });

  it("offers the save tool only when the learner asked to save", async () => {
    const plain = JSON.parse(
      (await respond(agent(), { user, message: "echo", seed: [] })).text,
    );
    expect(plain.allowed_tools).not.toContain("save_words_to_deck");

    const asked = JSON.parse(
      (await respond(agent(), { user, message: "save this echo", seed: [] })).text,
    );
    expect(asked.allowed_tools).toContain("save_words_to_deck");
  });

  it("offers only the learner's own decks", async () => {
    const other = await createUser({ email: "other@example.com", username: "other" });
    await createDeck(env, { user, title: "Mine", category: "Language" });
    await createDeck(env, { user: other, title: "Theirs", category: "Language" });

    const sent = JSON.parse((await respond(agent(), { user, message: "echo", seed: [] })).text);
    expect(sent.decks.map((d) => d.name)).toEqual(["Mine"]);
  });
});

describe("materialising a save", () => {
  it("writes real cards for a referenced word", async () => {
    const out = await respond(agent(), {
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
    const out = await respond(agent(), {
      user,
      message: "please save putpool",
      seed: [card("医院", "yīyuàn", "hospital"), card("书", "shū", "book")],
    });

    expect(out.saves[0].added.map((a) => a.word)).toEqual(["医院", "书"]);
  });

  it("saves into a deck the learner named", async () => {
    const out = await respond(agent(), {
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
    const out = await respond(agent(), {
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
    const out = await respond(agent(), {
      user,
      message: "what is 医院 putref",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(out.saves).toEqual([]);
    expect(out.saveFailed).toBe(true);
    expect(await cardsIn(1)).toEqual([]);
  });

  it("reports saveFailed when the service claims a save it never asked for", async () => {
    const out = await respond(agent(), {
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
    const out = await respond(agent(), {
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
    const out = await respond(agent(), {
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
  // These four are the reason the Worker still exists between the learner and
  // the agent. The service is on public ingress and its answer is a PROPOSAL —
  // well-formed by the time integrations/agentService.js is done with it, and
  // still not permitted.
  //
  // §11 step 9 changed what a refusal COSTS, not what is refused. There is no
  // JavaScript loop to fall back to, so an unauthorised action degrades the
  // whole turn to the cards. Refusing loudly is the point: the alternative is
  // performing a write nobody asked for.
  // Two layers refuse, with different messages, and both are correct here:
  // integrations/agentService.js rejects an unknown action TYPE as a contract
  // violation before tutor.js ever sees it, while tutor.js rejects a known type
  // carrying an unauthorised argument. The test asserts the turn is refused, not
  // which layer caught it.
  const refused = (message, seed = [card("医院", "yīyuàn", "hospital")]) =>
    expect(respond(agent(), { user, message, seed })).rejects.toThrow(
      /invalid action|unknown agent action/i,
    );

  it("rejects a word reference outside the list we sent", async () => {
    await refused("please save outofrange");
    expect(await cardsIn(1)).toEqual([]);
  });

  it("rejects a reference to a word we could not resolve", async () => {
    // index 1 is a miss, so it is sent with found:false and cannot be named.
    await refused("please save unfound", [
      card("医院", "yīyuàn", "hospital"),
      { word: "zzz", found: false },
    ]);
  });

  it("rejects a deck id that was never offered", async () => {
    await refused("please save baddeck");
    expect(await cardsIn(9999)).toEqual([]);
  });

  it("rejects an unknown action type", async () => {
    await refused("unknown_action");
  });

  it("writes nothing when a later action in the same response is invalid", async () => {
    // The refusal has to land before the first action writes. When these
    // checks ran inside the execution loop, a valid save followed by an
    // invalid one left a deck in the learner's account and then threw — and
    // routes/zh.js catches that and answers with the cards, so nothing on
    // screen ever mentioned the deck that had just been created.
    const before = await decksOf(user);
    await refused("please save goodthenbad");
    expect(await decksOf(user)).toEqual(before);
  });
});

describe("failure policy", () => {
  // §11 step 9 changed this. Before, only a timeout degraded to the cards —
  // a malformed response or a service error fell through to the JavaScript loop
  // and the learner never knew. There is no second loop now, so every failure
  // costs the prose and routes/zh.js renders the word cards alone.
  //
  // That floor is still a complete answer: the cards come from the deterministic
  // lookup, which never needed a model.

  it("degrades to the cards on a malformed response", async () => {
    await expect(
      respond(agent(), { user, message: "not_json", seed: [] }),
    ).rejects.toThrow();
  });

  it("degrades to the cards on a service error", async () => {
    await expect(
      respond(agent(), { user, message: "server_error", seed: [] }),
    ).rejects.toThrow();
  });

  it("degrades to the cards on a timeout", async () => {
    await expect(
      respond({ ...agent(), AGENT_SERVICE_TIMEOUT_MS: "50" }, {
        user,
        message: "slow",
        seed: [],
      }),
    ).rejects.toThrow(/did not answer/i);
  });

  it("refuses to answer at all when no service is configured", async () => {
    // This replaced AGENT_ENABLED / AGENT_SHADOW / AGENT_ALLOWED_USERS. With one
    // implementation there is nothing left to choose between — only whether it
    // is reachable.
    await expect(
      respond({ ...agent(), AGENT_SERVICE_URL: "" }, { user, message: "ok", seed: [] }),
    ).rejects.toThrow();
  });
});

describe("both entry points", () => {
  it("routes an activity result through the same selection", async () => {
    // http/routes/zh.js has two callers of respond — a typed message and a
    // finished activity. Everything policy decides lives inside respond
    // precisely so the second one cannot be left behind: the bounding, the
    // allowlist, the seeding and the reachability check all reach both.
    const out = await respond(agent(), {
      user,
      message: "The learner just finished a quick check: 3 of 4 correct ok",
      seed: [],
    });

    expect(out.text).toContain("hospital");
  });

  // Named for what it proves now. It used to assert that `ctx` reached the
  // route, which was shadow mode's only requirement and went with it in step 9.
  // What is still worth pinning is that the activity path works end to end
  // through HTTP, not only through respond().
  it("serves a finished activity end to end through the route", async () => {
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

describe("a save that was claimed but never attempted", () => {
  // Measured on the first real agent run: asked to save with the tool withheld,
  // the model replied "I've saved 医院 to your private draft deck" having called
  // nothing. saveAttempts was 0, so nothing in the app contradicted it.
  //
  // The JavaScript path had this bug too. That path is gone (§11 step 9), but
  // the model has not changed and neither has its habit of narrating a write it
  // never performed — so saveFailed is the only thing in the app that can
  // contradict it.

  it("recognises a completed claim, not an offer", () => {
    const { claimsSave } = TUTOR;

    // Reports — the thing the prompt tells it not to do without calling.
    expect(claimsSave("I've saved 医院 to your private draft deck.")).toBe(true);
    expect(claimsSave("Added them to your Hospital words deck.")).toBe(true);
    expect(claimsSave("Those are now stored in your flashcard deck.")).toBe(true);
    expect(claimsSave("已保存到你的卡片集。")).toBe(true);

    // Offers — the correct answer when it cannot save, and must not trip it.
    expect(claimsSave("I can save 医院 to a deck for you.")).toBe(false);
    expect(claimsSave("Would you like me to add these to a deck?")).toBe(false);
    expect(claimsSave("Shall I put them in a deck?")).toBe(false);
    expect(claimsSave("Ask me to save it and I will.")).toBe(false);

    // Terse claims that never name a deck. "Done! I've saved it." is
    // plausible output and slipped through the deck-noun pattern alone.
    expect(claimsSave("Done! I've saved it.")).toBe(true);
    expect(claimsSave("Added them for you.")).toBe(true);
    expect(claimsSave("I can save it if you like.")).toBe(false);

    // A trailing offer does not excuse a claim in the sentence before it.
    expect(claimsSave("I've added them to your deck. Shall I save more?")).toBe(true);

    // Ordinary tutoring prose.
    expect(claimsSave("医院 is the everyday word for a hospital.")).toBe(false);
    expect(claimsSave("")).toBe(false);
  });

  it("contradicts a remote reply that claims a save it never made", async () => {
    const out = await respond(agent(), {
      user,
      message: "boast",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(out.saves).toEqual([]);
    expect(out.saveFailed).toBe(true);
    expect(await cardsIn(1)).toEqual([]);
  });



  it("stays quiet when the model correctly offers instead of claiming", async () => {
    const out = await respond(agent(), { user, message: "offer", seed: [] });
    expect(out.saveFailed).toBe(false);
  });

  it("stays quiet on an ordinary turn", async () => {
    const out = await respond(agent(), { user, message: "ok", seed: [] });
    expect(out.saveFailed).toBe(false);
  });

  it("never fires when a save actually landed", async () => {
    // The guard is ordered so the flag can only appear when nothing was saved.
    const out = await respond(agent(), {
      user,
      message: "please save putref",
      seed: [card("医院", "yīyuàn", "hospital")],
    });

    expect(out.saves).toHaveLength(1);
    expect(out.saveFailed).toBe(false);
  });
});
