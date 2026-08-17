import { ItineraryResultSchema } from "../schemas/index.js";
import type { TripStateType } from "../graph/state.js";
import { generate } from "./model.js";
import { prompt } from "./prompts.js";
import { guardItinerary, AgentError } from "./guards.js";
import { describeConstraints } from "./format.js";

const DEFAULT_DAYS = 5;

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
  const context = picked
    ? `## Context from the Destination Agent\n\nIt chose ${picked.name}, ${picked.country}, because: ${picked.justification}`
    : "";

  const days = constraints.days ?? DEFAULT_DAYS;

  const { data, model, ms } = await generate(
    ItineraryResultSchema,
    prompt("itinerary", {
      request: state.request,
      constraints: describeConstraints(constraints),
      context,
      destination: chosen,
      days: String(days),
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
    fired.unshift(`assumed a ${days}-day trip — no length was stated`);
  }

  return {
    itinerary: value,
    trace: [{ agent: "itinerary" as const, model, ms, ok: true, guards: fired }],
    completed: ["itinerary" as const],
  };
}
