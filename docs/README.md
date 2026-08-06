# Documentation

| Doc | Read it when |
|---|---|
| [setup.md](setup.md) | First clone — Cloudflare resources, OAuth, Resend, env files |
| [local-development.md](local-development.md) | Running both servers, and the tests |
| [deployment.md](deployment.md) | Shipping the Worker and the frontend; D1 migrations |
| [reference.md](reference.md) | Every command, env var and secret, in one place |
| [structure.md](structure.md) | Where code goes and why the layout is shaped this way |
| [architecture.md](architecture.md) | Where this is **going** — the Python agent service on Cloud Run, and why |

`structure.md` describes what the repository **is**. `architecture.md` describes
where it is **going**: the 中文 tutor moves to a Python container on Cloud Run,
everything else stays on Cloudflare. The direction is decided (§8) and the staged
migration is §11 — but none of it is built yet.

Two more docs live next to the thing they describe, because they are decisions
rather than instructions:

- [../infrastructure/README.md](../infrastructure/README.md) — what to settle
  before the first Terraform file exists
- [../.github/workflows/README.md](../.github/workflows/README.md) — the commands
  a CI job would run, and what will break it

`CLAUDE.md` at the repo root is separate from all of these: it documents the
*reasoning* behind the architecture — why the tool allowlist is enforced where
tools run rather than where they are advertised, why the client posts its own
conversation history back, why challenge decks version and flashcard decks do
not. Read it before changing the Worker's agent path.
