import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  deckTable,
  requireDeckOwner,
  DECK_KIND,
} from "../src/services/access.js";
import {
  requestJson,
  createUserWithSession,
  createFlashcardDeck,
  createChallengeDeck,
  ADMIN_EMAIL,
} from "./helpers";

describe("deckTable", () => {
  it("resolves the two ownable deck kinds", () => {
    expect(deckTable(DECK_KIND.FLASHCARD)).toBe("flashcard_decks");
    expect(deckTable(DECK_KIND.CHALLENGE)).toBe("challenge_decks");
  });

  it("refuses an arbitrary table name", () => {
    // deck_links has both `id` and `created_by`, so before this guard it would
    // have produced a plausible-looking but meaningless ownership decision.
    expect(() => deckTable("deck_links")).toThrow(/Unknown deck kind/);
    expect(() => deckTable("users")).toThrow(/Unknown deck kind/);
    expect(() => deckTable("flashcard_decks")).toThrow(/Unknown deck kind/);
  });

  it("refuses prototype-chain keys", () => {
    // An object-literal allowlist would resolve these to truthy values and
    // interpolate a function into the SQL. A Map has no prototype chain.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(() => deckTable(key), key).toThrow(/Unknown deck kind/);
    }
  });

  it("refuses a SQL fragment", () => {
    expect(() =>
      deckTable("flashcard_decks; DROP TABLE users; --"),
    ).toThrow(/Unknown deck kind/);
  });

  it("refuses missing or non-string kinds", () => {
    for (const bad of [undefined, null, "", 0, {}, []]) {
      expect(() => deckTable(bad)).toThrow(/Unknown deck kind/);
    }
  });
});

describe("requireDeckOwner", () => {
  it("throws a status-free error for an unknown kind, so it surfaces as a 500", async () => {
    const { user } = await createUserWithSession({
      email: "o@example.com",
      username: "o",
    });
    const err = await requireDeckOwner(env, "deck_links", 1, user).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Unknown deck kind/);
    // No `status` means errorResponse() logs it and returns 500 rather than
    // dressing a programming bug up as a client error.
    expect(err.status).toBeUndefined();
  });

  it("404s a missing deck before consulting ownership", async () => {
    const { user } = await createUserWithSession({
      email: "o@example.com",
      username: "o",
    });
    await expect(
      requireDeckOwner(env, DECK_KIND.FLASHCARD, 9999, user),
    ).rejects.toMatchObject({ status: 404, message: "Deck not found" });
  });
});

// The admin bypass used to return before the deck was looked up, so writes to a
// deck that does not exist quietly reported success.
describe("admin operations on a missing deck", () => {
  const admin = () =>
    createUserWithSession({ email: ADMIN_EMAIL, username: "boss" });

  it("404s PUT on a missing flashcard deck", async () => {
    const { token } = await admin();
    const { status, data } = await requestJson("/api/flashcard-decks/9999", {
      method: "PUT",
      token,
      body: { title: "ghost" },
    });
    expect(status).toBe(404);
    expect(data.error).toBe("Deck not found");
  });

  it("404s DELETE on a missing flashcard deck", async () => {
    const { token } = await admin();
    const { status } = await requestJson("/api/flashcard-decks/9999", {
      method: "DELETE",
      token,
    });
    expect(status).toBe(404);
  });

  it("404s adding a card to a missing deck instead of failing as a 500", async () => {
    const { token } = await admin();
    const { status, data } = await requestJson(
      "/api/flashcard-decks/9999/cards",
      { method: "POST", token, body: { front: "f", meaning: "m" } },
    );
    expect(status).toBe(404);
    expect(data.error).toBe("Deck not found");
  });

  it("404s publishing a missing challenge deck", async () => {
    const { token } = await admin();
    const { status } = await requestJson(
      "/api/challenge-decks/9999/publish",
      { method: "POST", token },
    );
    expect(status).toBe(404);
  });

  it("still lets an admin act on a deck that does exist", async () => {
    const { token: ownerToken } = await createUserWithSession({
      email: "owner@example.com",
      username: "owner",
    });
    const fcId = await createFlashcardDeck(ownerToken);
    const chId = await createChallengeDeck(ownerToken);
    const { token: adminToken } = await admin();

    const put = await requestJson(`/api/flashcard-decks/${fcId}`, {
      method: "PUT",
      token: adminToken,
      body: { title: "Moderated" },
    });
    expect(put.status).toBe(200);

    const addCard = await requestJson(`/api/challenge-decks/${chId}/cards`, {
      method: "POST",
      token: adminToken,
      body: { question: "q", choices: ["a", "b", "c", "d"], answer: 0 },
    });
    expect(addCard.status).toBe(201);
  });
});
