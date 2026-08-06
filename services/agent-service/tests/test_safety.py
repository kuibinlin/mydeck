"""Guards against the suite silently talking to real services.

The mirror of backend/test/safety.test.js, and it exists for the same reason
that one does: a previous iteration of this harness reached the live OpenAI API
and came back with a 401 for an unset key. That is a test suite spending money
and leaking prompts, and it looked exactly like a normal failure.
"""

import os

from app.config import settings
from app.providers import build_model
from app.providers.scripted import ScriptedChatModel
from app.tracing import callbacks, enabled


def test_the_provider_is_scripted() -> None:
    assert settings().provider == "scripted"
    assert isinstance(build_model(settings()), ScriptedChatModel)


def test_no_model_credentials_are_present() -> None:
    assert not os.environ.get("AI_API_KEY")
    assert not os.environ.get("AI_BASE_URL")


def test_the_dictionary_points_nowhere_real() -> None:
    # `.invalid` is reserved (RFC 2606) and never resolves, so a test that
    # slips past the stub fails rather than hitting the live HSK server — whose
    # public endpoint is rate limited to 30 requests a minute across everyone.
    assert "invalid" in settings().hsk_url
    assert "linsnotes.com" not in settings().hsk_url


def test_tracing_is_off_so_no_prompt_leaves_the_process() -> None:
    # Langfuse receives the whole prompt, which is the learner's message and
    # their vocabulary. Off without credentials, and credentials are cleared.
    assert enabled() is False
    assert callbacks() == []
