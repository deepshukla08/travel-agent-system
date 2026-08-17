import test from "node:test";
import assert from "node:assert/strict";
import {
  guardBudget,
  guardDestination,
  guardItinerary,
  AgentError,
} from "../src/agents/guards.js";
import { parseRequest } from "../src/tools/parseRequest.js";
import type {
  BudgetResult,
  Constraints,
  DestinationResult,
  ItineraryResult,
} from "../src/schemas/index.js";

/**
 * The guard checks. Each feeds a deliberately non-compliant model response and
 * asserts the guard catches it — this is the demo that answers "how do you stop
 * it hallucinating?".
 */

const constraints: Constraints = parseRequest(
  "5 days somewhere warm in Europe under £1500",
);

const longEnough =
  "Warm in May, inside Europe, and walkable with the food markets they asked for, comfortably inside the stated budget.";

// ── Budget ───────────────────────────────────────────────────────────────────

test("budget guard rejects an over-budget plan with no alternative", () => {
  const result: BudgetResult = {
    currency: "GBP",
    items: [
      { label: "flights", cost: 700 },
      { label: "hotel", cost: 900 },
      { label: "food", cost: 300 },
    ],
    total: 1900,
    alternative: null, // the violation
    assumptions: [],
  };

  assert.throws(
    () => guardBudget(result, constraints),
    (err: unknown) =>
      err instanceof AgentError && /no cheaper alternative/.test(err.message),
  );
});

test("budget guard recomputes a total the model got wrong", () => {
  const result: BudgetResult = {
    currency: "GBP",
    items: [
      { label: "flights", cost: 400 },
      { label: "hotel", cost: 500 },
    ],
    total: 700, // model understated it by 200
    alternative: null,
    assumptions: [],
  };

  const { value, fired } = guardBudget(result, constraints);

  assert.equal(value.total, 900, "arithmetic wins, not the model's claim");
  assert.equal(value.overBudget, false);
  assert.ok(fired.some((f) => /total corrected/.test(f)));
});

test("budget guard flags the overage when an alternative is present", () => {
  const result: BudgetResult = {
    currency: "GBP",
    items: [{ label: "everything", cost: 2100 }],
    total: 2100,
    alternative: {
      summary: "shoulder season",
      changes: ["travel in May instead of August"],
      newTotal: 1400,
    },
    assumptions: [],
  };

  const { value, fired } = guardBudget(result, constraints);

  assert.equal(value.overBudget, true);
  assert.equal(value.overage, 600);
  assert.ok(fired.some((f) => /over budget by 600/.test(f)));
});

test("budget guard notes an alternative that still does not fit", () => {
  const result: BudgetResult = {
    currency: "GBP",
    items: [{ label: "everything", cost: 3000 }],
    total: 3000,
    alternative: {
      summary: "cheaper hotel",
      changes: ["hostel"],
      newTotal: 2000, // still over 1500
    },
    assumptions: [],
  };

  const { fired } = guardBudget(result, constraints);
  assert.ok(fired.some((f) => /alternative still over budget/.test(f)));
});

test("budget guard gives no verdict when no budget was stated", () => {
  const noBudget = parseRequest("plan 5 days in Lisbon");
  const result: BudgetResult = {
    currency: "GBP",
    items: [{ label: "everything", cost: 5000 }],
    total: 5000,
    alternative: null,
    assumptions: [],
  };

  // Nothing to exceed, so this must not throw and must not claim over-budget.
  const { value } = guardBudget(result, noBudget);
  assert.equal(value.overBudget, false);
  assert.equal(value.overage, 0);
});

// ── Destination ──────────────────────────────────────────────────────────────

test("destination guard drops a suggestion that breaks a hard constraint", () => {
  const result: DestinationResult = {
    suggestions: [
      {
        name: "Reykjavik",
        country: "Iceland",
        justification: longEnough,
        constraintChecks: [
          { kind: "climate", passes: false, reason: "cold in May" },
        ],
        estimatedTotalCost: 1200,
      },
      {
        name: "Lisbon",
        country: "Portugal",
        justification: longEnough,
        constraintChecks: [
          { kind: "climate", passes: true, reason: "22C in May" },
        ],
        estimatedTotalCost: 1200,
      },
    ],
  };

  const { value, fired } = guardDestination(result, constraints);

  assert.deepEqual(
    value.suggestions.map((s) => s.name),
    ["Lisbon"],
  );
  assert.ok(fired.some((f) => /dropped Reykjavik/.test(f)));
});

test("destination guard independently rejects a suggestion over budget", () => {
  const result: DestinationResult = {
    suggestions: [
      {
        name: "Maldives",
        country: "Maldives",
        justification: longEnough,
        // The model claims it passes the budget check. Arithmetic disagrees.
        constraintChecks: [
          { kind: "maxBudget", passes: true, reason: "affordable" },
        ],
        estimatedTotalCost: 4000,
      },
    ],
  };

  assert.throws(
    () => guardDestination(result, constraints),
    (err: unknown) =>
      err instanceof AgentError &&
      /no destination satisfies/.test(err.message),
  );
});

test("destination guard rejects a justification too thin to defend", () => {
  const result: DestinationResult = {
    suggestions: [
      {
        name: "Lisbon",
        country: "Portugal",
        justification: "Nice city.", // marketing copy, not an argument
        constraintChecks: [],
        estimatedTotalCost: 1200,
      },
    ],
  };

  assert.throws(() => guardDestination(result, constraints), AgentError);
});

// ── Itinerary ────────────────────────────────────────────────────────────────

function day(overrides: Partial<ItineraryResult["days"][number]> = {}) {
  return {
    day: 1,
    title: "Arrival",
    morning: "land",
    afternoon: "walk",
    evening: "dinner",
    travelNotes: "20 min metro from the airport",
    uncertain: false,
    uncertaintyReason: null,
    ...overrides,
  };
}

test("itinerary guard fills a reason when a day is flagged uncertain silently", () => {
  const result: ItineraryResult = {
    destination: "Lisbon",
    days: [
      day({ day: 1 }),
      day({ day: 2, uncertain: true, uncertaintyReason: null }), // the violation
      day({ day: 3 }),
      day({ day: 4 }),
      day({ day: 5 }),
    ],
  };

  const { value, fired } = guardItinerary(result, constraints);

  assert.ok(fired.some((f) => /day 2: uncertain with no reason/.test(f)));
  assert.ok(
    value.days[1]?.uncertaintyReason,
    "must not surface a warning with no explanation",
  );
});

test("itinerary guard rejects the wrong number of days", () => {
  const result: ItineraryResult = {
    destination: "Lisbon",
    days: [day({ day: 1 }), day({ day: 2 })], // asked for 5
  };

  assert.throws(
    () => guardItinerary(result, constraints),
    (err: unknown) =>
      err instanceof AgentError && /asked for 5 days, returned 2/.test(err.message),
  );
});

test("itinerary guard notes a day with no travel reasoning", () => {
  const result: ItineraryResult = {
    destination: "Lisbon",
    days: [
      day({ day: 1, travelNotes: "  " }), // blank
      day({ day: 2 }),
      day({ day: 3 }),
      day({ day: 4 }),
      day({ day: 5 }),
    ],
  };

  const { fired } = guardItinerary(result, constraints);
  assert.ok(fired.some((f) => /day 1: no travel\/sequencing notes/.test(f)));
});
