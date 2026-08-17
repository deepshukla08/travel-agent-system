import { DestinationResultSchema } from "../schemas/index.js";
import type { TripStateType } from "../graph/state.js";
import { generate } from "./model.js";
import { prompt } from "./prompts.js";
import { guardDestination } from "./guards.js";
import { describeConstraints, describeHard } from "./format.js";

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
      currency: constraints.budget?.currency ?? "GBP",
    }),
  );

  const { value, fired } = guardDestination(data, constraints);

  return {
    destination: value,
    trace: [
      { agent: "destination" as const, model, ms, ok: true, guards: fired },
    ],
    completed: ["destination" as const],
  };
}
