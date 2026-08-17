import { getLLM, callLLM, normaliseContent } from "../utils/llm.js";
import { safeParseJSON } from "../utils/validateJson.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

/**
 * Decides which agents a query actually needs.
 *
 * Ordering is fixed by dependency, not by preference: Itinerary needs somewhere
 * to go, and Budget prices a plan once it exists. So a route is always a subset
 * of this sequence, in this order.
 */
export const AGENT_ORDER = ["destination", "itinerary", "budget"];

const llm = getLLM({ level: "fast", temperature: 0 });

function buildIntentPrompt(userRequest, preferences) {
  return `Classify what a traveller is asking for. Reply with JSON flags only.

Their request:
"${userRequest}"

Already extracted from it:
${JSON.stringify(
  {
    destination: preferences?.destination ?? null,
    numberOfDays: preferences?.numberOfDays ?? null,
    budgetAmount: preferences?.budgetAmount ?? null,
  },
  null,
  2,
)}

Set each flag independently:

  "wantsDestinationIdeas" — true if they want help CHOOSING where to go, or named no
    destination. False if they already named a place and are not asking for alternatives.

  "wantsItinerary" — true if they want a day-by-day plan, a schedule, things to do, or
    "plan a trip". False if they only asked about cost, or only where to go.

  "wantsBudget" — true if they mention cost, price, budget, affordability, or "how much".
    False if money is not part of the question.

Examples:
  "5 days somewhere warm in Europe under £1500" → all three true
  "Plan 4 days in Lisbon"                        → ideas false, itinerary true, budget false
  "How much would a week in Bali cost?"          → ideas false, itinerary false, budget true
  "Where should I go for a warm February break?" → ideas true, itinerary false, budget false

Return ONLY:
{ "wantsDestinationIdeas": true, "wantsItinerary": true, "wantsBudget": true }`;
}

/**
 * Turn intent flags into an ordered agent list.
 *
 * Pure and deterministic so the routing decision is testable and so a bad
 * classification cannot produce an impossible route — the rules below override
 * the model, not the other way round.
 */
export function planRoute({ preferences = {}, intent = {}, existing = {} }) {
  const hasDestination = Boolean(preferences.destination || existing.destination);

  // The classifier told us nothing usable — for example it returned unparseable
  // JSON. Assume a full plan rather than guessing: skipping Itinerary and Budget
  // because a flag was missing is a far worse answer than running all three.
  const noSignal =
    !intent.wantsDestinationIdeas && !intent.wantsItinerary && !intent.wantsBudget;

  if (noSignal) {
    return hasDestination
      ? ["itinerary", "budget"]
      : ["destination", "itinerary", "budget"];
  }

  const route = [];

  // Somewhere to go is a precondition for everything else, so a missing
  // destination forces this agent in regardless of what the classifier thought.
  if (!hasDestination || intent.wantsDestinationIdeas) {
    route.push("destination");
  }

  if (intent.wantsItinerary) {
    route.push("itinerary");
  }

  // Price the plan whenever one was built, even if cost went unmentioned —
  // a day-by-day plan with no idea of its cost is half an answer.
  const hasPlan = route.includes("itinerary") || Boolean(existing.itinerary);
  if (intent.wantsBudget || preferences.budgetAmount != null || hasPlan) {
    route.push("budget");
  }

  return route;
}

export async function routeRequest(userRequest, preferences, existing = {}) {
  const t0 = Date.now();
  emit("stage", { stage: "routing", status: "start" });

  let intent;
  try {
    const response = await callLLM(
      llm,
      buildIntentPrompt(userRequest, preferences),
      { label: "router" },
    );
    const parsed = safeParseJSON(normaliseContent(response.content));
    intent = parsed.ok ? parsed.data : {};
  } catch (err) {
    // Routing is not worth failing a run over — plan everything and move on.
    logger.warn(`Router: classification failed (${err.message}) — planning all agents`);
    intent = { wantsDestinationIdeas: true, wantsItinerary: true, wantsBudget: true };
  }

  const route = planRoute({ preferences, intent, existing });

  logger.info(`Router: ${route.join(" → ")}`);
  emit("stage", {
    stage: "routing",
    status: "done",
    route,
    ms: Date.now() - t0,
  });

  return route;
}
