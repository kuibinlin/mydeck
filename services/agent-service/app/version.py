"""What this build is.

`/version` exists so a deploy can be *verified* rather than assumed.
`.github/workflows/README.md` makes the case: `/health` answers 200 from the
previous revision just as happily as from the new one, so a smoke test that only
checks health cannot tell a successful deploy from a silent rollback. Asserting
on the revision can.
"""

import os

SERVICE = "mydeck-agent"
VERSION = "0.1.0"


def build_info() -> dict[str, str]:
    """Identity of the running container.

    `K_REVISION` is set by Cloud Run and is the authoritative answer to "which
    deploy am I talking to". `GIT_SHA` is the local/CI stand-in, baked at build
    time. Neither is a secret, which is why this route needs no auth.
    """
    return {
        "service": SERVICE,
        "version": VERSION,
        "revision": os.environ.get("K_REVISION") or os.environ.get("GIT_SHA") or "dev",
    }
