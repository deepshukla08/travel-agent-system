import type {
  BudgetResult,
  Constraints,
  DestinationResult,
  ItineraryResult,
  Suggestion,
} from "../schemas/index.js";

/**
 * The three behavioural constraints, enforced in code.
 *
 * A prompt that says "never exceed the budget" is a request. Arithmetic that
 * checks is a guarantee. Every guard here either corrects the model's output or
 * throws — the model never gets the final word on a stated constraint.
 *
 * Each guard returns the fired messages alongside the corrected value, so the
 * run's audit row can record that a guard fired and the UI can show it.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly agent: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export type Guarded<T> = { value: T; fired: string[] };

/** Anything shorter than this is not an argument, it is a label. */
const MIN_JUSTIFICATION = 40;

/**
 * Destination: drop any suggestion that breaks a hard constraint.
 *
 * If the model offers Reykjavik for "warm", it goes — and the drop is recorded
 * in the trace rather than silently swallowed.
 */
export function guardDestination(
  result: DestinationResult,
  constraints: Constraints,
): Guarded<DestinationResult> {
  const fired: string[] = [];
  const kept: Suggestion[] = [];

  for (const suggestion of result.suggestions) {
    const failed = suggestion.constraintChecks.filter((c) => !c.passes);
    if (failed.length > 0) {
      fired.push(
        `dropped ${suggestion.name}: fails ${failed.map((f) => `${f.kind} (${f.reason})`).join(", ")}`,
      );
      continue;
    }

    // The model self-reports constraint checks, so verify the budget one
    // independently — it is the only hard constraint we can check by arithmetic.
    const maxBudget = constraints.budget?.max;
    if (maxBudget != null && suggestion.estimatedTotalCost > maxBudget) {
      fired.push(
        `dropped ${suggestion.name}: estimated ${suggestion.estimatedTotalCost} exceeds budget ${maxBudget} despite passing its own check`,
      );
      continue;
    }

    if (suggestion.justification.trim().length < MIN_JUSTIFICATION) {
      fired.push(`dropped ${suggestion.name}: justification too thin to defend`);
      continue;
    }

    kept.push(suggestion);
  }

  if (kept.length === 0) {
    throw new AgentError(
      `no destination satisfies the stated constraints (${fired.join("; ")})`,
      "destination",
    );
  }

  return { value: { suggestions: kept }, fired };
}

/**
 * Itinerary: every day must carry an explicit uncertainty verdict, and a day
 * claiming uncertainty must say what it is uncertain about.
 *
 * The constraint is that it "must say so when it is uncertain", so this is a
 * required field rather than a hope — and an empty reason is not saying so.
 */
export function guardItinerary(
  result: ItineraryResult,
  constraints: Constraints,
): Guarded<ItineraryResult> {
  const fired: string[] = [];

  const expected = constraints.days;
  if (expected != null && result.days.length !== expected) {
    throw new AgentError(
      `asked for ${expected} days, returned ${result.days.length}`,
      "itinerary",
    );
  }

  const days = result.days.map((day) => {
    if (day.uncertain && !day.uncertaintyReason?.trim()) {
      // Flagged uncertain with nothing named — surface it rather than let the UI
      // show a warning triangle with no explanation.
      fired.push(`day ${day.day}: uncertain with no reason given`);
      return {
        ...day,
        uncertaintyReason: "Flagged uncertain but no reason was given.",
      };
    }
    if (!day.travelNotes.trim()) {
      fired.push(`day ${day.day}: no travel/sequencing notes`);
    }
    return day;
  });

  return { value: { ...result, days }, fired };
}

/**
 * Budget: the total is recomputed from the items, and an over-budget plan
 * without an alternative is a hard failure.
 *
 * "Must never silently exceed the budget" cannot be satisfied by asking. The
 * model reports items; arithmetic decides whether it fits.
 */
export function guardBudget(
  result: BudgetResult,
  constraints: Constraints,
): Guarded<BudgetResult & { total: number; overBudget: boolean; overage: number }> {
  const fired: string[] = [];

  const total = result.items.reduce((sum, item) => sum + item.cost, 0);

  if (Math.round(total) !== Math.round(result.total)) {
    fired.push(
      `total corrected: model said ${result.total}, items sum to ${total}`,
    );
  }

  const max = constraints.budget?.max ?? null;
  const overBudget = max != null && total > max;
  const overage = overBudget && max != null ? Math.round(total - max) : 0;

  // The one thing the brief forbids outright. Failing loudly here is the point:
  // a silently over-budget plan is worse than no plan.
  if (overBudget && !result.alternative) {
    throw new AgentError(
      `estimate ${Math.round(total)} exceeds budget ${max} with no cheaper alternative proposed`,
      "budget",
    );
  }

  if (overBudget) {
    fired.push(`over budget by ${overage} ${result.currency}`);

    const proposed = result.alternative?.newTotal;
    if (max != null && proposed != null && proposed > max) {
      fired.push(
        `alternative still over budget (${proposed} vs ${max}) — presented as the closest available, not as a fit`,
      );
    }
  }

  return {
    value: { ...result, total: Math.round(total), overBudget, overage },
    fired,
  };
}
