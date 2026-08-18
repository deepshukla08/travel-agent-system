import type { Constraints } from "../schemas/index.js";

/**
 * Turns a total budget into what the Itinerary Agent may spend per day.
 *
 * The budget used to reach that agent as inert context: it appeared in the
 * constraints block, its prompt never mentioned money, and its output had no cost
 * field — so it planned as though cost did not exist and the Budget Agent priced
 * the damage afterwards. This makes the budget a planning input.
 *
 * Deterministic and free, which is the point: the figure that constrains the plan
 * is arithmetic, not a model's guess, and the Budget Agent still prices the result
 * independently afterwards.
 */
export interface Envelope {
  currency: string | null;
  total: number;
  flights: number;
  accommodation: number;
  /** What is left for food, local transport and things to do. */
  activities: number;
  /** That remainder divided across the trip — the number the plan must live in. */
  perDay: number;
}

/**
 * ponytail: a fixed 30/30/40 split, not a real pricing model. It is wrong in the
 * obvious ways — a long-haul flight eats far more than 30%, a domestic bus far
 * less — but it is honest about being a guide rather than a quote, and the Budget
 * Agent prices the real plan afterwards. Upgrade path is a per-route lookup or a
 * cheap model call for the split, if the guide proves misleading in practice.
 */
const SHARE = { flights: 0.3, accommodation: 0.3, activities: 0.4 } as const;

export function budgetEnvelope(
  constraints: Constraints,
  days: number,
): Envelope | null {
  const budget = constraints.budget;
  if (!budget || days <= 0) return null;

  const flights = Math.round(budget.max * SHARE.flights);
  const accommodation = Math.round(budget.max * SHARE.accommodation);

  // Whatever the other two leave, so the parts always sum to the total rather
  // than to 99% of it after rounding.
  const activities = budget.max - flights - accommodation;

  return {
    currency: budget.currency,
    total: budget.max,
    flights,
    accommodation,
    activities,
    perDay: Math.round(activities / days),
  };
}

/** The envelope as the sentence the itinerary prompt interpolates. */
export function describeEnvelope(envelope: Envelope | null): string {
  if (!envelope) {
    return `No budget was stated. Plan at a sensible mid-range level and keep the day's
spending proportionate — do not assume money is no object.`;
  }

  const unit = envelope.currency ?? "";

  return `The traveller's total budget is ${envelope.total} ${unit}. As a rough guide that leaves
about ${envelope.perDay} ${unit} per day for food, local transport and things to do, once
travel and accommodation are set aside.

Plan within that. Choose the free viewpoint over the paid one where it is genuinely as good,
and put an expensive experience in only when it is worth the day's allowance.

This split is a guide, not a quote — if a day genuinely needs more, plan it and say what it
costs in "estimatedSpend". An honest figure that runs over is useful; a plan quietly padded
with things they cannot afford is not.`;
}
