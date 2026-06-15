/**
 * Builds the prompt for the Supervisor Agent.
 * The supervisor reads the current request + existing state and decides
 * which agent is the cheapest valid entry point into the pipeline.
 *
 * Entry points (in order):
 *   destination → run DESTINATION + BUDGET + ITINERARY + LOGISTICS + FINAL
 *   budget      → skip destination research, run BUDGET + ITINERARY + LOGISTICS + FINAL
 *   itinerary   → skip destination + budget, run ITINERARY + LOGISTICS + FINAL
 *   logistics   → skip all, only LOGISTICS + FINAL
 *   final       → only re-run FINAL (reformat / regenerate prose)
 */
export function buildSupervisorPrompt(state) {
  const hasDestinationResearch = !!state.destinationResearch;
  const hasBudget = !!state.budgetPlan;
  const hasItinerary = !!state.itinerary;
  const hasLogistics = !!state.logistics;

  const existingSummary = `
Existing state:
- destinationResearch: ${hasDestinationResearch ? "YES" : "NO"}
- budgetPlan: ${hasBudget ? "YES" : "NO"}
- itinerary: ${hasItinerary ? "YES" : "NO"}
- logistics: ${hasLogistics ? "YES" : "NO"}
- preferences: ${JSON.stringify(state.preferences ?? {}, null, 2)}
`.trim();

  return `You are a travel planning supervisor. Your job is to decide which agents need to run to fulfill the user's request, given what has already been computed.

${existingSummary}

User request:
"${state.userRequest}"

Pipeline agents (in order):
1. DESTINATION  — research attractions, culture, weather, tips for the destination
2. BUDGET       — estimate costs broken down by category (accommodation, food, transport, etc.)
3. ITINERARY    — build a day-by-day schedule with real dates
4. LOGISTICS    — visa, packing list, health, safety, connectivity tips
5. FINAL        — compile everything into a polished final travel plan

Rules:
- If the destination itself changed → start from DESTINATION (re-run everything)
- If only the budget or number of travelers changed → start from BUDGET
- If only dates, activities, or pace changed (but not destination or budget) → start from ITINERARY
- If only logistics/visa questions changed → start from LOGISTICS
- If no agents have run yet (fresh request) → start from DESTINATION
- If nothing meaningful changed and only the final plan prose needs regenerating → start from FINAL

Respond with ONLY one of these exact words (lowercase):
destination
budget
itinerary
logistics
final`;
}
