import { ItineraryResultSchema, type Leg } from "../schemas/index.js";
import type { TripStateType } from "../graph/state.js";
import { generate } from "./model.js";
import { prompt } from "./prompts.js";
import { guardItinerary, AgentError } from "./guards.js";
import { describeConstraints } from "./format.js";
import { budgetEnvelope, describeEnvelope } from "../tools/budgetEnvelope.js";

const DEFAULT_DAYS = 5;

/** Nobody's idea of a good time, whatever the budget says it can afford. */
const MAX_DAYS = 21;

/** A trip has to be worth the flight. */
const MIN_DAYS = 2;

/** Leaves the re-priced trip room to land near the budget without going over. */
const AIM_AT = 0.9;

/**
 * The length the Budget Agent's own numbers afford, once it has priced a trip.
 *
 * Only reachable on a replan (see `worthReplanning` in the pipeline), because
 * `state.budget` is null on the first pass. Its itemised total divided by the
 * days it priced is the only real per-day cost anywhere in the system — the
 * Destination Agent's estimate is a guess that misses in both directions.
 *
 * So this both stretches and shrinks: 560,000 over 9 days is 62,000 a day and a
 * 1,000,000 budget buys 14 of them; 1,110,000 over 12 days is 92,500 a day and
 * the same budget buys 9.
 */
function revisedDays(state: TripStateType): number | null {
  const priced = state.itinerary?.days.length;
  const total = state.budget?.total;
  const max = state.constraints?.budget?.max;

  if (!priced || !total || max == null) return null;

  const perDay = total / priced;
  if (perDay <= 0) return null;

  const afford = Math.floor((max * AIM_AT) / perDay);
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, afford));
}

/**
 * Re-sizes the Destination Agent's legs to a revised trip length.
 *
 * Its route was shaped for the length it proposed, so asking for 15 days against
 * 9 nights of route hands the model a contradiction. Scaled by arithmetic rather
 * than by asking the Destination Agent again, which would cost a third call.
 */
function stretchLegs(legs: Leg[], days: number): Leg[] {
  const total = legs.reduce((sum, l) => sum + l.nights, 0);
  if (total === days || total === 0) return legs;

  const scaled = legs.map((l) => ({
    ...l,
    nights: Math.max(1, Math.round((l.nights * days) / total)),
  }));

  // Rounding drift lands on the longest leg, where a night either way matters least.
  const drift = days - scaled.reduce((sum, l) => sum + l.nights, 0);
  const longest = scaled.reduce((a, b) => (b.nights > a.nights ? b : a));
  longest.nights = Math.max(1, longest.nights + drift);

  return scaled;
}

/**
 * Builds the day-by-day plan. Consults the Destination Agent's output for
 * context when it ran — that is the chaining the brief describes.
 */
export async function itineraryAgent(state: TripStateType) {
  const constraints = state.constraints!;

  // Whichever destination we have: the one the user named, or the top surviving
  // suggestion from the Destination Agent.
  const chosen =
    constraints.destination ?? state.destination?.suggestions[0]?.name ?? null;

  if (!chosen) {
    throw new AgentError("no destination available to plan for", "itinerary");
  }

  const picked = state.destination?.suggestions[0];

  /**
   * How long the trip is, in order of authority: what they said, then what the
   * Budget Agent's itemised pricing shows the budget affords, then what the
   * Destination Agent judged, then a short break.
   *
   * The bare five-day default used to apply even when a budget was stated, which
   * is a guess dressed as a decision — the agent that knows the destination and
   * the budget is better placed to say.
   */
  const revised = revisedDays(state);
  const days =
    constraints.days ?? revised ?? picked?.suggestedDays ?? DEFAULT_DAYS;

  const legs = picked ? stretchLegs(picked.legs, days) : [];

  const context = picked
    ? `## From the Destination Agent

It chose ${picked.name}, ${picked.country}, because: ${picked.justification}

Where they stay, in order:
${legs.map((l) => `  - ${l.place}, ${l.nights} night(s) — ${l.note}`).join("\n")}

Follow that shape. Each move between legs costs real hours, so give it a day and say so.`
    : "";

  // What the budget leaves for each day, worked out by arithmetic rather than by
  // the model. Without this the budget was inert context here.
  const envelope = budgetEnvelope(constraints, days);

  const { data, model, ms } = await generate(
    ItineraryResultSchema,
    prompt("itinerary", {
      request: state.request,
      constraints: describeConstraints(constraints),
      context,
      destination: chosen,
      days: String(days),
      allowance: describeEnvelope(envelope),
    }),
  );

  // Guard against the requested length, using the same default the prompt was
  // given so a request with no stated length is not judged against null.
  const { value, fired } = guardItinerary(data, { ...constraints, days });

  // An inferred trip length is an assumption, and an undisclosed assumption is
  // the same failure the Budget guard exists to prevent — applied to days rather
  // than money. Surfaced through the guard channel, which the UI already shows
  // and the audit row already stores.
  if (constraints.days === null) {
    fired.unshift(
      revised != null
        ? `re-planned from ${state.itinerary!.days.length} to ${days} days — the first pass priced at ${state.budget!.total} against a budget of ${constraints.budget?.max}`
        : picked?.suggestedDays
          ? `no length was stated — ${days} days chosen to suit the destination and budget`
          : `assumed a ${days}-day trip — neither a length nor a budget was stated`,
    );
  }

  // The plan states its own cost, so compare it with what the budget left. Noted,
  // not enforced: an honest overshoot is useful information, and forcing a fit here
  // is exactly the dishonesty the Budget Agent's guard exists to prevent. The
  // Budget Agent still prices the real plan independently.
  if (envelope) {
    const planned = value.days.reduce((sum, d) => sum + d.estimatedSpend, 0);
    if (planned > envelope.activities) {
      fired.push(
        `day plans total ${Math.round(planned)} ${envelope.currency ?? ""}`.trim() +
          ` against roughly ${envelope.activities} available for activities`,
      );
    }
  }

  return {
    itinerary: value,
    trace: [{ agent: "itinerary" as const, model, ms, ok: true, guards: fired }],
    completed: ["itinerary" as const],
  };
}
