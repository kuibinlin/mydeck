# mydeck-agent

The 中文 tutor's agent loop, outside the Worker.

Why it exists, what it may and may not do, and how it gets deployed are all in
[docs/architecture.md](../../docs/architecture.md). Read §6-§8 before changing
anything here. This file is only how to run it.

**Status: serving real turns for one allowlisted account (§11 step 7).**
`create_agent` over five tools, a scripted provider for tests, HSK through the
existing MCP server. Running as `mydeck-agent-dev` in `asia-southeast1`, behind
`aisingapore/Qwen-SEA-LION-v4-32B-IT`.

Verified by a write landing rather than by an absence of errors: a turn asked to
save, Cloud Run answered 200 in 3.2s, and two rows appeared in D1 four seconds
later — with correctly formed Chinese, so the indices-not-characters contract
(§7.2) held through a real model. Warm turns run 3–6s.

Everyone not in `AGENT_ALLOWED_USERS` is still served by the Worker's own
JavaScript loop.

What is *not* done: step 8, widening it past the allowlist. That is gated on a
production service rather than on this code — `min_instances = 0` means a
first-request cold start of ~23.6s, fine for one tester and not for learners
(architecture.md §8.5). Also still unproven: the `deck_name` branch, where the
agent asks for a *new* draft deck instead of writing into one already offered.

**The first real turn found a prompt defect that every test had missed.** Asked
"什么是水" with nothing seeded, the model skipped `hsk_lookup` and asserted 水 is
not in HSK — it is HSK 1. The prompt forbade *stating* unsourced facts but never
required the *call*, and it supplied the exact sentence to use on a `found:false`
result, so the model reached for that sentence without earning it. Fixed in both
languages and pinned by `tests/test_prompt_parity.py`. A scripted model could
never have caught it: it calls the tool because the script says to.

## The one rule

This service reasons. **The Worker decides and the Worker writes.**

It returns *intended actions* that name words by index into a list the Worker
supplied. It has no database, no session, no dictionary, and no way to tell
whether a save is authorised — all of which is deliberate. A model here cannot
manufacture a Chinese character that reaches a flashcard, because the only
things it can send back are integers and prose.

## Run it

```bash
npm run dev:agent          # from the repo root — :8080, reload on save
npm run check:agent        # ruff + pytest + pyright
```

Or directly, if you prefer:

```bash
uv run --directory services/agent-service uvicorn app.main:app --reload --port 8080
uv run --directory services/agent-service pytest
```

As the container it will actually be:

```bash
docker build -t mydeck-agent:local services/agent-service
docker run --rm -p 8080:8080 -e AGENT_SERVICE_SECRET=local mydeck-agent:local
```

Native architecture, which is right for a laptop and wrong for Cloud Run — it
runs x86_64 only. An arm64 image pushes and deploys without complaint, then
fails to start with an exec-format error that never says "architecture". Builds
destined for Artifact Registry need `--platform linux/amd64`; the Dockerfile
header has the full command and why the local ones deliberately omit it.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Cloud Run's probe. Says nothing about the build. |
| `GET /version` | none | The deploy smoke test — a rollback changes `revision`. |
| `POST /internal/agent/turn` | shared secret | One tutor turn. |

```bash
curl localhost:8080/health
curl localhost:8080/version

curl -X POST localhost:8080/internal/agent/turn \
  -H 'Content-Type: application/json' \
  -H 'X-MyDeck-Agent-Secret: local' \
  -d '{
    "contract_version": "1",
    "request_id": "t1",
    "messages": [{"role": "user", "content": "Teach me 医院"}],
    "known_words": [{"i": 0, "simplified": "医院", "pinyin": "yīyuàn",
                     "meaning": "hospital", "source": "seed"}],
    "allowed_tools": ["hsk_lookup", "save_words_to_deck"],
    "level": 3
  }'
```

There is no `/docs` or `/openapi.json`. Ingress is public and the secret is the
only gate (§7.3), so the schema is not advertised there — read
[`app/schemas.py`](app/schemas.py), which is where it is actually defined and
where the reasoning lives.

## Environment

| Var | Set by | Effect |
|---|---|---|
| `PORT` | Cloud Run | Listen port. Defaults to 8080. |
| `AGENT_SERVICE_SECRET` | Secret Manager | Required. Unset **and** on Cloud Run → 503, deliberately. |
| `K_REVISION`, `K_SERVICE` | Cloud Run | Build identity, and how "am I deployed?" is answered. |
| `AGENT_DEADLINE_S` | you | 20s. Must stay under the Worker's `AGENT_SERVICE_TIMEOUT_MS`. |
| `AGENT_MAX_STEPS`, `AGENT_MAX_TOOL_CALLS` | you | 4 and 6, mirroring `ai/agentLoop.js`. |
| `AI_PROVIDER`, `AI_TUTOR_MODEL`, `AI_BASE_URL`, `AI_API_KEY` | Secret Manager | The model. `scripted` needs none of them. |
| `HSK_MCP_URL`, `HSK_TIMEOUT_S` | you | The dictionary. |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Secret Manager | Tracing. Absent → off. |

Nothing here is baked into the image.

Langfuse receives the whole prompt when it is on — the learner's message and the
vocabulary they are working through. That is user content going to a third
party, enabled only where the credentials are set. It never sees the session
cookie or `X-MyDeck-Agent-Secret`: neither enters a LangChain call.

## How it is built

```
main.py                     the door: /health, /version, the secret gate
  └── agent/run.py          create_agent, the deadline, then map onto the contract
        ├── agent/prompt.py   system prompt; known words NUMBERED
        ├── agent/meter.py    what the model spent and what it asked for
        ├── agent/state.py    every guard the framework does not have
        └── agent/tools/
              ├── args.py        arg schemas + argument repair
              ├── dictionary.py  the three read tools  → hsk/
              └── actions.py     the two that only ask
```

`create_agent` owns the loop. That is the whole point of the framework — the
Worker's `ai/agentLoop.js`, `ai/toolMessages.js` and most of `tools/repair.js`
have no counterpart here, and should not grow one.

What the framework does **not** do, all of it in `state.py` and `run.py`:

| | why |
|---|---|
| **the deadline** | neither the step limit nor the tool budget is a clock — see below |
| allowlist checked where tools run | registering a tool decides what is *advertised* |
| a withheld save still counted | `saveFailed` is gated on the count; an uncounted attempt is a claim with nothing to contradict it |
| tool budget, separate from step limit | the dictionary allows 30 req/min across everyone |
| seed interception | a resolved word is answered from the Worker's characters, never re-looked-up |
| repeat-call nudge | a weak model's most common failure, and the only rate-limit relief there is |
| `steps`, `stopped_by` | the framework produces none of the four stop reasons |
| `usage` | measured by callback, so a run that ends badly is still billed for what it spent |
| `answered_after_cap` | a run that spends every step on tools has no prose; ask again with tools withheld |

### The deadline

`AGENT_DEADLINE_S` (20s) **must stay below the Worker's
`AGENT_SERVICE_TIMEOUT_MS`** (25s). Two settings in two repositories that have to
move together.

Without it, the Worker gives up and degrades to the cards while this process
carries on — finishing model calls nobody will read, spending provider budget on
an abandoned request, and holding a Cloud Run instance that `max_instances: 2`
cannot spare.

It reports `stopped_by: "step_limit"`, never an error. An error tells the Worker
this failed *fast*, and the Worker answers a fast failure by running its own
loop — making the learner wait a second time for a turn that was already too
slow. A deadline is a completed turn that ran out of room.

Two things the HSK layer must keep doing, both measured, both in `hsk/project.py`:

- **Project hard.** One raw `hsk_build_study_set` reply is 27 kB — ~7,000 tokens
  for twenty words. The invariant pinned in the tests is the *shape* (only these
  fields, at most this many results), not the byte ratio.
- **Say "not in the list" out loud.** A model handed an empty result invents a
  definition; one handed the `found:false` note says the word is absent.

## Testing

`pytest` never touches the network. An autouse fixture pins `AI_PROVIDER` to the
scripted model and points the dictionary at `.invalid`, and `tests/test_safety.py`
asserts both — the mirror of `backend/test/safety.test.js`, added after a test run
called the real OpenAI API and came back with a 401.

Scripted conversations look like this:

```python
model = ScriptedChatModel(
    script=[
        calls("hsk_lookup", {"word": "银行"}),
        says("银行 is a bank."),
    ]
)
response = await run_turn(request, model=model, config=agent_config)
```

`delay_s` stalls each call, which is how the deadline and the Worker's timeout
get tested without paying a provider — and how to time the real edge path by
hand:

```bash
docker run --rm -p 8080:8080 -e AI_PROVIDER=scripted mydeck-agent:local
# then vary AGENT_DEADLINE_S and the model's delay to find where the path breaks
```

## Rate limit, still open

The public MCP endpoint allows **30 requests/minute per IP**, which is why the
Worker prefers a service binding. Cloud Run cannot use one, and has no stable
egress IP without Cloud NAT. The per-turn repeat cache in `state.py` reduces the
pressure; a shared-secret header plus a narrow Cloudflare rule on
`hsk-mcp.linsnotes.com` is the intended fix. Not built.
