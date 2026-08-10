"""The boundary between model output and tool code.

Two jobs: describe what a tool accepts, and survive what actually arrives.

ARGUMENT REPAIR. Models get argument types wrong on essentially every call —
the Worker measured sixteen distinct cases in backend/test/repair.test.js,
deleted with its own repair layer in §11 step 9. Pydantic rejects, and a
rejection costs a whole turn to retry. What is wanted is repair where the
meaning is unambiguous (a JSON array arriving as a string, a scalar where a list
belongs, a float for an integer) and rejection only where it is not. The
before-validator does the first; the field types do the second.

The arg schema and the tool function's signature are two descriptions of the
same thing, so they can drift. `tests/test_tools.py` asserts they match.
"""

from __future__ import annotations

import json
from typing import Any, cast

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, field_validator


def dump(value: Any) -> str:
    """A tool result, as the model will read it.

    ensure_ascii=False so Chinese stays Chinese in the transcript rather than
    becoming \\u escapes the model has to decode back.
    """
    return json.dumps(value, ensure_ascii=False)


def error(message: str) -> str:
    return dump({"error": message})


def coerce_int_list(value: Any) -> list[int]:
    """Whatever the model sent, as integers where that is unambiguous."""
    if value is None:
        return []

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text.startswith("["):
            try:
                return coerce_int_list(json.loads(text))
            except ValueError:
                return []
        return coerce_int_list(text.replace(",", " ").split())

    items = value if isinstance(value, list) else [value]

    out: list[int] = []
    for item in items:
        try:
            out.append(int(float(item)))
        except (TypeError, ValueError):
            continue
    return out


class _WordRefsMixin(BaseModel):
    """Shared repair for the one argument every action tool takes."""

    @field_validator("word_refs", mode="before", check_fields=False)
    @classmethod
    def _repair(cls, value: Any) -> Any:
        return coerce_int_list(value)


class HskLookupArgs(BaseModel):
    word: str = Field(
        description="One Chinese word, e.g. 翻译. Copy it exactly from the learner's message."
    )


class HskWordListArgs(BaseModel):
    level: int = Field(ge=1, le=7, description="HSK level, 1 to 7.")
    limit: int = Field(default=10, ge=1, le=20, description="How many words. Default 10.")
    known: list[str] = Field(
        default_factory=list,
        description="Simplified words to leave out, e.g. ['你好','谢谢'].",
    )


class HskSearchArgs(BaseModel):
    query: str = Field(description="English meaning, e.g. 'to recommend'.")
    limit: int = Field(default=6, ge=1, le=10, description="How many matches. Default 6.")


class CreateActivityArgs(_WordRefsMixin):
    type: str = Field(description="'stroke' to practise writing, 'match' to be quizzed.")
    word_refs: list[int] = Field(
        default_factory=list,
        description="Numbers from the known-word list above. Optional — omit to use the "
        "learner's own deck or their level.",
    )
    deck_id: int | None = Field(default=None, description="A deck id from the list above.")
    level: int | None = Field(default=None, ge=1, le=7, description="HSK level to draw from.")
    title: str | None = Field(default=None, description="Short heading. Optional.")


class SaveWordsArgs(_WordRefsMixin):
    word_refs: list[int] = Field(
        default_factory=list,
        description="Numbers from the known-word list above. Best omitted — leaving this out "
        "saves the words already on screen, which is almost always what is wanted.",
    )
    deck_id: int | None = Field(default=None, description="A deck id from the list above.")
    deck_name: str | None = Field(
        default=None,
        description="The deck by NAME, e.g. 'Hospital words' — created if they do not have it. "
        "Never an id number.",
    )


def as_tool(
    fn: Any,
    *,
    name: str,
    description: str,
    args_schema: type[BaseModel],
) -> StructuredTool:
    """Bind a coroutine and its arg schema into a tool.

    cast() on args_schema because from_function's signature does not accept a
    Pydantic metaclass without complaint; it is correct at runtime.

    `fn` needs no cast — it is already declared Any, because from_function
    cannot express the signature of the closures passed to it. It used to carry
    one anyway; pyright's reportUnnecessaryCast is what noticed, mypy --strict
    did not.
    """
    return StructuredTool.from_function(
        coroutine=fn,
        name=name,
        description=description,
        args_schema=cast(Any, args_schema),
    )
