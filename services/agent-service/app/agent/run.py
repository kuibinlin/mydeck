"""One turn: build the agent, run it, map what happened onto the contract.

`create_agent` owns the loop — that is the whole reason for choosing a
framework. What it does not own is everything in state.py, and four things here:

    the deadline    neither the step limit nor the tool budget is a clock
    steps           read back out of what the tools recorded
    stopped_by      four values, and the framework produces none of them
    usage           measured by callback, because a failed run returns no
                    messages but has still been charged for

THE DEADLINE is the one that keeps a container honest. The Worker gives up at
AGENT_SERVICE_TIMEOUT_MS and degrades to the cards; without a clock here, this
process carries on past that — finishing model calls nobody will read, spending
provider budget on an abandoned request, and holding a Cloud Run instance.

It reports `step_limit` rather than an error, deliberately. An error would tell
the Worker this failed fast, and the Worker answers a fast failure by running
its own loop — making the learner wait a second time for a turn that was already
too slow. `step_limit` is a completed turn that ran out of room, which is what
this is.

ANSWERED_AFTER_CAP is the other. A run that spends every step calling tools has
no prose to show for it — measured in the Worker: asking about 翻译 produced
four tool calls and an empty reply, rendering as a card with an unexplained
silence beside it. So when the loop ends without an answer, ask for one with the
tools taken away. Never after the deadline, though: that call would land after
the Worker has already stopped listening.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.errors import GraphRecursionError

from .. import tracing
from ..config import Settings, settings
from ..providers import build_model
from ..schemas import CONTRACT_VERSION, StopReason, TurnRequest, TurnResponse
from . import prompt as prompt_module
from .meter import RunMeter
from .state import TurnState
from .tools import build_tools

log = logging.getLogger(__name__)

FINAL_NUDGE = (
    "Stop calling tools. Answer the learner now, in two or three sentences, using only "
    "what you already have above."
)


@dataclass(frozen=True)
class _Run:
    """How the loop ended, before any rescue attempt."""

    text: str
    stopped_by: StopReason
    timed_out: bool


async def run_turn(
    request: TurnRequest,
    *,
    model: BaseChatModel | None = None,
    config: Settings | None = None,
) -> TurnResponse:
    config = config or settings()
    state = TurnState.from_request(request, config)
    chat = model or build_model(config)
    meter = RunMeter()
    messages = _to_langchain(request)

    outcome = await _invoke(chat, state, request, messages, config, meter)

    text, stopped_by = outcome.text, outcome.stopped_by
    if not text and state.steps and not outcome.timed_out:
        if rescued := await _answer_without_tools(chat, messages, meter):
            text, stopped_by = rescued, "answered_after_cap"

    return TurnResponse(
        contract_version=CONTRACT_VERSION,
        request_id=request.request_id,
        message=text,
        intended_actions=list(state.actions),
        discovered_words=state.discovered,
        save_attempts=state.save_attempts + _refused_saves(state, meter),
        stopped_by=stopped_by,
        steps=state.steps,
        usage=meter.usage(),
    )


async def _invoke(
    chat: BaseChatModel,
    state: TurnState,
    request: TurnRequest,
    messages: list[BaseMessage],
    config: Settings,
    meter: RunMeter,
) -> _Run:
    from langchain.agents import create_agent

    agent = create_agent(
        model=chat,
        tools=build_tools(state),
        system_prompt=prompt_module.build(request),
    )

    # The graph alternates model → tools → model, so a step limit of N needs
    # roughly 2N+1 nodes. Both sides typed loosely because the graph's input and
    # config types are generic over its state, and pinning them here would couple
    # this file to a framework internal for no checking it does not already have.
    agent_input: Any = {"messages": messages}
    run_config: Any = {
        "recursion_limit": config.max_steps * 2 + 1,
        "callbacks": [meter, *tracing.callbacks()],
    }

    try:
        async with asyncio.timeout(config.deadline_s):
            result: Any = await agent.ainvoke(agent_input, run_config)
    except TimeoutError:
        log.warning("agent stopped at the %ss deadline", config.deadline_s)
        return _Run(text="", stopped_by="step_limit", timed_out=True)
    except GraphRecursionError as err:
        # Not a failure: the model kept working past the point where it should
        # have answered.
        log.warning("agent hit the step limit: %s", err)
        return _Run(text="", stopped_by="step_limit", timed_out=False)
    except Exception as err:  # noqa: BLE001 — every provider fault, named in the log
        log.error("agent run failed (%s): %s", type(err).__name__, err)
        return _Run(text="", stopped_by="model_error", timed_out=False)

    return _Run(
        text=_last_text(result.get("messages", [])),
        stopped_by="answered",
        timed_out=False,
    )


async def _answer_without_tools(
    chat: BaseChatModel, messages: list[BaseMessage], meter: RunMeter
) -> str:
    """The tools are withheld, so the only thing left to do is write."""
    try:
        reply = await chat.ainvoke(
            [*messages, SystemMessage(content=FINAL_NUDGE)],
            config={"callbacks": [meter, *tracing.callbacks()]},
        )
    except Exception as err:  # noqa: BLE001
        # Leave it empty. The Worker's cards are a complete answer on their own.
        log.warning("final answer call failed: %s", err)
        return ""

    return _text_of(reply)


def _to_langchain(request: TurnRequest) -> list[BaseMessage]:
    """Roles are assigned by position on the way in and read by name here.

    The payload cannot express a system or tool role at all (schemas.py), so this
    mapping is total — there is no branch for "something else" because nothing
    else can arrive.
    """
    return [
        HumanMessage(content=m.content) if m.role == "user" else AIMessage(content=m.content)
        for m in request.messages
    ]


def _last_text(messages: list[BaseMessage]) -> str:
    """The final thing the model actually said, skipping bare tool calls."""
    for message in reversed(messages):
        if isinstance(message, AIMessage) and not message.tool_calls:
            if text := _text_of(message):
                return text
    return ""


def _text_of(message: object) -> str:
    content = getattr(message, "content", "")
    return content.strip() if isinstance(content, str) else ""


def _refused_saves(state: TurnState, meter: RunMeter) -> int:
    """Saves the model asked for that never reached a tool at all.

    Withheld tools are not registered with the agent, so a call to one is
    answered by the framework — "tool not found" — and never touches the counter
    inside the tool. That is the Worker's measured bug in a new costume:
    `saveFailed` is gated on the attempt count, so an attempt nobody counted
    means the learner sees the model's claim and nothing contradicting it.

    Read off the meter, which watches the model's output directly — so this
    survives a run that ended at the deadline or the step limit and returned no
    messages at all. `TurnState.check` covers the case where a tool IS
    registered and the allowlist still says no; this covers the case where it
    never got that far.
    """
    if "save_words_to_deck" in state.allowed:
        return 0
    return meter.asked_for("save_words_to_deck")
