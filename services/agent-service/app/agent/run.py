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

It reports `step_limit` rather than an error, deliberately. `step_limit` is a
completed turn that ran out of room, and it carries whatever prose the model had
already addressed to the learner — read off the meter, because a run that raises
returns no messages at all. An error would say the turn produced nothing, which
since §11 step 9 costs the learner the reply outright: there is no second
implementation behind this one.

The clock covers the WHOLE turn, rescue included. It used to wrap only the graph
call, so a run that spent 19s in the loop could start a fresh model call and
still be talking long after the Worker gave up — the overshoot §13 is chasing.

ANSWERED_AFTER_CAP is the other. A run that spends every step calling tools has
no prose to show for it — measured in the Worker: asking about 翻译 produced
four tool calls and an empty reply, rendering as a card with an unexplained
silence beside it. So when the loop ends without an answer, ask for one with the
tools taken away. Never after the deadline, though: that call would land after
the Worker has already stopped listening.

That rescue call carries the system prompt EXPLICITLY. `create_agent` owns the
prompt during the loop and never puts it in the message list, so a bare
`chat.ainvoke` here produced the one reply in the turn the tutor's rules never
reached — free to state an HSK level it never looked up, offer to publish, or
retype characters this model corrupts (§7.2). It is also the path where the
model has spent every step on tools, which is when those rules matter most.
"""

from __future__ import annotations

import asyncio
import logging
import time
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


class _Clock:
    """One deadline for the turn, shared by every model call in it.

    AGENT_DEADLINE_S is not a per-call timeout. It exists so this container
    stops before AGENT_SERVICE_TIMEOUT_MS does, and that is a property of the
    whole request — measuring it twice from zero gives the turn two budgets and
    the Worker one.
    """

    def __init__(self, seconds: float) -> None:
        self.total = seconds
        self._started = time.monotonic()

    def remaining(self) -> float:
        return self.total - (time.monotonic() - self._started)


async def run_turn(
    request: TurnRequest,
    *,
    model: BaseChatModel | None = None,
    config: Settings | None = None,
) -> TurnResponse:
    config = config or settings()
    state = TurnState.from_request(request, config)
    meter = RunMeter()
    messages = _to_langchain(request)
    clock = _Clock(config.deadline_s)

    try:
        chat = model or build_model(config)
    except Exception as err:  # noqa: BLE001
        # A provider that cannot even be constructed — no key, unknown name — is
        # a turn that could not happen, not a crash. Reported the same way a
        # provider failure is, so the Worker reads a turn it can fall back from
        # rather than an opaque 500 from the endpoint.
        log.error("provider unavailable (%s): %s", type(err).__name__, err)
        return _respond(request, state, meter, text="", stopped_by="model_error")

    outcome = await _invoke(chat, state, request, messages, config, meter, clock)

    text, stopped_by = outcome.text, outcome.stopped_by
    if not text and state.steps and not outcome.timed_out:
        if rescued := await _answer_without_tools(chat, request, messages, meter, clock):
            text, stopped_by = rescued, "answered_after_cap"

    return _respond(request, state, meter, text=text, stopped_by=stopped_by)


def _respond(
    request: TurnRequest,
    state: TurnState,
    meter: RunMeter,
    *,
    text: str,
    stopped_by: StopReason,
) -> TurnResponse:
    return TurnResponse(
        contract_version=CONTRACT_VERSION,
        request_id=request.request_id,
        message=text,
        intended_actions=list(state.actions),
        discovered_words=state.discovered,
        save_attempts=state.save_attempts + _uncounted_saves(state, meter),
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
    clock: _Clock,
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

    # Both capped paths carry `meter.last_answer` rather than "". The graph
    # raises, so `result` never exists and any prose the model already wrote is
    # only on the meter. Empty when it never addressed the learner, which is
    # the honest answer then — the Worker's cards stand on their own.
    try:
        async with asyncio.timeout(clock.remaining()):
            result: Any = await agent.ainvoke(agent_input, run_config)
    except TimeoutError:
        log.warning("agent stopped at the %ss deadline", config.deadline_s)
        return _Run(text=meter.last_answer, stopped_by="step_limit", timed_out=True)
    except GraphRecursionError as err:
        # Not a failure: the model kept working past the point where it should
        # have answered.
        log.warning("agent hit the step limit: %s", err)
        return _Run(text=meter.last_answer, stopped_by="step_limit", timed_out=False)
    except Exception as err:  # noqa: BLE001 — every provider fault, named in the log
        log.error("agent run failed (%s): %s", type(err).__name__, err)
        return _Run(text="", stopped_by="model_error", timed_out=False)

    return _Run(
        text=_last_text(result.get("messages", [])),
        stopped_by="answered",
        timed_out=False,
    )


async def _answer_without_tools(
    chat: BaseChatModel,
    request: TurnRequest,
    messages: list[BaseMessage],
    meter: RunMeter,
    clock: _Clock,
) -> str:
    """The tools are withheld, so the only thing left to do is write.

    The system prompt is passed here because `create_agent` keeps it out of the
    message list — it takes it as `system_prompt` and threads it in itself. So
    this call is not "the loop minus tools", it is a fresh conversation, and
    without the prompt it was the one reply in the turn written by a model that
    had never been told the rules. Every safety line in prompt.py applies least
    where it was applied last: the model is out of steps, has tool results it
    half-remembers, and is being asked to commit to an answer.
    """
    remaining = clock.remaining()
    if remaining <= 0:
        # The loop used the whole budget. Answering now writes into a request
        # the Worker has stopped waiting for.
        log.warning("no deadline left for a final answer")
        return ""

    try:
        async with asyncio.timeout(remaining):
            reply = await chat.ainvoke(
                [
                    SystemMessage(content=prompt_module.build(request)),
                    *messages,
                    SystemMessage(content=FINAL_NUDGE),
                ],
                config={"callbacks": [meter, *tracing.callbacks()]},
            )
    except TimeoutError:
        log.warning("final answer call hit the %ss deadline", clock.total)
        return ""
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


def _uncounted_saves(state: TurnState, meter: RunMeter) -> int:
    """Saves the model asked for that the tool's own counter never saw.

    Added to `state.save_attempts`, the pair comes to `max(asked, counted)`.

    Two ways a call misses the counter inside the tool, and only the first used
    to be covered. A WITHHELD tool is not registered, so the framework answers
    "tool not found" and the body never runs. A REGISTERED one whose arguments
    fail validation is rejected by the framework for a different reason, with
    the same result — and gating on `state.allowed` returned 0 in exactly that
    case, which is the Worker's measured bug wearing the other costume:
    `saveFailed` is gated on this count, so an attempt nobody counted means the
    learner reads a claimed save with nothing contradicting it.

    Read off the meter, which watches the model's output directly — so this
    survives a run that ended at the deadline or the step limit and returned no
    messages at all. `TurnState.check` covers the case where a tool IS
    registered, runs, and the allowlist still says no.
    """
    asked = meter.asked_for("save_words_to_deck")
    return max(0, asked - state.save_attempts)
