import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import * as registry from "../src/tools/registry.js";
import {
  createUserWithSession,
  createFlashcardDeck,
  createChallengeDeck,
  requestJson,
} from "./helpers";

const owner = () =>
  createUserWithSession({ email: "owner@example.com", username: "owner" });

describe("tool definitions", () => {
  it("every tool has a name, description and object schema", () => {
    expect(registry.all().length).toBeGreaterThan(0);
    for (const tool of registry.all()) {
      expect(typeof tool.name, tool.name).toBe("string");
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(Array.isArray(tool.inputSchema.required), tool.name).toBe(true);
      expect(typeof tool.execute, tool.name).toBe("function");
    }
  });

  it("has unique names", () => {
    const names = registry.names();
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares every required property in its schema", () => {
    for (const tool of registry.all()) {
      for (const key of tool.inputSchema.required) {
        expect(tool.inputSchema.properties[key], `${tool.name}.${key}`).toBeDefined();
      }
    }
  });
});

describe("registry.execute", () => {
  it("runs a read tool", async () => {
    const { user, token } = await owner();
    await createFlashcardDeck(token, { title: "Kanji" });

    const out = await registry.execute(
      "list_flashcard_decks",
      env,
      { user },
      {},
    );
    expect(out.ok).toBe(true);
    expect(out.result[0].title).toBe("Kanji");
  });

  it("runs a write tool with the caller's identity", async () => {
    const { user, token } = await owner();
    const deckId = await createFlashcardDeck(token);

    const out = await registry.execute("add_flashcard", env, { user }, {
      deckId,
      front: "水",
      meaning: "water",
    });
    expect(out.ok).toBe(true);
    expect(typeof out.result.id).toBe("number");

    // Visible through the HTTP API too — one code path, two entry points.
    const { data } = await requestJson(`/api/flashcard-decks/${deckId}`, { token });
    expect(data.cards).toHaveLength(1);
    expect(data.cards[0].front).toBe("水");
  });

  it("enforces the same ownership rules as the HTTP route", async () => {
    const { token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const { user: stranger } = await createUserWithSession({
      email: "other@example.com",
      username: "other",
    });

    const out = await registry.execute(
      "add_flashcard",
      env,
      { user: stranger },
      { deckId, front: "f", meaning: "m" },
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.error).toBe("Not your deck");
  });

  it("enforces the same deck limit as the HTTP route", async () => {
    const { user, token } = await owner();
    const deckId = await createFlashcardDeck(token);
    const limit = parseInt(env.MAX_CARDS_PER_DECK, 10);
    for (let i = 0; i < limit; i++) {
      await env.DB.prepare(
        "INSERT INTO flashcards (deck_id, front, meaning) VALUES (?, ?, ?)",
      )
        .bind(deckId, `f${i}`, `m${i}`)
        .run();
    }

    const out = await registry.execute("add_flashcard", env, { user }, {
      deckId,
      front: "one",
      meaning: "too many",
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain(`${limit}-card limit`);
  });

  it("returns domain failures as data rather than throwing", async () => {
    const { user, token } = await owner();
    const deckId = await createChallengeDeck(token);

    // Only two questions — publishing needs three.
    for (let i = 0; i < 2; i++) {
      await registry.execute("add_challenge_card", env, { user }, {
        deckId,
        question: `q${i}`,
        choices: ["a", "b", "c", "d"],
        answer: 0,
      });
    }

    const out = await registry.execute(
      "publish_challenge",
      env,
      { user },
      { deckId },
    );
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
    expect(out.error).toBe("Need at least 3 cards to publish");
  });

  it("reports an unknown tool without throwing", async () => {
    const out = await registry.execute("no_such_tool", env, {}, {});
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Unknown tool");
  });
});

describe("provider adapters", () => {
  it("emits OpenAI function-tool shape", () => {
    const tools = registry.toOpenAI();
    expect(tools).toHaveLength(registry.all().length);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(typeof t.function.name).toBe("string");
      expect(t.function.parameters.type).toBe("object");
    }
  });

  it("emits Anthropic tool shape", () => {
    const tools = registry.toAnthropic();
    expect(tools).toHaveLength(registry.all().length);
    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(t.input_schema.type).toBe("object");
    }
  });
});
