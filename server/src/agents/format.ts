import type { Constraints, HardConstraint } from "../schemas/index.js";

/**
 * Renders parsed constraints into the prose the prompts interpolate.
 *
 * Deliberately not JSON.stringify: models follow a readable list more reliably
 * than a nested object, and it keeps the prompt files legible when iterating.
 */
export function describeConstraints(c: Constraints): string {
  const lines = [
    `- destination: ${c.destination ?? "not stated — you are choosing it"}`,
    `- trip length: ${c.days != null ? `${c.days} days` : "not stated"}`,
    `- travellers: ${c.travellers ?? "not stated"}`,
    `- budget: ${c.budget ? `${c.budget.max} ${c.budget.currency} total` : "not stated"}`,
    `- interests: ${c.interests.length ? c.interests.join(", ") : "none stated"}`,
  ];
  return lines.join("\n");
}

export function describeHard(hard: HardConstraint[]): string {
  if (hard.length === 0) return "(none stated)";
  return hard
    .map((h) => `- [${h.kind}] ${h.value}  (from: "${h.raw}")`)
    .join("\n");
}
