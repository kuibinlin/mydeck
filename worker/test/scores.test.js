import { describe, it, expect } from "vitest";
import {
  requestJson,
  createUserWithSession,
  createChallengeDeck,
  publishChallenge,
} from "./helpers";

const owner = () =>
  createUserWithSession({ email: "owner@example.com", username: "owner" });
const player = () =>
  createUserWithSession({ email: "player@example.com", username: "player" });

async function publishedDeck() {
  const { token } = await owner();
  const deckId = await createChallengeDeck(token);
  const { versionId, cardCount } = await publishChallenge(token, deckId, 3);
  return { ownerToken: token, deckId, versionId, cardCount };
}

const postScore = (token, body) =>
  requestJson("/api/scores", { method: "POST", token, body });

describe("POST /api/scores", () => {
  it("401s without a session", async () => {
    const { versionId, cardCount } = await publishedDeck();
    const { status } = await requestJson("/api/scores", {
      method: "POST",
      body: { challenge_version_id: versionId, score: 1, total: cardCount },
    });
    expect(status).toBe(401);
  });

  it("requires version, score and total", async () => {
    const { token } = await player();
    const { status, data } = await postScore(token, { score: 1 });
    expect(status).toBe(400);
    expect(data.error).toContain("required");
  });

  it("404s for an unknown version", async () => {
    const { token } = await player();
    const { status, data } = await postScore(token, {
      challenge_version_id: 9999,
      score: 1,
      total: 3,
    });
    expect(status).toBe(404);
    expect(data.error).toBe("Version not found");
  });

  it("rejects a score above the total", async () => {
    const { versionId, cardCount } = await publishedDeck();
    const { token } = await player();
    const { status, data } = await postScore(token, {
      challenge_version_id: versionId,
      score: cardCount + 1,
      total: cardCount,
    });
    expect(status).toBe(400);
    expect(data.error).toBe("Invalid score");
  });

  it("rejects a total that does not match the published card count", async () => {
    const { versionId } = await publishedDeck();
    const { token } = await player();
    const { status, data } = await postScore(token, {
      challenge_version_id: versionId,
      score: 1,
      total: 99,
    });
    expect(status).toBe(400);
    expect(data.error).toBe("Invalid total");
  });

  it("records a valid score", async () => {
    const { versionId, cardCount } = await publishedDeck();
    const { token } = await player();
    const { status, data } = await postScore(token, {
      challenge_version_id: versionId,
      score: 2,
      total: cardCount,
    });
    expect(status).toBe(201);
    expect(data.ok).toBe(true);
  });

  it("keeps the best score and ignores a worse resubmission", async () => {
    const { versionId, cardCount } = await publishedDeck();
    const { token } = await player();

    await postScore(token, {
      challenge_version_id: versionId,
      score: 3,
      total: cardCount,
    });
    await postScore(token, {
      challenge_version_id: versionId,
      score: 1,
      total: cardCount,
    });

    const { data } = await requestJson(`/api/leaderboard/${versionId}`);
    expect(data.scores).toHaveLength(1);
    expect(data.scores[0].score).toBe(3);
  });

  it("upgrades to a better score", async () => {
    const { versionId, cardCount } = await publishedDeck();
    const { token } = await player();

    await postScore(token, {
      challenge_version_id: versionId,
      score: 1,
      total: cardCount,
    });
    await postScore(token, {
      challenge_version_id: versionId,
      score: 3,
      total: cardCount,
    });

    const { data } = await requestJson(`/api/leaderboard/${versionId}`);
    expect(data.scores[0].score).toBe(3);
  });
});

describe("GET /api/leaderboard/:versionId", () => {
  it("is public and returns the version plus ranked scores", async () => {
    const { versionId, cardCount } = await publishedDeck();
    const { token: p1 } = await player();
    const { token: p2 } = await createUserWithSession({
      email: "p2@example.com",
      username: "second",
    });

    await postScore(p1, {
      challenge_version_id: versionId,
      score: 1,
      total: cardCount,
    });
    await postScore(p2, {
      challenge_version_id: versionId,
      score: 3,
      total: cardCount,
    });

    const { status, data } = await requestJson(`/api/leaderboard/${versionId}`);
    expect(status).toBe(200);
    expect(data.version.deck_title).toBe("Quiz");
    expect(data.scores.map((s) => s.username)).toEqual(["second", "player"]);
    expect(data.scores[0].percentage).toBe(100);
  });
});

describe("GET /api/leaderboard-summary", () => {
  it("omits decks that have no scores", async () => {
    await publishedDeck();
    const { status, data } = await requestJson("/api/leaderboard-summary");
    expect(status).toBe(200);
    expect(data.summary).toEqual([]);
  });

  it("returns the top three players per deck", async () => {
    const { versionId, cardCount } = await publishedDeck();

    for (const [name, score] of [
      ["alpha", 3],
      ["bravo", 2],
      ["charlie", 1],
      ["delta", 0],
    ]) {
      const { token } = await createUserWithSession({
        email: `${name}@example.com`,
        username: name,
      });
      await postScore(token, {
        challenge_version_id: versionId,
        score,
        total: cardCount,
      });
    }

    const { data } = await requestJson("/api/leaderboard-summary");
    expect(data.summary).toHaveLength(1);
    expect(data.summary[0].top3.map((t) => t.username)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
    expect(data.summary[0].version).toBe(1);
    expect(data.summary[0].card_count).toBe(cardCount);
  });
});
