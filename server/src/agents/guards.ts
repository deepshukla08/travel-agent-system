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
 * Below this share of the stated budget, the trip is worth questioning.
 *
 * The mirror of "never silently exceed the budget": never silently spend a third
 * of it either. Deliberately looser than the 0.75 the destination prompt aims
 * for, so an estimate landing slightly low is not treated as a failure.
 */
const UNDERSPEND = 0.6;

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

    // A place they asked to avoid, re-offered. Checked by name rather than trusted
    // to the model's own verdict: asking for "any other destination" and being
    // handed the same one back is the whole failure.
    const avoided = constraints.hard.find(
      (h) =>
        h.kind === "avoid" &&
        h.value.toLowerCase() === suggestion.name.toLowerCase(),
    );
    if (avoided) {
      fired.push(`dropped ${suggestion.name}: they asked for somewhere else`);
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

    // Kept, not dropped: a cheap suggestion is still a real answer, and dropping
    // every one of them would leave nothing to plan. But the traveller should
    // see that their budget bought less than it could have.
    if (maxBudget != null && suggestion.estimatedTotalCost < maxBudget * UNDERSPEND) {
      fired.push(
        `${suggestion.name} costs ${suggestion.estimatedTotalCost} against a ${maxBudget} budget — somewhere further or longer was affordable`,
      );
    }

    if (suggestion.justification.trim().length < MIN_JUSTIFICATION) {
      fired.push(`dropped ${suggestion.name}: justification too thin to defend`);
      continue;
    }

    // The legs have to add up to the trip, or the itinerary cannot allocate days
    // across them. Arithmetic, like every other check here.
    const target = constraints.days ?? suggestion.suggestedDays;
    const nights = suggestion.legs.reduce((sum, leg) => sum + leg.nights, 0);

    if (nights !== target) {
      fired.push(
        `${suggestion.name}: legs total ${nights} nights against a ${target}-day trip — the day count wins`,
      );
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
/**
 * Three outcomes, not two. "Not over budget" and "no budget was given" are
 * different facts, and collapsing them into one boolean made the UI announce
 * "Within budget" for trips nobody had set a budget for.
 */
export type BudgetVerdict = "within" | "over" | "unstated";

export function guardBudget(
  result: BudgetResult,
  constraints: Constraints,
): Guarded<
  BudgetResult & {
    total: number;
    verdict: BudgetVerdict;
    overBudget: boolean;
    overage: number;
    /** Budget left unspent — large headroom means a better trip was affordable. */
    headroom: number;
  }
> {
  const fired: string[] = [];

  const total = result.items.reduce((sum, item) => sum + item.cost, 0);

  if (Math.round(total) !== Math.round(result.total)) {
    fired.push(
      `total corrected: model said ${result.total}, items sum to ${total}`,
    );
  }

  // Flights are usually the biggest line and depend entirely on the origin, so a
  // flight cost priced from an unstated origin is a guess wearing a number's
  // clothes. Recorded rather than left to the prompt to mention.
  const pricedFlights = result.items.some((i) => /flight|airfare|flying/i.test(i.label));
  if (pricedFlights && constraints.origin === null) {
    fired.push(
      "flights priced without a stated departure point — treat the total as indicative",
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

  const verdict: BudgetVerdict =
    max == null ? "unstated" : overBudget ? "over" : "within";

  /**
   * How much of the budget went unused.
   *
   * The brief's rule is "never silently exceed", and this is its mirror: never
   * silently under-deliver. Someone leaving Ahmedabad with 100,000 INR who is
   * handed a 37,000 INR trip has not been served well, and "within budget" alone
   * makes that look like a success.
   */
  const headroom = max != null && !overBudget ? Math.round(max - total) : 0;

  if (max != null && !overBudget && total < max * UNDERSPEND) {
    fired.push(
      `uses only ${Math.round((total / max) * 100)}% of the ${max} budget — a longer trip or a better tier is affordable`,
    );
  }

  return {
    value: {
      ...result,
      total: Math.round(total),
      verdict,
      overBudget,
      overage,
      headroom,
    },
    fired,
  };
}
