import test from "node:test";
import assert from "node:assert/strict";
import { parseRequest } from "../src/tools/parseRequest.js";
import { route } from "../src/tools/route.js";
import { buildPipeline } from "../src/graph/pipeline.js";
import { agentsIn, isSchema } from "./support.js";
import { guardDestination } from "../src/agents/guards.js";
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

  return (async (schema) => {
    const call = (data: unknown) => ({ data, model: "stub", ms: 1 });


    if (isSchema(schema, DestinationResultSchema)) {
      return call({
        suggestions: [
          {
            name: "Lisbon",
            country: "Portugal",
            legs: [{ place: "Lisbon", nights: 5, note: "one base" }],
            suggestedDays: 5,
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

    if (isSchema(schema, ItineraryResultSchema)) {
      return call({
        destination: "Lisbon",
        days: Array.from({ length: dayCount }, (_, i) => ({
          day: i + 1,
          title: `Day ${i + 1}`,
          morning: "Alfama walk",
          afternoon: "Tram 28",
          evening: "Fado dinner",
          travelNotes: "All within 20 minutes on foot",
          estimatedSpend: 40,
          uncertain: i === 1,
          uncertaintyReason: i === 1 ? "Museum hours vary in low season" : null,
        })),
      });
    }

    if (isSchema(schema, BudgetResultSchema)) {
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

/**
 * Routing is deterministic and free, so it can be asserted exhaustively from the
 * request text — which is the whole reason the brief puts it in tools/ rather than
 * in an agent. You can never unit-test a model's choice.
 */
test("each request shape calls exactly the agents it needs", () => {
  const cases: [string, string[]][] = [
    // The brief's own example: nothing known, so all three.
    [
      "A five day trip somewhere warm in Europe for under £1500",
      ["destination", "itinerary", "budget"],
    ],
    // Destination named, so that agent is skipped.
    ["4 days in Lisbon from London for 2 people, around £900", ["itinerary", "budget"]],
    ["plan 3 days in Udaipur from Ahmedabad under 20000 INR", ["itinerary", "budget"]],
    ["i wanna go to udaipur for 3 days", ["itinerary", "budget"]],
    // A cost question wants a price, not a plan — the brief's "only one agent".
    ["roughly what does a week in Rome cost?", ["budget"]],
    ["how much would 5 days in Tokyo cost?", ["budget"]],
    // Browsing wants suggestions, nothing more.
    ["where should I go for a warm February break?", ["destination"]],
    // Stating a trip alongside "where should I go" is planning, not browsing.
    [
      "where should I go for 5 days on £900?",
      ["destination", "itinerary", "budget"],
    ],
  ];

  for (const [text, want] of cases) {
    assert.deepEqual(route(text, parseRequest(text)), want, text);
  }
});

test("routing never puts Itinerary before a destination is known", () => {
  const text = "plan a 5 day itinerary somewhere warm";
  const agents = route(text, parseRequest(text));

  // The dependency is code's to enforce: Itinerary needs somewhere to go.
  assert.ok(agents.indexOf("destination") < agents.indexOf("itinerary"));
});

test("a request with nothing to plan from asks instead of guessing", async () => {
  let calls = 0;
  setGenerate((async () => {
    calls++;
    throw new Error("the model must not be called for an unanswerable request");
  }) as Generate);

  const out = await buildPipeline().invoke({ request: "plan me a holiday" });

  assert.equal(calls, 0, "asking is free — no model call may happen");
  assert.deepEqual(out.route, [], "no agent may run");
  assert.deepEqual(out.completed, []);

  // Assert the structured questions, not the prose — the copy is presentation and
  // will be reworded; the field contract is what the form is built from. Nothing at
  // all was given here, so all four are genuinely unknown.
  assert.deepEqual(
    out.needs.map((n) => n.id),
    ["from", "where", "days", "budget"],
  );
  assert.ok(out.needs.every((n) => n.label && n.hint));
  assert.ok(out.answer.length > 0, "there is still something to read");
});

test("the form asks only what the message did not already say", async () => {
  setGenerate(stubModel());

  // "from ahmedabad for 4 days" answers two of the four. Asking all four back was
  // the bug: it reads as not having listened.
  const out = await buildPipeline().invoke({
    request: "hi plan me a trip from ahmedabad for 4 days",
  });

  assert.deepEqual(
    out.needs.map((n) => n.id),
    ["where", "budget"],
  );
  assert.equal(out.constraints?.origin, "ahmedabad", "kept, not re-asked");
  assert.equal(out.constraints?.days, 4, "kept, not re-asked");
});

test("the form is asked once — blank answers plan rather than re-ask", async () => {
  setGenerate(stubModel());

  // Coming back from the form having filled in nothing is an answer: "you choose".
  // Asking the same four questions again left the page with no way forward at all.
  const out = await buildPipeline().invoke({
    request: "Plan a trip",
    answers: { from: "", where: "", days: "", budget: "" },
  });

  assert.deepEqual(out.needs, [], "the questions may not be put twice");
  assert.ok(
    out.route.includes("destination"),
    "with nowhere settled, the agent that picks somewhere must run",
  );
});

test("one usable signal is enough to proceed rather than interrogate", async () => {
  setGenerate(stubModel());

  // "somewhere warm" gives no destination and no length, but a climate constraint
  // is something the Destination Agent can genuinely work from.
  const out = await buildPipeline().invoke({ request: "somewhere warm" });

  assert.deepEqual(out.needs, []);
  assert.ok(out.route.includes("destination"));
});

test("with no length stated, the Destination Agent's judgement sets it", async () => {
  // Ten days on a large budget used to become a silent five-day trip: the planner
  // defaulted without consulting the agent that knows the destination and budget.
  const agents = stubModel({ days: 10 });

  setGenerate((async (schema, promptText, onToken) => {
    if (isSchema(schema, DestinationResultSchema)) {
      return {
        data: {
          suggestions: [
            {
              name: "Thailand",
              country: "Thailand",
              legs: [
                { place: "Bangkok", nights: 4, note: "arrival, temples, markets" },
                { place: "Chiang Mai", nights: 3, note: "1h flight north" },
                { place: "Krabi", nights: 3, note: "1.5h flight south, beaches" },
              ],
              suggestedDays: 10,
              justification,
              constraintChecks: [],
              estimatedTotalCost: 150_000,
            },
          ],
        },
        model: "stub",
        ms: 1,
      };
    }
    return agents(schema, promptText, onToken);
  }) as Generate);

  const out = await buildPipeline().invoke({
    request: "Plan a trip from Ahmedabad on a budget of 200000 INR",
  });

  assert.equal(out.itinerary?.days.length, 10, "the agent's length is used, not 5");

  const itinerary = out.trace.find((t) => t.agent === "itinerary");
  assert.ok(
    itinerary?.guards.some((g) => /to suit the destination and budget/.test(g)),
    "and the choice is disclosed rather than silent",
  );
});

test("a long trip is planned across several bases", async () => {
  const suggestion = {
    name: "Thailand",
    country: "Thailand",
    legs: [
      { place: "Bangkok", nights: 4, note: "arrival" },
      { place: "Chiang Mai", nights: 3, note: "1h flight" },
      { place: "Krabi", nights: 3, note: "1.5h flight" },
    ],
    suggestedDays: 10,
    justification,
    constraintChecks: [],
    estimatedTotalCost: 150_000,
  };

  const { value, fired } = guardDestination(
    { suggestions: [suggestion] },
    { ...parseRequest("10 days from Ahmedabad on 200000 INR"), days: 10 },
  );

  assert.equal(value.suggestions[0]?.legs.length, 3, "a route, not one city");
  assert.ok(!fired.some((f) => /legs total/.test(f)), "and the nights add up");
});

test("legs that do not add up to the trip are flagged", () => {
  // 4 + 3 = 7 nights offered for a 10-day trip. The itinerary cannot allocate days
  // across that, so the mismatch is recorded and the stated length wins.
  const { fired } = guardDestination(
    {
      suggestions: [
        {
          name: "Thailand",
          country: "Thailand",
          legs: [
            { place: "Bangkok", nights: 4, note: "n" },
            { place: "Chiang Mai", nights: 3, note: "n" },
          ],
          suggestedDays: 10,
          justification,
          constraintChecks: [],
          estimatedTotalCost: 150_000,
        },
      ],
    },
    { ...parseRequest("10 days from Ahmedabad"), days: 10 },
  );

  assert.ok(fired.some((f) => /legs total 7 nights against a 10-day trip/.test(f)));
});

test("a plan that overshoots its allowance is noted, not forced to fit", async () => {
  // Each stubbed day costs 40; the trip has a £120 activity allowance (40% of 300
  // across 5 days is 24/day), so 200 total overshoots it.
  setGenerate(stubModel());

  const out = await buildPipeline().invoke({
    request: "plan 5 days in Lisbon under £300",
  });

  const itinerary = out.trace.find((t) => t.agent === "itinerary");
  assert.ok(
    itinerary?.guards.some((g) => /against roughly \d+ available/.test(g)),
    "the overshoot is surfaced",
  );

  // Noted, not enforced: the plan still stands, and the Budget Agent prices the
  // real thing. Forcing a fit here is the dishonesty the budget guard prevents.
  assert.ok(out.itinerary, "the itinerary is not rejected for being expensive");
});

test("an inferred trip length is disclosed, not silently invented", async () => {
  setGenerate(stubModel());

  const out = await buildPipeline().invoke({ request: "plan a trip to Lisbon" });

  const itinerary = out.trace.find((t) => t.agent === "itinerary");
  assert.ok(
    itinerary?.guards.some((g) => /assumed a \d+-day trip/.test(g)),
    "a length the user never gave must be surfaced as an assumption",
  );
});

test("the destination the agent chooses becomes part of the constraints", async () => {
  setGenerate(stubModel());

  const out = await buildPipeline().invoke({
    request: "5 days somewhere warm in Europe under £1500",
  });

  // The choice has to land in constraints, not just in the agent's own output —
  // that is what the next turn loads. Without it, a trip to Lisbon was re-chosen
  // from scratch on the following message and became somewhere else.
  assert.equal(out.constraints?.destination, "Lisbon");
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
    agentsIn(out.trace),
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
    agentsIn(out.trace),
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
  assert.equal(agentsIn(out.trace).length, 3);
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

  // Every agent failed, and each one is still on the trace — a failed agent that
  // leaves no row is not an audit trail.
  assert.ok(out.trace.length > 0);
  assert.ok(out.trace.every((t) => !t.ok));
  assert.match(out.answer, /could not build a plan/i);
});


// ── The replan loop ──────────────────────────────────────────────────────────

/**
 * A stub whose itinerary follows the day count it is asked for and whose budget
 * prices it at a flat rate per day.
 *
 * That is the whole mechanism under test: the Budget Agent's itemised total is
 * the only real per-day cost in the system, so a trip planned too short prices
 * too low, and the replan reads the length back out of that number.
 */
function pricePerDay(rate: number): Generate {
  return (async (schema, promptText: string) => {
    const call = (data: unknown) => ({ data, model: "stub", ms: 1 });
    // Read straight out of the prompt the agent built, so a reworded prompt fails
    // here loudly rather than silently returning the wrong length.
    const asked = Number(/Produce exactly (\d+) days/.exec(promptText)?.[1] ?? 0);

    if (isSchema(schema, DestinationResultSchema)) {
      return call({
        suggestions: [
          {
            name: "Lisbon",
            country: "Portugal",
            legs: [
              { place: "Lisbon", nights: 3, note: "one base" },
              { place: "Porto", nights: 2, note: "train, 3 hours" },
            ],
            suggestedDays: 5,
            justification,
            constraintChecks: [],
            estimatedTotalCost: 3800,
          },
        ],
      });
    }

    if (isSchema(schema, ItineraryResultSchema)) {
      const days = asked || 5;
      return call({
        destination: "Lisbon",
        days: Array.from({ length: days }, (_, i) => ({
          day: i + 1,
          title: `Day ${i + 1}`,
          morning: "m",
          afternoon: "a",
          evening: "e",
          travelNotes: "walkable",
          estimatedSpend: 40,
          uncertain: false,
          uncertaintyReason: null,
        })),
      });
    }

    if (isSchema(schema, BudgetResultSchema)) {
      // Prices whatever the itinerary just produced, at a flat daily rate.
      const days = [...promptText.matchAll(/^Day (\d+) —/gm)].length;
      const priced = (days || 5) * rate;
      return call({
        currency: "GBP",
        items: [{ label: "everything", cost: priced }],
        total: priced,
        // Always offered, as the real agent is required to: over budget with no
        // alternative throws, and a failed Budget Agent leaves no total to
        // replan from.
        alternative: { summary: "hostels", changes: ["share a room"], newTotal: priced / 2 },
        assumptions: [],
      });
    }

    return call({ markdown: "# Your trip" });
  }) as Generate;
}

test("a trip priced far under an unstated-length budget is replanned longer", async () => {
  // 5 days at 400/day = 2000 against a 4000 budget. The Destination Agent guessed
  // 3800; only the Budget Agent's 2000 is itemised, so that is what sets the length.
  setGenerate(pricePerDay(400));

  const out = await buildPipeline().invoke({
    request: "plan a trip from London on a budget of 4000 GBP",
  });

  assert.deepEqual(agentsIn(out.trace), [
    "destination",
    "itinerary",
    "budget",
    "itinerary",
    "budget",
  ]);

  // 4000 * 0.9 / 400 = 9 days, and the total follows the longer trip.
  assert.equal(out.itinerary?.days.length, 9);
  assert.equal(out.budget?.total, 3600);
  assert.equal(out.budget?.verdict, "within");

  const note = out.trace.flatMap((t) => t.guards).find((g) => /re-planned/.test(g));
  assert.ok(note, "the revised length is disclosed, not silently applied");
});

test("the replan loop runs at most one lap", async () => {
  // Priced at 1/day, so every pass leaves the budget almost untouched. The graph
  // must still terminate — an unbounded cycle is the failure mode of a feedback
  // edge, and MAX_DAYS caps the length regardless of what the arithmetic asks for.
  setGenerate(pricePerDay(1));

  const out = await buildPipeline().invoke({
    request: "plan a trip from London on a budget of 4000 GBP",
  });

  assert.equal(agentsIn(out.trace).filter((a) => a === "itinerary").length, 2);
  assert.ok(out.itinerary!.days.length <= 21);
});

test("a stated trip length is never replanned", async () => {
  // 5 days at 400 is 2000 of a 4000 budget — the same gap as above. But they said
  // five days, and a stated length is a decision, not a gap to fill.
  setGenerate(pricePerDay(400));

  const out = await buildPipeline().invoke({
    request: "plan 5 days in Lisbon from London on a budget of 4000 GBP",
  });

  assert.deepEqual(agentsIn(out.trace), ["itinerary", "budget"]);
  assert.equal(out.itinerary?.days.length, 5);
});

test("a trip priced over an unstated-length budget is replanned shorter", async () => {
  // The mirror case, and the more important one: 5 days at 1000/day is 5000 on a
  // 4000 budget. Nobody asked for five days — we chose them — so shortening the
  // trip is honest, where trimming the costs of a five-day trip would not be.
  setGenerate(pricePerDay(1000));

  const out = await buildPipeline().invoke({
    request: "plan a trip from London on a budget of 4000 GBP",
  });

  // 4000 * 0.9 / 1000 = 3 days at 3000, which fits.
  assert.equal(out.itinerary?.days.length, 3);
  assert.equal(out.budget?.verdict, "within");
  assert.equal(out.budget?.total, 3000);
});
