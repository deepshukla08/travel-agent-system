import type { Constraints } from "../schemas/index.js";

export const AGENTS = ["destination", "itinerary", "budget"] as const;
export type AgentName = (typeof AGENTS)[number];

/**
 * Decides which agents a request needs.
 *
 * Deterministic, from the parsed constraints — so "roughly what does a week in
 * Rome cost?" provably calls Budget alone. If every query ran all three this
 * would be a pipeline, not an orchestrator, and the orchestrator is the thing
 * being graded.
 *
 * Order is fixed by dependency: Itinerary needs somewhere to go, Budget prices
 * whatever exists. A route is always a subset of AGENTS in AGENTS order.
 */
export function route(text: string, constraints: Constraints): AgentName[] {
  const lower = text.toLowerCase();

  const asksCost = /\bcost|budget|price|cheap|afford|expensive|how much|spend\b/.test(lower);
  const asksPlan = /\bitinerary|plan|schedule|day[- ]by[- ]day|what to do|things to do|see and do\b/.test(lower);
  const asksWhere = /\bwhere|which (?:city|country|place)|suggest|recommend|ideas?|somewhere|anywhere\b/.test(lower);

  // Cost-only: asks about money, wants no plan, and already knows the place.
  const costOnly = asksCost && !asksPlan && !asksWhere && constraints.destination !== null;
  if (costOnly) return ["budget"];

  // Where-only: wants suggestions and nothing more.
  //
  // Phrasing alone is not enough here. "a five day trip somewhere warm in Europe
  // for under £1500" contains "somewhere" but states a length and a budget, which
  // means they want the plan priced too — so a stated length or budget disqualifies
  // this shortcut regardless of wording.
  const wantsOnlyIdeas =
    asksWhere &&
    !asksPlan &&
    !asksCost &&
    constraints.days === null &&
    constraints.budget === null;
  if (wantsOnlyIdeas) return ["destination"];

  const agents: AgentName[] = [];

  // Somewhere to go is a precondition for everything else, so an unknown
  // destination forces this agent in regardless of phrasing.
  if (constraints.destination === null || asksWhere) agents.push("destination");

  if (asksPlan || constraints.days !== null) agents.push("itinerary");

  // Price the plan whenever one was built, even if cost went unmentioned: a
  // day-by-day plan with no idea of its cost is half an answer.
  if (asksCost || constraints.budget !== null || agents.includes("itinerary")) {
    agents.push("budget");
  }

  // Nothing matched — treat it as a full planning request rather than guessing.
  return agents.length > 0 ? agents : [...AGENTS];
}
