"""How the tools are wired.

A tool is described twice — once by its Pydantic arg schema, which is what the
model sees and what repairs malformed arguments, and once by the function's own
signature, which is what actually runs. Two descriptions of one thing can drift,
and the failure is silent: the model sends a field the function does not accept,
LangChain raises, and it reads like a model error.

So the drift is asserted rather than hoped for.
"""

import inspect

import pytest

from app.agent.state import TurnState
from app.agent.tools import build_tools
from app.agent.tools.args import coerce_int_list

ALL_FIVE = {
    "hsk_lookup",
    "hsk_word_list",
    "hsk_search",
    "create_activity",
    "save_words_to_deck",
}


@pytest.fixture
def tools(make_request, agent_config):
    return build_tools(TurnState.from_request(make_request(), agent_config))


def test_every_tool_is_built(tools):
    assert {tool.name for tool in tools} == ALL_FIVE


def test_only_allowed_tools_are_built(make_request, agent_config):
    state = TurnState.from_request(make_request(allowed_tools=["hsk_search"]), agent_config)
    assert [tool.name for tool in build_tools(state)] == ["hsk_search"]


def test_schema_fields_match_the_function_signature(tools):
    for tool in tools:
        declared = set(tool.args_schema.model_fields)
        accepted = set(inspect.signature(tool.coroutine).parameters)
        assert declared == accepted, f"{tool.name}: schema {declared} vs signature {accepted}"


def test_every_tool_has_routing_prose(tools):
    # Descriptions carry the routing — no two may share a trigger phrase, and an
    # empty one makes a tool unreachable for reasons nothing will report.
    for tool in tools:
        assert len(tool.description) > 80


def test_every_argument_is_described(tools):
    for tool in tools:
        for name, field in tool.args_schema.model_fields.items():
            assert field.description, f"{tool.name}.{name} has no description"


@pytest.mark.parametrize(
    ("sent", "expected"),
    [
        ([0, 1], [0, 1]),
        ("[0, 1]", [0, 1]),  # a JSON array arriving as a string
        ("0, 1", [0, 1]),  # comma-separated
        ("0 1", [0, 1]),  # whitespace-separated
        (3, [3]),  # a scalar where a list belongs
        ("2", [2]),
        ([1.0, 2.7], [1, 2]),  # floats for integers
        ([None, "x", 4], [4]),  # junk dropped, the rest kept
        (None, []),
        ("", []),
        ("[oops", []),
        ({"a": 1}, []),
    ],
)
def test_word_ref_repair(sent, expected):
    """Ported from the Worker's measured cases — backend/test/repair.test.js.

    Repaired where the meaning is unambiguous, dropped where it is not. A
    rejection would cost a whole turn to retry, which is the expensive way to
    handle a model that got a type wrong.
    """
    assert coerce_int_list(sent) == expected
