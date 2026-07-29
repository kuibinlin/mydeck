// Tool calls and their results, in the shape each provider expects.
//
// The two families disagree about where a tool result lives — OpenAI gives it
// its own `tool` role keyed by tool_call_id, Anthropic nests it inside a user
// message as a content block. Getting this wrong does not error; the model just
// silently loses the result and asks for the same thing again, which reads as
// the model being stupid rather than the plumbing being wrong.
//
// Verified against @cf/meta/llama-3.3-70b-instruct-fp8-fast: an assistant turn
// carrying tool_calls followed by a role:"tool" message produces a correct
// second turn that uses the result.

const isAnthropic = (provider) => provider === "anthropic";

/** The assistant turn that requested the tools. */
export function assistantToolMessage(provider, text, toolCalls) {
  if (isAnthropic(provider)) {
    return {
      role: "assistant",
      content: [
        ...(text ? [{ type: "text", text }] : []),
        ...toolCalls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
      ],
    };
  }

  return {
    role: "assistant",
    content: text || "",
    tool_calls: toolCalls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
    })),
  };
}

/**
 * The results, ready to append.
 *
 * OpenAI wants one message per call; Anthropic wants one message holding every
 * block. Returning an array either way keeps the loop from caring which.
 */
export function toolResultMessages(provider, results) {
  if (isAnthropic(provider)) {
    return [
      {
        role: "user",
        content: results.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: serialise(r.output),
        })),
      },
    ];
  }

  return results.map((r) => ({
    role: "tool",
    tool_call_id: r.id,
    content: serialise(r.output),
  }));
}

// Results go into the prompt as text, so their size is a context cost. Anything
// large should have been projected by its service long before here — this cap
// is a backstop against one runaway result poisoning the whole conversation,
// not a substitute for projecting.
const MAX_RESULT_CHARS = 4000;

function serialise(output) {
  const text = typeof output === "string" ? output : JSON.stringify(output ?? null);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return text.slice(0, MAX_RESULT_CHARS) + '… (truncated)"';
}

export const LIMITS = { MAX_RESULT_CHARS };
