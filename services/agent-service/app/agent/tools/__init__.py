"""Assembling one turn's tools.

Only what this turn allows is ADVERTISED. `TurnState.check` then asks again when
one runs, because those are different questions — and a save the model asks for
when the tool was withheld is counted from the transcript in run.py, so even a
tool that was never registered cannot hide an attempt.
"""

from __future__ import annotations

from langchain_core.tools import StructuredTool

from ..state import TurnState
from . import actions, dictionary

__all__ = ["build_tools"]


def build_tools(state: TurnState) -> list[StructuredTool]:
    available = [*dictionary.tools(state), *actions.tools(state)]
    return [tool for tool in available if tool.name in state.allowed]
