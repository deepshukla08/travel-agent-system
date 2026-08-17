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
  const currency = constraints.budget?.currency ?? "GBP";

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

  const budgetLine = constraints.budget
    ? `The traveller's budget is ${constraints.budget.max} ${constraints.budget.currency} in total. Report every cost in ${constraints.budget.currency} so it can be compared directly.`
    : `No budget was stated. Estimate realistically and set alternative to null.`;

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
