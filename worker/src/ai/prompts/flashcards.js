// Flashcard generation prompt.
//
// Prompts live as functions rather than inline template literals so they can be
// composed, reused across features, and tuned without editing a route handler.

const DEFAULT_FRONT = "a word or phrase from the article";
const DEFAULT_MEANING = "a clear definition or explanation";
const DEFAULT_NOTE = "an example sentence using the word";

export function flashcardsFromArticle({
  article,
  count,
  frontHint,
  meaningHint,
  noteHint,
}) {
  const frontDesc = frontHint || DEFAULT_FRONT;
  const meaningDesc = meaningHint || DEFAULT_MEANING;
  const noteDesc = noteHint || DEFAULT_NOTE;

  return [
    {
      role: "system",
      content: `You are a flashcard generator. Create vocabulary flashcards from the given text.
You MUST respond with ONLY a valid JSON array. No explanation, no markdown, no code fences.
Each object must have exactly these 3 keys: "front", "meaning", "note".
- "front": ${frontDesc}
- "meaning": ${meaningDesc}
- "note": ${noteDesc}

Example output for 2 cards:
[{"front":"ephemeral","meaning":"lasting for a very short time","note":"The ephemeral beauty of cherry blossoms."},{"front":"ubiquitous","meaning":"present everywhere","note":"Smartphones are ubiquitous in modern life."}]`,
    },
    {
      role: "user",
      content: `Generate exactly ${count} flashcards from this article. Respond with ONLY a JSON array:\n\n${article}`,
    },
  ];
}
