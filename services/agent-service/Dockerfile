# syntax=docker/dockerfile:1
#
# Build context is this directory, not the repo root: nothing here needs the
# frontend, the Worker or the 424KB HSK index. The Worker owns the dictionary
# (docs/architecture.md §5) and this image must not carry a second copy of it.
#
#   docker build -t mydeck-agent:local services/agent-service
#   docker run --rm -p 8080:8080 mydeck-agent:local
#
# Two stages so the runtime image carries no uv, no compiler and no lockfile.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

# Bytecode up front: Cloud Run scales to zero, so first-request latency is paid
# on every cold start, and langchain is a large import graph.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/srv/.venv

WORKDIR /srv

# Dependencies resolve from the lockfile alone, so this layer survives every
# change to app/. --frozen fails the build rather than silently re-resolving:
# an image whose dependencies drifted from uv.lock is not the thing that was
# tested.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev


FROM python:3.12-slim-bookworm

# Same base as the builder image, so the venv's interpreter path resolves here.
RUN groupadd --system agent && useradd --system --gid agent --home /srv agent

WORKDIR /srv
COPY --from=builder --chown=agent:agent /srv/.venv /srv/.venv
COPY --chown=agent:agent app ./app

ENV PATH="/srv/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

# Nothing in the image is a secret. AGENT_SERVICE_SECRET and the model keys
# arrive from Secret Manager at runtime, and app/main.py refuses to serve on
# Cloud Run without the first one.
USER agent
EXPOSE 8080

# Cloud Run assigns PORT and it is not always 8080, so it is read rather than
# assumed. One worker per container: Cloud Run's unit of scaling is the
# instance, so a second uvicorn worker competes for the same CPU allocation
# instead of adding any.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
