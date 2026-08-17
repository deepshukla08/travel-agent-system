# Decision note

## 1. Behavioural constraints are enforced in code, not requested in prompts

The brief gives each agent a behavioural rule. A prompt saying "never exceed the budget" is a
request; arithmetic that checks is a guarantee. All three rules live in
[`server/src/agents/guards.ts`](server/src/agents/guards.ts):

- **Budget** — the total is recomputed from the line items, so the model's own `total` is
  overruled when it disagrees. Over budget with no alternative throws `AgentError` and the run
  reports the failure rather than presenting the plan.
- **Destination** — any suggestion whose constraint checks fail is dropped, and the budget check
  is re-verified by arithmetic rather than trusted, so an optimistic cost estimate is caught too.
- **Itinerary** — `uncertain` is a required schema field, and a day flagged uncertain without a
  reason is corrected rather than surfaced as an unexplained warning.

Guard messages are stored per agent run and rendered in the UI, so "where was the model
overruled" is a column, not an inference. This is the part I would demo first.

## 2. Deterministic parsing and routing, with no model involved

`tools/` never calls a model. Turning "under £1500" into `{currency:"GBP", max:1500}` is a regex
and a lookup, not a judgment. That keeps routing unit-testable: the checks assert that "roughly
what does a week in Rome cost?" invokes **exactly one** agent, which would be impossible to
assert if a model decided it. Splitting `tools/` from `agents/` is also what stops the system
collapsing into one large prompt.

## 3. LangGraph with routing as a conditional edge

Routing is an edge, not if-statements inside a node, so the compiled graph encodes which agents
can run and `completed` doubles as the audit trail and the attribution display. `trace` uses an
append reducer — without one, the last agent to finish would silently clobber the others.

## Cut deliberately

- **SQLite over a hosted database.** Two tables, no service to provision. The free host's disk is
  ephemeral, so history resets on redeploy; the upgrade path is Postgres with the same schema.
- **Auth is an `x-user-role` header stub.** Forgeable by design — it marks where the boundary
  goes without building enterprise identity.
- **No RAG or vector store.** The whole context fits in a prompt; retrieval here would be
  cargo-culting.
- **No visual polish, no token-level streaming.** Per-node SSE events already make the
  orchestration visible, which is the point.
