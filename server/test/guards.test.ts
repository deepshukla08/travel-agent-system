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

test("budget guard flags a flight priced from nowhere", () => {
  // The real failure this came from: the model returned "Flights (Return from UK
  // to Tenerife)" for a traveller who never said where they start. Flights are the
  // biggest line, so an unstated origin makes the total a guess.
  const result: BudgetResult = {
    currency: "GBP",
    items: [
      { label: "Flights (Return from UK)", cost: 150 },
      { label: "hotel", cost: 400 },
    ],
    total: 550,
    alternative: null,
    assumptions: [],
  };

  const { fired } = guardBudget(result, constraints);
  assert.ok(
    fired.some((f) => /without a stated departure point/.test(f)),
    "an invented origin must not pass silently",
  );
});

test("budget guard stays quiet about flights once an origin is known", () => {
  const withOrigin = { ...constraints, origin: "Ahmedabad" };
  const result: BudgetResult = {
    currency: "GBP",
    items: [{ label: "Flights", cost: 150 }],
    total: 150,
    alternative: null,
    assumptions: [],
  };

  const { fired } = guardBudget(result, withOrigin);
  assert.ok(!fired.some((f) => /departure point/.test(f)));
});

test("no stated budget yields 'unstated', never 'within'", () => {
  // The UI read !overBudget as "within budget" and announced that a 18,500 INR
  // trip fitted a budget the traveller had never given.
  const noBudget = parseRequest("plan 5 days in Jaipur");
  const result: BudgetResult = {
    currency: "INR",
    items: [{ label: "everything", cost: 18_500 }],
    total: 18_500,
    alternative: null,
    assumptions: [],
  };

  const { value } = guardBudget(result, noBudget);
  assert.equal(value.verdict, "unstated");
  assert.notEqual(value.verdict, "within", "nothing to be within");
});

test("the three budget verdicts are distinct", () => {
  const priced = (cost: number): BudgetResult => ({
    currency: "GBP",
    items: [{ label: "everything", cost }],
    total: cost,
    alternative: { summary: "s", changes: ["c"], newTotal: 1 },
    assumptions: [],
  });

  assert.equal(guardBudget(priced(1200), constraints).value.verdict, "within");
  assert.equal(guardBudget(priced(2100), constraints).value.verdict, "over");
  assert.equal(
    guardBudget(priced(2100), parseRequest("plan 5 days in Jaipur")).value.verdict,
    "unstated",
  );
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

test("budget guard flags a plan that spends a fraction of the budget", () => {
  // The real failure: 100,000 INR from Ahmedabad came back as a 37,000 INR bus
  // trip to Udaipur, labelled "within budget" as if that were a success.
  const hundredK = parseRequest("plan a trip from Ahmedabad, on a budget of 100000 INR");
  const result: BudgetResult = {
    currency: "INR",
    items: [{ label: "everything", cost: 37_000 }],
    total: 37_000,
    alternative: null,
    assumptions: [],
  };

  const { value, fired } = guardBudget(result, hundredK);
  assert.equal(value.verdict, "within");
  assert.equal(value.headroom, 63_000);
  assert.ok(fired.some((f) => /uses only 37%/.test(f)));
});

test("budget guard leaves a well-used budget alone", () => {
  const result: BudgetResult = {
    currency: "GBP",
    items: [{ label: "everything", cost: 1400 }],
    total: 1400,
    alternative: null,
    assumptions: [],
  };

  const { value, fired } = guardBudget(result, constraints);
  assert.equal(value.headroom, 100);
  assert.ok(!fired.some((f) => /uses only/.test(f)));
});

// ── Destination ──────────────────────────────────────────────────────────────

test("destination guard drops a suggestion that breaks a hard constraint", () => {
  const result: DestinationResult = {
    suggestions: [
      {
        name: "Reykjavik",
        country: "Iceland",
        legs: [{ place: "x", nights: 5, note: "n" }],
        suggestedDays: 5,
        justification: longEnough,
        constraintChecks: [
          { kind: "climate", passes: false, reason: "cold in May" },
        ],
        estimatedTotalCost: 1200,
      },
      {
        name: "Lisbon",
        country: "Portugal",
        legs: [{ place: "x", nights: 5, note: "n" }],
        suggestedDays: 5,
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
        legs: [{ place: "x", nights: 5, note: "n" }],
        suggestedDays: 5,
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

test("destination guard drops a place they asked to move on from", () => {
  // "Any other destination you can suggest?" and Udaipur comes back — the exact
  // failure. Checked by name, not left to the model's own verdict.
  const wantsElsewhere: Constraints = {
    ...constraints,
    destination: null,
    hard: [
      { kind: "avoid", value: "Udaipur", raw: "asked for somewhere other than Udaipur" },
    ],
  };

  const result: DestinationResult = {
    suggestions: [
      {
        name: "Udaipur",
        country: "India",
        legs: [{ place: "x", nights: 5, note: "n" }],
        suggestedDays: 5,
        justification: longEnough,
        // Claims it passes. It does not.
        constraintChecks: [{ kind: "avoid", passes: true, reason: "lovely lakes" }],
        estimatedTotalCost: 900,
      },
      {
        name: "Jaipur",
        country: "India",
        legs: [{ place: "x", nights: 5, note: "n" }],
        suggestedDays: 5,
        justification: longEnough,
        constraintChecks: [{ kind: "avoid", passes: true, reason: "not Udaipur" }],
        estimatedTotalCost: 900,
      },
    ],
  };

  const { value, fired } = guardDestination(result, wantsElsewhere);

  assert.deepEqual(
    value.suggestions.map((s) => s.name),
    ["Jaipur"],
    "the rejected place must not be re-offered",
  );
  assert.ok(fired.some((f) => /asked for somewhere else/.test(f)));
});

test("destination guard rejects a justification too thin to defend", () => {
  const result: DestinationResult = {
    suggestions: [
      {
        name: "Lisbon",
        country: "Portugal",
        legs: [{ place: "x", nights: 5, note: "n" }],
        suggestedDays: 5,
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
    estimatedSpend: 40,
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
