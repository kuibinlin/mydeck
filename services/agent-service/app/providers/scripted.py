"""A chat model whose answers are decided in advance.

The Worker's tutor tests did the same thing by stubbing `callModel`, until
§11 step 9 deleted the loop they covered. The reason holds here: with the
model's judgement out of the picture, what is left under test is the wiring —
did the allowlist hold, was the attempt counted, did the right intended action
come out.

It is a real BaseChatModel rather than a mock, so it goes through the same
bind_tools / invoke path the production model does. A mock that skipped that
would not exercise the thing most likely to break.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field


class ScriptedChatModel(BaseChatModel):
    """Returns `script` in order, repeating the last entry once exhausted.

    Repeating rather than raising is deliberate: a test about the tool-call
    budget should not also have to script every turn the budget allows.
    """

    script: list[AIMessage] = Field(default_factory=list)
    calls: int = 0
    # Seconds to stall before answering, per call.
    #
    # This is how latency behaviour gets tested without paying a provider: the
    # deadline, the Worker's timeout and the route's degrade-to-cards path are
    # all clock-driven, and a real model is an expensive and unreliable way to
    # produce a clock. Also usable by hand — run the container with a scripted
    # provider and a 60s delay to see what the full edge path does about it.
    delay_s: float = 0.0
    # What the agent actually offered the model. Asserting on this is how a test
    # tells "the tool was withheld" from "the model chose not to call it".
    offered_tools: list[str] = Field(default_factory=list)
    # Every message list the model was handed, so a test can prove a tool result
    # made it back into the conversation.
    seen: list[list[BaseMessage]] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Any, **kwargs: Any) -> ScriptedChatModel:  # noqa: ANN401
        self.offered_tools = [getattr(t, "name", str(t)) for t in tools]
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.seen.append(list(messages))

        if not self.script:
            # Said out loud rather than answered with an empty string: a scripted
            # model with nothing scripted is a test that forgot to say what the
            # model does, and silence reads as a bug in the loop.
            turn = AIMessage(content="(scripted model: no script configured)")
        else:
            turn = self.script[min(self.calls, len(self.script) - 1)]

        self.calls += 1

        # A fresh copy with fresh ids. Handing the same object back twice makes
        # two graph steps share tool_call ids, which the runtime then pairs
        # wrongly — a failure that looks like a model bug.
        reply = turn.model_copy(deep=True)
        reply.id = f"scripted-{uuid.uuid4()}"
        for call in reply.tool_calls or []:
            call["id"] = f"call-{uuid.uuid4()}"

        return ChatResult(generations=[ChatGeneration(message=reply)])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        # Overridden rather than inherited so `delay_s` actually yields. The
        # default async path runs _generate in a thread, where a sleep would
        # block a worker instead of letting the deadline fire.
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        return self._generate(messages, stop, None, **kwargs)


def says(text: str, *, usage: dict[str, int] | None = None) -> AIMessage:
    """A plain answer."""
    return AIMessage(
        content=text,
        usage_metadata={
            "input_tokens": (usage or {}).get("input_tokens", 10),
            "output_tokens": (usage or {}).get("output_tokens", 5),
            "total_tokens": (usage or {}).get("total_tokens", 15),
        },
    )


def calls(name: str, args: dict[str, Any], *, text: str = "") -> AIMessage:
    """A tool call."""
    return AIMessage(
        content=text,
        tool_calls=[{"name": name, "args": args, "id": "placeholder", "type": "tool_call"}],
        usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    )
