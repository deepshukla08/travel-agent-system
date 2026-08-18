# Trip Planner — multi-agent

A user describes a trip in plain language. An orchestrator decides which of three specialised
agents the request needs, chains them where one depends on another, and synthesises one answer.

**Live:** https://travel-agent-system-deep-shukla-s-projects.vercel.app
**API:** https://trip-planner-api-4wee.onrender.com/health

> Free hosting, so two things to expect: the API sleeps after 15 minutes and the **first request
> takes ~50s to wake it**, and free Gemini allows roughly 20 requests per day per model. See
> [Free-tier notes](#free-tier-notes).

```
"five days somewhere warm in Europe for under £1500"  →  Destination → Itinerary → Budget
"roughly what does a week in Rome cost?"              →  Budget only
"where should I go for a warm February break?"        →  Destination only
```

## The agents

| Agent | Role | Constraint, and how it is enforced |
|---|---|---|
| **Destination** | Suggests places fitting the stated preferences | Any suggestion failing a hard constraint is **dropped in code**; the budget check is re-verified by arithmetic, not trusted |
| **Itinerary** | Day-by-day plan, realistic on travel time | `uncertain` is a **required field** per day; a day flagged uncertain with no reason is corrected |
| **Budget** | Total cost, checked against the budget | The total is **recomputed from the line items**; over budget with no alternative fails the agent |

The behavioural rules are enforced in [`server/src/agents/guards.ts`](server/src/agents/guards.ts),
not asked for in prompts. A prompt is a request; arithmetic is a guarantee. Guard messages are
stored per run and shown in the UI under "Checks that changed the answer".

## Running it

Node 20+ and a free [Google AI Studio key](https://aistudio.google.com/apikey).

```bash
# API
cd server
cp .env.example .env      # add GOOGLE_API_KEY
npm install
npm run dev               # http://localhost:3000

# Web, in another terminal
cd web
npm install
npm run dev               # http://localhost:5173
```

`web/.env` is optional locally — it falls back to `http://localhost:3000`.

## Checks

```bash
cd server
npm test                  # 77 checks, model stubbed, costs nothing
npm run typecheck         # covers src/ and test/
cd ../web && npm run build
```

The model is stubbed throughout, so the whole orchestration layer is verifiable for free. Worth
looking at: `test/guards.test.ts` feeds each agent a deliberately non-compliant response and
asserts the guard catches it; `test/pipeline.test.ts` asserts a cost-only query invokes **exactly
one** agent, and that the replan cycle terminates.

## Layout

```
server/src/
  config.ts          every env var and model name
  api/               thin HTTP handlers — plan.ts streams SSE, runs.ts is the audit log
  schemas/           zod, once — TS types and the model contract derive from the same source
  tools/             DETERMINISTIC. parseRequest.ts and route.ts never call a model
  agents/            the units that think. always a model call
    guards.ts        the three behavioural constraints, enforced
    prompts/*.md     editable without touching TypeScript
  graph/             state.ts, pipeline.ts — routing is a conditional edge
  storage/           SQLite, two tables
web/src/
  lib/types.ts       every shape; components import types from here only
  lib/api.ts         every network call, incl. a hand-rolled SSE reader (EventSource can't POST)
  components/
```

## How it works

1. **`parse`** — deterministic. Pulls out origin, destination, length, party size, budget and hard
   constraints. No model call, which is what makes routing testable. If there is nothing to plan
   from, it returns questions instead — asking costs zero model calls, guessing costs four.
2. **`route`** — a conditional edge picks the agents needed, in dependency order. The compiled
   graph records which agents ran, so the audit trail and the "which agents contributed" display
   come free.
3. **Agents** — pure `(state) => Partial<State>`. They return data; the API layer persists it.
   Output is schema-enforced with Gemini's `responseJsonSchema`, so malformed output fails at the
   boundary rather than three nodes downstream.
4. **Replan** — the one backwards edge. The Budget Agent holds the only itemised cost in the
   system, and it runs last. If a trip *we* chose the length for prices far off the budget, it
   goes back to be rebuilt at the length that number affords, then re-priced. One lap, and never
   when the traveller stated a length.
5. **`synthesize`** — writes the answer from agent output only, and is told explicitly to lead
   with an overage and carry uncertainties through.

A full plan is four model calls, six with a replan. Each node emits an SSE event, so the page
shows routing and agent activity live: `plan` (the routing decision), one `agent` per agent that
finishes, `token` for each piece of the answer as synthesis writes it, then `done` with the
stored run. Add `?debug` to the URL to log graph state to the browser console.

## Free-tier notes

Free Gemini allows roughly 20 requests per day **per model**. `config.modelChain` is walked on 429
(daily quota gone — that model is struck off for the process) and on 503 (contended — try the
next). A retired model returns 400 rather than a 5xx, which is handled separately. The model that
served each call is recorded on its audit row, and in practice a single run is often served by
three different models.

Render's free tier idles out, so the first request after a pause takes ~50s to wake.

Run history lives in SQLite on local disk, which is ephemeral on free hosts — it resets on
redeploy. See the note in `storage/runs.ts` for the upgrade path.

## Notes

- [`DECISIONS.md`](DECISIONS.md) — the three biggest decisions, and what was cut
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — deploying and scaling this on Azure

Auth is an `x-user-role: admin` header stub that reveals guard counts in the run log. It is
forgeable by design — it marks where the boundary goes without building enterprise identity.
