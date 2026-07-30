// What the tab remembers, and what it is willing to say about it.
//
// The transcript is React state and nothing else, so continuing a conversation
// means sending part of it back. This builds that payload: pairs of what was
// asked and what came back, plus the words the dictionary resolved along the
// way.
//
// The words are the load-bearing half. The tutor fills `save_words_to_deck`
// from the words the current message resolved — the model cannot be trusted to
// retype Chinese — so without them "save that" is a request the server has no
// characters for, and history alone would turn an incoherent ask into a
// coherent one that reliably fails.
//
// Only server-produced text goes in. Card words and activity items came from
// the dictionary; nothing here is transcribed from a reply.
//
// The caps mirror worker/src/services/zh/conversation.js, which is authoritative
// and re-applies all of them. history.test.js pins the two together.

const MAX_PAIRS = 6;
const MAX_WORDS = 12;

/**
 * @param {{question: string|null, result: object|null, error: string|null}[]} turns
 * @returns {{turns: {q: string, a: string}[], words: string[]}}
 */
export function buildContext(turns) {
  const pairs = [];
  const words = [];

  for (const turn of turns ?? []) {
    const agent = turn.result?.agent;

    // Words survive a turn the model failed on — the lookup still happened, and
    // they are what a later "save that" needs.
    for (const card of turn.result?.cards ?? []) if (card.found && card.word) words.push(card.word);
    for (const activity of agent?.activities ?? [])
      for (const item of activity.items ?? []) if (item.word) words.push(item.word);

    // An exchange needs both halves. A failed turn, one the tutor could not
    // answer, or an empty reply replayed as context is an invitation to answer
    // it again.
    if (turn.error || !agent || agent.unavailable) continue;
    const q = turn.question ?? turn.result?.prompt;
    if (!q || !agent.text) continue;
    pairs.push({ q, a: agent.text });
  }

  return {
    turns: pairs.slice(-MAX_PAIRS),
    words: [...new Set(words)].slice(-MAX_WORDS),
  };
}
