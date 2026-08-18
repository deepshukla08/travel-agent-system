import { BudgetResultSchema } from "../schemas/index.js";
import type { TripStateType } from "../graph/state.js";
import { generate } from "./model.js";
import { prompt } from "./prompts.js";
import { guardBudget } from "./guards.js";
import { describeConstraints } from "./format.js";

/**
 * Estimates the total cost and checks it against the budget.
 *
 * Runs last in a full plan so it prices the itinerary that exists rather than a
 * generic trip. The verdict itself is arithmetic, in guardBudget.
 */
export async function budgetAgent(state: TripStateType) {
  const constraints = state.constraints!;

  // Unstated currency is passed to the model as a decision to make, not papered
  // over with a default. "5k" for a trip inside India is not 5,000 pounds.
  const stated = constraints.budget?.currency ?? null;
  const currency =
    stated ??
    `the local currency of ${constraints.origin ?? constraints.destination ?? "the trip"} — state which you chose in assumptions`;

  const destination =
    constraints.destination ?? state.destination?.suggestions[0]?.name ?? null;

  // Price the real plan when one exists; otherwise say so, so the model does not
  // silently invent activities to cost.
  const context = state.itinerary
    ? `## The plan you are pricing\n\n${state.itinerary.days
        .map(
          (d) =>
            `Day ${d.day} — ${d.title}: ${d.morning} / ${d.afternoon} / ${d.evening}`,
        )
        .join("\n")}`
    : `## No itinerary was built\n\nEstimate for ${destination ?? "the destination"} over ${constraints.days ?? "the stated"} days from general knowledge, and say so in assumptions.`;

  const budgetLine = !constraints.budget
    ? `No budget was stated. Estimate realistically and set alternative to null.`
    : stated
      ? `The traveller's budget is ${constraints.budget.max} ${stated} in total. Report every cost in ${stated} so it can be compared directly.`
      : `The traveller's budget is ${constraints.budget.max} in total, but they did not say which currency.
Decide the currency that obviously fits this trip — the local one where they are travelling from
or to — report every cost in it, set "currency" to that code, and name the choice in
"assumptions". Do not default to US dollars or sterling out of habit.`;

  const { data, model, ms } = await generate(
    BudgetResultSchema,
    prompt("budget", {
      request: state.request,
      constraints: describeConstraints(constraints),
      context,
      budgetLine,
      currency,
    }),
  );

  const { value, fired } = guardBudget(data, constraints);

  return {
    budget: value,
    trace: [{ agent: "budget" as const, model, ms, ok: true, guards: fired }],
    completed: ["budget" as const],
  };
}
