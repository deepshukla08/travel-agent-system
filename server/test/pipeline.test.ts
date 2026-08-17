import test from "node:test";
import assert from "node:assert/strict";
import { parseRequest } from "../src/tools/parseRequest.js";
import { route } from "../src/tools/route.js";
import { buildPipeline } from "../src/graph/pipeline.js";
import { setGenerate, resetGenerate, type Generate } from "../src/agents/model.js";
import {
  BudgetResultSchema,
  DestinationResultSchema,
  ItineraryResultSchema,
} from "../src/schemas/index.js";

/**
 * Routing and whole-graph checks. The model is stubbed throughout, so the entire
 * orchestration layer is verified without spending a free-tier request.
 */

const justification =
  "Warm in May, inside Europe, walkable, with the food markets they asked for, and inside the stated budget.";

/** Returns schema-valid output for whichever agent is calling. */
function stubModel(overrides: {
  destinationCost?: number;
  budgetItems?: { label: string; cost: number }[];
  alternative?: { summary: string; changes: string[]; newTotal: number } | null;
  days?: number;
} = {}): Generate {
  const cost = overrides.destinationCost ?? 1200;
  const items = overrides.budgetItems ?? [{ label: "everything", cost: 1200 }];
  const dayCount = overrides.days ?? 5;

  return (async (schema, _prompt) => {
    const call = (data: unknown) => ({ data, model: "stub", ms: 1 });

    if (schema === DestinationResultSchema) {
      return call({
        suggestions: [
          {
            name: "Lisbon",
            country: "Portugal",
            justification,
            constraintChecks: [
              { kind: "climate", passes: true, reason: "22C in May" },
              { kind: "region", passes: true, reason: "Portugal is in Europe" },
              { kind: "maxBudget", passes: true, reason: "under 1500" },
            ],
            estimatedTotalCost: cost,
          },
        ],
      });
    }

    if (schema === ItineraryResultSchema) {
      return call({
        destination: "Lisbon",
        days: Array.from({ length: dayCount }, (_, i) => ({
          day: i + 1,
          title: `Day ${i + 1}`,
          morning: "Alfama walk",
          afternoon: "Tram 28",
          evening: "Fado dinner",
          travelNotes: "All within 20 minutes on foot",
          uncertain: i === 1,
          uncertaintyReason: i === 1 ? "Museum hours vary in low season" : null,
        })),
      });
    }

    if (schema === BudgetResultSchema) {
      return call({
        currency: "GBP",
        items,
        total: items.reduce((s, i) => s + i.cost, 0),
        alternative: overrides.alternative ?? null,
        assumptions: ["return flights from London"],
      });
    }

    // synthesize
    return call({ markdown: "# Your trip\n\nLooks good." });
  }) as Generate;
}

test.afterEach(() => resetGenerate());

// ── Routing decisions ────────────────────────────────────────────────────────

test("a cost-only question routes to Budget alone", () => {
  const text = "roughly what does a week in Rome cost?";
  assert.deepEqual(route(text, parseRequest(text)), ["budget"]);
});

test("a full planning request routes to all three in dependency order", () => {
  const text = "plan 5 days somewhere warm in Europe under £1500";
  assert.deepEqual(route(text, parseRequest(text)), [
    "destination",
    "itinerary",
    "budget",
  ]);
});

test("a where-only question routes to Destination alone", () => {
  const text = "where should I go for a warm February break?";
  assert.deepEqual(route(text, parseRequest(text)), ["destination"]);
});

test("the brief's own example routes to all three", () => {
  // Deliberately the exact wording from the brief. It says "somewhere" but never
  // "plan" or "cost", so phrasing alone would route it to Destination only — the
  // stated length and budget are what make it a full request.
  const text = "a five day trip somewhere warm in Europe for under £1500";
  assert.deepEqual(route(text, parseRequest(text)), [
    "destination",
    "itinerary",
    "budget",
  ]);
});

test("a known destination skips the Destination agent", () => {
  const text = "plan 4 days in Lisbon";
  assert.deepEqual(route(text, parseRequest(text)), ["itinerary", "budget"]);
});

test("routing never puts Itinerary before a destination is known", () => {
  const text = "plan a 5 day itinerary somewhere warm";
  const agents = route(text, parseRequest(text));
  assert.ok(agents.indexOf("destination") < agents.indexOf("itinerary"));
});

// ── Whole graph, model stubbed ───────────────────────────────────────────────

test("a cost-only query runs exactly one agent through the graph", async () => {
  setGenerate(stubModel());

  const out = await buildPipeline().invoke({
    request: "roughly what does a week in Rome cost?",
  });

  // The point of the exercise: an orchestrator, not a pipeline.
  assert.deepEqual(out.completed, ["budget"]);
  assert.equal(out.destination, null);
  assert.equal(out.itinerary, null);
  assert.ok(out.budget);
  assert.deepEqual(
    out.trace.map((t) => t.agent),
    ["budget"],
  );
});

test("a full request chains all three and accumulates state", async () => {
  setGenerate(stubModel());

  const out = await buildPipeline().invoke({
    request: "plan 5 days somewhere warm in Europe under £1500",
  });

  assert.deepEqual(out.completed, ["destination", "itinerary", "budget"]);
  assert.equal(out.destination?.suggestions[0]?.name, "Lisbon");
  assert.equal(out.itinerary?.days.length, 5);
  assert.equal(out.budget?.total, 1200);
  assert.equal(out.budget?.overBudget, false);
  assert.ok(out.answer.length > 0);

  // Attribution comes from the trace the audit log stores, not a reconstruction.
  assert.deepEqual(
    out.trace.map((t) => t.agent),
    ["destination", "itinerary", "budget"],
  );
  assert.ok(out.trace.every((t) => t.ok));
});

test("the trace appends rather than overwriting", async () => {
  setGenerate(stubModel());

  const out = await buildPipeline().invoke({
    request: "plan 5 days somewhere warm in Europe under £1500",
  });

  // Without an append reducer the last agent to finish would clobber the rest,
  // leaving one entry and no error.
  assert.equal(out.trace.length, 3);
});

test("a guard failure is recorded and the run still answers honestly", async () => {
  // Over budget with no alternative — guardBudget throws.
  setGenerate(
    stubModel({
      budgetItems: [{ label: "everything", cost: 2400 }],
      alternative: null,
    }),
  );

  const out = await buildPipeline().invoke({
    request: "plan 5 days somewhere warm in Europe under £1500",
  });

  const budgetTrace = out.trace.find((t) => t.agent === "budget");
  assert.equal(budgetTrace?.ok, false);
  assert.ok(budgetTrace?.guards.some((g) => /no cheaper alternative/.test(g)));

  // The earlier agents' work survives, and the run does not present a budget.
  assert.ok(out.destination);
  assert.ok(out.itinerary);
  assert.equal(out.budget, null);
  assert.ok(out.answer.length > 0);
});

test("an over-budget plan with an alternative is flagged, not hidden", async () => {
  setGenerate(
    stubModel({
      budgetItems: [{ label: "everything", cost: 2100 }],
      alternative: {
        summary: "shoulder season",
        changes: ["travel in May"],
        newTotal: 1400,
      },
    }),
  );

  const out = await buildPipeline().invoke({
    request: "plan 5 days somewhere warm in Europe under £1500",
  });

  assert.equal(out.budget?.overBudget, true);
  assert.equal(out.budget?.overage, 600);
  assert.ok(out.budget?.alternative);
});

test("every failing agent still produces an answer explaining what is missing", async () => {
  setGenerate((async () => {
    throw new Error("model unavailable");
  }) as Generate);

  const out = await buildPipeline().invoke({
    request: "plan 5 days somewhere warm in Europe under £1500",
  });

  assert.ok(out.trace.every((t) => !t.ok));
  assert.match(out.answer, /could not build a plan/i);
});
