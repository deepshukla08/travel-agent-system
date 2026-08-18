# Decision note

## 1. Behavioural constraints are enforced in code, not requested in prompts

The brief gives each agent a behavioural rule. A prompt saying "never exceed the budget" is a
request; arithmetic that checks is a guarantee. All three live in `agents/guards.ts`:

- **Budget** — the total is recomputed from the line items, overruling the model's own `total`.
  Over budget with no alternative throws, and the run reports the failure rather than the plan.
- **Destination** — any suggestion failing its constraint checks is dropped, and the budget check
  is re-verified by arithmetic rather than trusted, catching an optimistic estimate too.
- **Itinerary** — `uncertain` is a required schema field; a day flagged without a reason is
  corrected.

Guard messages are stored per agent run and rendered in the UI, so "where was the model
overruled" is a column, not an inference.

## 2. Deterministic parsing and routing, no model involved

`tools/` never calls a model. Turning "under £1500" into `{currency:"GBP", max:1500}` is a regex,
not a judgment. That keeps routing unit-testable: a check asserts "roughly what does a week in
Rome cost?" invokes exactly one agent — impossible if a model decided it.

## 3. LangGraph — routing as an edge, and one edge backwards

Routing is a conditional edge rather than if-statements in a node, so the compiled graph encodes
which agents can run, and `completed` doubles as the audit trail and attribution display.

The graph has one cycle. The Destination Agent sets trip length but has no cost model: it
estimated 850,000 for a trip the Budget Agent itemised at 560,000, then 850,000 for one costing
1,110,000. Only the Budget Agent holds a costed total, and it runs last — so the first pass is
really a measurement. A trip whose length *we* chose is rebuilt at the length that number
affords, then re-priced. One lap, never when the traveller stated a length.

## Cut deliberately

- **SQLite over a hosted database.** Two tables, nothing to provision. The free host's disk is
  ephemeral, so history resets on redeploy; upgrade path is Postgres, same schema.
- **Auth is an `x-user-role` header stub.** Forgeable by design — it marks where the boundary goes.
- **No RAG.** The context fits in a prompt; retrieval would be cargo-culting.
- **No chat.** An earlier version carried conversation state and nearly every defect lived there.
  One request, one trip.
