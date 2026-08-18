import { DestinationResultSchema } from "../schemas/index.js";
import type { TripStateType } from "../graph/state.js";
import { generate } from "./model.js";
import { prompt } from "./prompts.js";
import { guardDestination } from "./guards.js";
import { describeConstraints, describeHard, describeTarget } from "./format.js";

/**
 * Suggests destinations fitting the stated preferences.
 *
 * Pure: no filesystem, no database, no HTTP beyond the model call. It returns
 * data and the API layer persists it, which is what lets the whole graph run in
 * a test with the model stubbed and no side effects.
 */
export async function destinationAgent(state: TripStateType) {
  const constraints = state.constraints!;

  const { data, model, ms } = await generate(
    DestinationResultSchema,
    prompt("destination", {
      request: state.request,
      constraints: describeConstraints(constraints),
      hard: describeHard(constraints.hard),
      target: describeTarget(constraints),
      currency: constraints.budget?.currency ?? "GBP",
    }),
  );

  const { value, fired } = guardDestination(data, constraints);

  // Write the choice into the constraints so the agents after this one plan for a
  // named place rather than re-deriving it from the suggestion list.
  const chosen = value.suggestions[0]!.name;

  return {
    destination: value,
    constraints: { ...constraints, destination: chosen },
    trace: [
      { agent: "destination" as const, model, ms, ok: true, guards: fired },
    ],
    completed: ["destination" as const],
  };
}
