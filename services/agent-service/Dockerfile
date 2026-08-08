# syntax=docker/dockerfile:1
#
# Build context is this directory, not the repo root: nothing here needs the
# frontend, the Worker or the 424KB HSK index. The Worker owns the dictionary
# (docs/architecture.md §5) and this image must not carry a second copy of it.
#
#   docker build -t mydeck-agent:local services/agent-service
#   docker run --rm -p 8080:8080 mydeck-agent:local
#
# ─────────────────────────────────────────────────────────────────────────────
# BUILDING FOR CLOUD RUN FROM APPLE SILICON
# ─────────────────────────────────────────────────────────────────────────────
#
# Cloud Run runs x86_64. A plain `docker build` on an arm64 Mac produces an
# arm64 image, and every step after that SUCCEEDS: it pushes to Artifact
# Registry, `gcloud run deploy` accepts it, and the revision then fails to
# start with an exec-format error that never mentions architecture. The image
# is not broken and the deploy is not broken — they just do not match.
#
# So anything destined for Cloud Run needs the platform forced:
#
#   docker build --platform linux/amd64 \
#     -t asia-southeast1-docker.pkg.dev/mydeck-linsnotes/mydeck-images/mydeck-agent:$(git rev-parse --short HEAD) \
#     services/agent-service
#
# The local commands above deliberately do NOT force it. On an arm64 machine a
# native build runs at full speed while an amd64 one runs under emulation —
# noticeably slower, and slowest exactly where this image is heaviest, resolving
# and byte-compiling langchain.
#
# Two builds for two purposes, then: native for the laptop, linux/amd64 for the
# registry. CI on ubuntu-latest is already x86_64 and needs no flag.
# ─────────────────────────────────────────────────────────────────────────────
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
