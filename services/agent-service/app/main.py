"""HTTP surface for the agent service.

Three routes, and the split between them is the boundary:

    GET  /health                 unauthenticated — Cloud Run's probe
    GET  /version                unauthenticated — the deploy smoke test
    POST /internal/agent/turn    shared secret required

The browser never reaches this service; only the Worker does. `/internal/` says
so and the secret enforces it. `docs/architecture.md` §7.3 explains why a shared
secret rather than Cloud Run's own IAM: `--no-allow-unauthenticated` wants a
Google-signed ID token, and a Worker cannot mint one without a stored
service-account key, which that document forbids. So ingress is public and the
secret is the only gate — hence constant-time comparison, and hence the
fail-closed check below.

OpenAPI's /docs and /openapi.json are off for the same reason. The contract is
in schemas.py, which is a better place to read it than a public endpoint on a
service whose URL is meant to be unadvertised.

The loop itself lives in app/agent/; this file is only the door.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException

from .agent.run import run_turn
from .schemas import CONTRACT_VERSION, TurnRequest, TurnResponse
from .version import VERSION, build_info

app = FastAPI(
    title="MyDeck agent service",
    version=VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


def require_secret(x_mydeck_agent_secret: str | None = Header(default=None)) -> None:
    """The only thing standing between the internet and this endpoint.

    `compare_digest` rather than `==` because the comparison is against a
    secret an attacker can retry indefinitely.

    Unset means "local development" — but only when this is demonstrably not a
    deployment. Cloud Run sets `K_SERVICE` on every instance, so an
    unconfigured secret there is a misconfiguration that opens the service to
    anyone who finds the URL, and 503 is the correct answer to it. Failing open
    would be silent, and silent is how this stays broken.
    """
    expected = os.environ.get("AGENT_SERVICE_SECRET", "")

    if not expected:
        if os.environ.get("K_SERVICE"):
            raise HTTPException(status_code=503, detail="agent secret not configured")
        return

    if not x_mydeck_agent_secret or not hmac.compare_digest(x_mydeck_agent_secret, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness only. Deliberately says nothing about the build — see /version."""
    return {"status": "ok"}


@app.get("/version")
def version() -> dict[str, str]:
    return {**build_info(), "contract_version": CONTRACT_VERSION}


@app.post(
    "/internal/agent/turn",
    response_model=TurnResponse,
    dependencies=[Depends(require_secret)],
)
async def turn(request: TurnRequest) -> TurnResponse:
    """One tutor turn.

    `request_id` is echoed rather than regenerated: it is how the Worker knows
    the response it is holding answers the request it sent, and a response that
    cannot prove that is discarded there.

    This never raises for a model or dictionary failure. Those come back as
    `stopped_by: "model_error"` with whatever text exists. A 5xx would tell the
    Worker the hop itself broke, and since §11 step 9 that costs the learner the
    tutor's prose outright — where a reported `model_error` still carries any
    text the turn managed to produce.
    """
    return await run_turn(request)
