"""Watching the model, as it works.

Measured from callbacks rather than from the returned message list, because the
message list is exactly what a turn does not have when it ends badly. A run that
hits the step limit or the deadline raises, and everything it already did would
be invisible — while the provider has very much charged for it.

Two things are worth watching, and both are the model's OUTPUT rather than the
tools' results:

    what it spent    `model_calls` is what the Worker bills. It writes one
                     ai_usage_log row per call, because AI_DAILY_LIMIT_FREE
                     counts calls rather than requests and a four-step turn
                     should cost four.

    what it asked    every tool name it reached for, including names that were
                     never registered. A withheld tool is answered by the
                     framework and never reaches the counter inside the tool, so
                     without this a save the learner never authorised would be
                     an attempt nobody counted — and `saveFailed` is gated on
                     that count.

    what it said     the last thing it addressed to the learner. Same reason as
                     the counts: a run that ends at the deadline or the step
                     limit raises, and `ainvoke` returns nothing, so prose the
                     model already produced would be thrown away. The contract
                     says a capped turn reports `step_limit` with whatever it
                     has, and this is the only place that still has it.
"""

from __future__ import annotations

from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

from ..schemas import MAX_MODEL_CALLS, Usage


class RunMeter(BaseCallbackHandler):
    """Counts only. Attach it to every model call in a turn."""

    def __init__(self) -> None:
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.requested_tools: list[str] = []
        self.last_answer = ""

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        self.calls += 1

        for batch in response.generations:
            for generation in batch:
                message = getattr(generation, "message", None)
                self._count_tokens(message)
                self._note_tool_calls(message)
                self._note_answer(message)

    def _count_tokens(self, message: object) -> None:
        usage = getattr(message, "usage_metadata", None)
        if not usage:
            return
        self.input_tokens += int(usage.get("input_tokens", 0) or 0)
        self.output_tokens += int(usage.get("output_tokens", 0) or 0)

    def _note_tool_calls(self, message: object) -> None:
        for call in getattr(message, "tool_calls", None) or []:
            if name := call.get("name"):
                self.requested_tools.append(str(name))

    def _note_answer(self, message: object) -> None:
        """Kept only when the model was talking to the learner, not narrating.

        A message carrying tool calls is skipped even when it also carries
        text, because that text is "let me look that up" — offered as a
        capped turn's whole reply it promises something that never arrives,
        which is worse than the cards standing on their own. Same rule
        `_last_text` applies to a run that finished normally.
        """
        if getattr(message, "tool_calls", None):
            return
        content = getattr(message, "content", "")
        if isinstance(content, str) and (text := content.strip()):
            self.last_answer = text

    def asked_for(self, name: str) -> int:
        return self.requested_tools.count(name)

    def usage(self) -> Usage:
        # Clamped here rather than validated in the schema. `Usage.model_calls`
        # declares the bound the Worker relies on, but a bound enforced by
        # raising on the way OUT turns a turn that overran into a turn the
        # learner never receives — the response is built after all the work is
        # done, so there is nothing left to salvage by refusing it.
        return Usage(
            model_calls=min(self.calls, MAX_MODEL_CALLS),
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
        )
