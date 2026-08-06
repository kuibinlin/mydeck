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
"""

from __future__ import annotations

from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

from ..schemas import Usage


class RunMeter(BaseCallbackHandler):
    """Counts only. Attach it to every model call in a turn."""

    def __init__(self) -> None:
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.requested_tools: list[str] = []

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        self.calls += 1

        for batch in response.generations:
            for generation in batch:
                message = getattr(generation, "message", None)
                self._count_tokens(message)
                self._note_tool_calls(message)

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

    def asked_for(self, name: str) -> int:
        return self.requested_tools.count(name)

    def usage(self) -> Usage:
        return Usage(
            model_calls=self.calls,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
        )
