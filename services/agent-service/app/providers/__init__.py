"""Model access.

`init_chat_model` does the provider work, which is the point of choosing a
framework — backend/src/ai/providers/ exists because that layer had to be
written by hand in the Worker, and re-writing it here was the accepted cost of
Python (docs/architecture.md §8.3), not an instruction to pay it twice.

The scripted model is not a mock of this layer. It IS this layer, for tests: a
real BaseChatModel whose answers are decided in advance, so a test asserts what
the loop and the guards do rather than what a model happened to say.
"""

from __future__ import annotations

from langchain_core.language_models.chat_models import BaseChatModel

from ..config import Settings
from .scripted import ScriptedChatModel

__all__ = ["ScriptedChatModel", "build_model"]


def build_model(config: Settings) -> BaseChatModel:
    if config.provider == "scripted":
        return ScriptedChatModel()

    from langchain_openai import ChatOpenAI
    from pydantic import SecretStr

    # Everything OpenAI-compatible arrives here, SEA-LION included — the Worker
    # takes the same route. AI_BASE_URL is the host; the client appends the
    # path, so it is passed through unchanged.
    return ChatOpenAI(
        model=config.model or "gpt-4o-mini",
        base_url=config.base_url,
        api_key=SecretStr(config.api_key) if config.api_key else None,
        temperature=config.temperature,
    )
