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
    # takes the same route with the same variables.
    return ChatOpenAI(
        model=config.model or "gpt-4o-mini",
        base_url=openai_base(config.base_url),
        api_key=SecretStr(config.api_key) if config.api_key else None,
        temperature=config.temperature,
    )


def openai_base(url: str | None) -> str | None:
    """`AI_BASE_URL` names a host here and an endpoint prefix in LangChain.

    backend/src/ai/providers/openaiCompat.js appends `/v1/chat/completions` to
    the value, so the Worker's config holds a bare host —
    `https://api.sea-lion.ai`. ChatOpenAI appends only `/chat/completions`, so it
    needs the `/v1` already there.

    One variable, two conventions, and the failure is a 404 from a URL that
    looks right in both config files. Normalised here so a single value works in
    both processes instead of requiring two that must be kept in step.
    """
    if not url:
        return None
    trimmed = url.rstrip("/")
    return trimmed if trimmed.endswith("/v1") else f"{trimmed}/v1"
