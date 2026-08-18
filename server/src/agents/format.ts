import type { Constraints, HardConstraint } from "../schemas/index.js";

/**
 * Renders parsed constraints into the prose the prompts interpolate.
 *
 * Deliberately not JSON.stringify: models follow a readable list more reliably
 * than a nested object, and it keeps the prompt files legible when iterating.
 */
export function describeConstraints(c: Constraints): string {
  const lines = [
    `- travelling from: ${c.origin ?? "NOT STATED — do not assume a country or airport"}`,
    `- destination: ${c.destination ?? "not stated — you are choosing it"}`,
    `- trip length: ${c.days != null ? `${c.days} days` : "not stated"}`,
    `- travellers: ${c.travellers ?? "not stated"}`,
    `- budget: ${c.budget ? `${c.budget.max} ${c.budget.currency ?? "(currency not stated)"} total` : "not stated"}`,
    `- interests: ${c.interests.length ? c.interests.join(", ") : "none stated"}`,
  ];
  return lines.join("\n");
}

/**
 * The band a destination is chosen for, as a share of the stated budget.
 *
 * The ceiling is not the budget itself. The destination's estimate is one coarse
 * number; the budget agent then prices the actual plan line by line and lands
 * somewhere near it. Aiming at 100% meant that drift went over — a 92,000 pick
 * on a 100,000 budget came back priced at 108,000. The gap absorbs it.
 */
const TARGET_FLOOR = 0.75;
const TARGET_CEILING = 0.9;

/**
 * The spend the destination is being picked for, as a figure.
 *
 * The prompt can say "use the budget"; only arithmetic can say what that means
 * in their currency. Left to the model, 100,000 INR from Ahmedabad came back as
 * a 37,000 INR trip to Udaipur — technically within budget, and a third of the
 * holiday they asked for. Destination only: the budget agent must price what is
 * actually planned, so it never sees this.
 */
export function describeTarget(c: Constraints): string {
  const max = c.budget?.max;
  if (max == null) {
    return "No budget stated. Choose on fit, and keep the suggestions to a sensible mid-range.";
  }

  const unit = c.budget?.currency ?? "";
  const floor = Math.round(max * TARGET_FLOOR);
  const ceiling = Math.round(max * TARGET_CEILING);

  return [
    `Their budget is ${max} ${unit}`.trim() +
      `, so choose a destination whose whole trip costs between ${floor} and ${ceiling}.`,
    `Below ${floor} is a smaller holiday than they asked for. Above ${max} is discarded outright,`,
    `and the last stretch is left free because the Budget Agent prices this in detail afterwards.`,
    `Pick the tier that reaches that band — nearby, regional or long-haul — then suggest within it.`,
  ].join(" ");
}

export function describeHard(hard: HardConstraint[]): string {
  if (hard.length === 0) return "(none stated)";
  return hard
    .map((h) => `- [${h.kind}] ${h.value}  (from: "${h.raw}")`)
    .join("\n");
}
