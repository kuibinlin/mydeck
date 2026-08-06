"""Langfuse tracing.

Optional and fail-open. Two rules, and both matter more than the traces:

    no credentials  → no handler, no import cost, no warning spam
    handler throws  → the turn still runs

Observability that can take down the thing it observes is worse than none.

WHAT GOES TO LANGFUSE. The whole prompt, which means the learner's message and
the vocabulary they are working through. That is user content leaving for a
third party, and it is a deliberate choice — enabled only where the credentials
are set.
"""

from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger(__name__)

_warned = False


def enabled() -> bool:
    return bool(os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY"))


def callbacks() -> list[Any]:
    """A LangChain callback list — empty when tracing is off or unavailable."""
    global _warned

    if not enabled():
        return []

    try:
        from langfuse.langchain import CallbackHandler

        return [CallbackHandler()]
    except Exception as err:  # noqa: BLE001 — never let tracing break a turn
        if not _warned:
            log.warning("langfuse tracing unavailable, continuing without it: %s", err)
            _warned = True
        return []
