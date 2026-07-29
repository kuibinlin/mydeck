// Multiple-choice question generation prompts.
//
// The three variants share an output contract, so it lives in one place: change
// the shape once and every generator follows.

const MCQ_CONTRACT = `You MUST respond with ONLY a valid JSON array. No explanation, no markdown, no code fences.
Each object must have exactly these 3 keys: "question", "choices" (array of exactly 4 strings), "answer" (integer 0-3).`;

const VOCAB_EXAMPLE = `Example output for 1 question:
[{"question":"What does 'ephemeral' mean?","choices":["Lasting forever","Lasting a very short time","Very large","Extremely rare"],"answer":1}]`;

const COMPREHENSION_EXAMPLE = `Example output for 1 question:
[{"question":"What is the main idea of the passage?","choices":["Option A","Option B","Option C","Option D"],"answer":2}]`;

// Renders the optional free-text steer the user typed in the AI panel.
const hintLine = (hint) =>
  hint ? `Additional instruction from user: ${hint}\n` : "";

export function vocabFromCards({ cards, count, hint }) {
  return [
    {
      role: "system",
      content: `You are a vocabulary quiz generator. Create multiple-choice questions from the given flashcards.
Auto-detect which language is being learned (the "front" side) and generate questions accordingly.
${hintLine(hint)}${MCQ_CONTRACT}

${VOCAB_EXAMPLE}`,
    },
    {
      role: "user",
      content: `Generate exactly ${count} vocabulary quiz questions from these flashcards. Respond with ONLY a JSON array:\n\n${JSON.stringify(cards)}`,
    },
  ];
}

export function vocabFromArticle({ article, count, hint }) {
  return [
    {
      role: "system",
      content: `You are a vocabulary quiz generator. Extract key vocabulary from the article and create multiple-choice questions.
${hintLine(hint)}${MCQ_CONTRACT}

${VOCAB_EXAMPLE}`,
    },
    {
      role: "user",
      content: `Generate exactly ${count} vocabulary quiz questions from this article. Respond with ONLY a JSON array:\n\n${article}`,
    },
  ];
}

export function comprehensionFromArticle({ article, count, hint }) {
  return [
    {
      role: "system",
      content: `You are a reading comprehension quiz generator. Create questions about meaning, main idea, inference, and details from the given article.
${hintLine(hint)}${MCQ_CONTRACT}

${COMPREHENSION_EXAMPLE}`,
    },
    {
      role: "user",
      content: `Generate exactly ${count} comprehension questions from this article. Respond with ONLY a JSON array:\n\n${article}`,
    },
  ];
}
