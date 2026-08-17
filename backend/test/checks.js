/**
 * The logic worth protecting: the money path, the hard-constraint filter, and
 * the router. Everything else here is an LLM call and cannot be unit tested
 * meaningfully.
 *
 * Stdlib node:test — no framework, no fixtures. Run with `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseBudget } from "../src/utils/parseBudget.js";
import { enforceBudgetVerdict } from "../src/agents/budgetAgent.js";
import { filterViolatingCandidates } from "../src/agents/destinationAgent.js";
import { planRoute } from "../src/orchestrator/router.js";
import { normalisePreferences } from "../src/orchestrator/preferences.js";
import { pickNext } from "../src/graph/travelGraph.js";

// ── Money ────────────────────────────────────────────────────────────────────

test("parseBudget handles the units people actually write", () => {
  assert.deepEqual(parseBudget("1 lakh INR"), {
    amount: 100_000,
    currency: "INR",
  });
  assert.deepEqual(parseBudget("£1,500"), { amount: 1500, currency: "GBP" });
  assert.deepEqual(parseBudget("under 1500 pounds"), {
    amount: 1500,
    currency: "GBP",
  });
  assert.deepEqual(parseBudget("25k"), { amount: 25_000, currency: null });
  assert.deepEqual(parseBudget("2 crore"), {
    amount: 20_000_000,
    currency: null,
  });
});

test("parseBudget returns null rather than 0 when there is no amount", () => {
  // 0 would read as "a budget of nothing" and make every trip over budget.
  for (const input of ["mid-range", "budget", "", null, undefined, {}]) {
    assert.equal(parseBudget(input).amount, null);
  }
});

// ── The budget guarantee ─────────────────────────────────────────────────────

test("enforceBudgetVerdict overrides a model that claims it fits when it does not", () => {
  const result = enforceBudgetVerdict(
    { totalEstimate: 2100, currency: "GBP", withinBudget: true },
    { budgetAmount: 1500, budgetCurrency: "GBP" },
  );

  assert.equal(result.withinBudget, false, "must not accept the model's claim");
  assert.equal(result.overageAmount, 600);
});

test("enforceBudgetVerdict confirms a genuine fit", () => {
  const result = enforceBudgetVerdict(
    { totalEstimate: 1200, currency: "GBP", withinBudget: false },
    { budgetAmount: 1500, budgetCurrency: "GBP" },
  );

  assert.equal(result.withinBudget, true);
  assert.equal(result.overageAmount, 0);
});

test("enforceBudgetVerdict reports no verdict when no budget was stated", () => {
  const result = enforceBudgetVerdict(
    { totalEstimate: 4000, currency: "GBP", withinBudget: true },
    { budgetLevel: "luxury" },
  );

  // Without a budget there is nothing to exceed; false would be a lie.
  assert.equal(result.withinBudget, null);
  assert.equal(result.overageAmount, 0);
});

test("enforceBudgetVerdict parses a budget the extraction step left as text", () => {
  const result = enforceBudgetVerdict(
    { totalEstimate: 150_000, currency: "INR", withinBudget: true },
    { budgetAmount: "1 lakh INR" },
  );

  assert.equal(result.withinBudget, false);
  assert.equal(result.overageAmount, 50_000);
});

// ── Hard constraints ─────────────────────────────────────────────────────────

test("filterViolatingCandidates drops any candidate that fails a constraint", () => {
  const { kept, violations } = filterViolatingCandidates([
    {
      name: "Lisbon",
      constraintChecks: [{ kind: "region", verdict: "pass", reason: "Europe" }],
    },
    {
      name: "Marrakesh",
      constraintChecks: [
        { kind: "region", verdict: "fail", reason: "Africa, not Europe" },
      ],
    },
  ]);

  assert.deepEqual(
    kept.map((c) => c.name),
    ["Lisbon"],
  );
  assert.match(violations[0], /Marrakesh/);
});

test("filterViolatingCandidates keeps candidates with no checks recorded", () => {
  // No stated constraints means nothing to violate.
  const { kept } = filterViolatingCandidates([{ name: "Lisbon" }]);
  assert.equal(kept.length, 1);
});

// ── Routing ──────────────────────────────────────────────────────────────────

test("planRoute selects the agents each query shape needs", () => {
  // "5 days somewhere warm in Europe under £1500" — nothing known yet.
  assert.deepEqual(
    planRoute({
      preferences: { budgetAmount: 1500 },
      intent: {
        wantsDestinationIdeas: true,
        wantsItinerary: true,
        wantsBudget: true,
      },
    }),
    ["destination", "itinerary", "budget"],
  );

  // "Plan 4 days in Lisbon" — destination known, cost unmentioned. Budget still
  // runs, because a plan with no idea of its cost is half an answer.
  assert.deepEqual(
    planRoute({
      preferences: { destination: "Lisbon" },
      intent: { wantsItinerary: true },
    }),
    ["itinerary", "budget"],
  );

  // "How much would a week in Bali cost?" — no itinerary wanted.
  assert.deepEqual(
    planRoute({
      preferences: { destination: "Bali" },
      intent: { wantsBudget: true },
    }),
    ["budget"],
  );

  // "Where should I go for a warm February break?" — suggestions only.
  assert.deepEqual(
    planRoute({ preferences: {}, intent: { wantsDestinationIdeas: true } }),
    ["destination"],
  );
});

test("planRoute forces Destination in when nowhere is known", () => {
  // Itinerary cannot run without somewhere to go, whatever the classifier said.
  const route = planRoute({
    preferences: {},
    intent: { wantsDestinationIdeas: false, wantsItinerary: true },
  });

  assert.equal(route[0], "destination");
  assert.ok(route.indexOf("destination") < route.indexOf("itinerary"));
});

test("planRoute falls back to a full plan when intent is empty", () => {
  assert.deepEqual(planRoute({ preferences: {}, intent: {} }), [
    "destination",
    "itinerary",
    "budget",
  ]);
});

// ── Graph traversal ──────────────────────────────────────────────────────────

test("pickNext walks the route in order then falls through to synthesis", () => {
  const route = ["destination", "itinerary", "budget"];

  assert.equal(pickNext({ route, completed: [] }), "destination");
  assert.equal(pickNext({ route, completed: ["destination"] }), "itinerary");
  assert.equal(
    pickNext({ route, completed: ["destination", "itinerary"] }),
    "budget",
  );
  assert.equal(pickNext({ route, completed: route }), "synthesise");
});

test("pickNext sends an emptied route straight to synthesis", () => {
  // How a failed critical agent aborts the rest of the run.
  assert.equal(pickNext({ route: [], completed: ["destination"] }), "synthesise");
});

// ── Preference normalisation ─────────────────────────────────────────────────

test("normalisePreferences coerces budget text into a comparable number", () => {
  const prefs = normalisePreferences({ budgetAmount: "1 lakh INR" });
  assert.equal(prefs.budgetAmount, 100_000);
  assert.equal(prefs.budgetCurrency, "INR");
});

test("normalisePreferences discards invented constraint kinds", () => {
  const prefs = normalisePreferences({
    hardConstraints: [
      { kind: "region", value: "Europe" },
      { kind: "vibes", value: "cosy" },
    ],
  });

  assert.deepEqual(
    prefs.hardConstraints.map((c) => c.kind),
    ["region"],
  );
});
