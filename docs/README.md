# Documentation

| Doc | Read it when |
|---|---|
| [setup.md](setup.md) | First clone — Cloudflare resources, OAuth, Resend, env files |
| [local-development.md](local-development.md) | Running both servers, and the tests |
| [deployment.md](deployment.md) | Shipping the Worker and the frontend; D1 migrations |
| [reference.md](reference.md) | Every command, env var and secret, in one place |
| [secrets.md](secrets.md) | Setting, verifying and rotating secrets across Cloudflare, Google and GitHub |
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

You may also see a `CLAUDE.md` at the repo root. It is **gitignored on purpose**
— working notes for Claude Code, not part of this set, and not in a clone.
Nothing here points at it, and nothing in it is the only copy of anything: the
reasoning behind the architecture lives in
[architecture.md](architecture.md) (the decisions and the contract) and
[structure.md](structure.md) (the layering rules). If you find yourself writing
a rule only into `CLAUDE.md`, it belongs in one of those instead.
