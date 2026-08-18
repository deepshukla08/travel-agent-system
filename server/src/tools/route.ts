import type { Constraints, Need } from "../schemas/index.js";

export const AGENTS = ["destination", "itinerary", "budget"] as const;
export type AgentName = (typeof AGENTS)[number];

/**
 * What the request is missing before any agent can do useful work.
 *
 * Deterministic, so this costs nothing and runs before a single model call.
 * "Plan me a holiday" parses to nothing at all: the Destination Agent would have
 * no preferences to justify a suggestion against, and the Itinerary Agent would
 * invent a trip length. Asking is the honest answer, and asking for free is
 * better than spending four model calls to guess.
 *
 * Deliberately narrow — this is not a required-fields form. One usable signal is
 * enough to proceed, because a partial answer plus stated assumptions beats an
 * interrogation.
 */
export function missingEssentials(constraints: Constraints): Need[] {
  // Somewhere to go, or something to choose one by. Either will do.
  const hasSomewhere =
    constraints.destination !== null || constraints.hard.length > 0;

  if (hasSomewhere) return [];

  // Ask only what is genuinely unknown. "plan me a trip from ahmedabad for 4 days"
  // used to be answered with all four questions, origin and length included —
  // which reads as not having listened.
  const unknown = (id: Need["id"]): boolean => {
    switch (id) {
      case "from":
        return constraints.origin === null;
      case "days":
        return constraints.days === null;
      case "budget":
        return constraints.budget === null;
      case "where":
        // Unknown by definition: a known destination would have returned above.
        return true;
    }
  };

  return QUESTIONS.filter((q) => unknown(q.id));
}

/**
 * Worded for a traveller, not a developer. Every hint says an approximate answer
 * is welcome, because the parser handles vagueness and the agents disclose
 * whatever they had to assume.
 */
const QUESTIONS: Need[] = [
  {
    id: "from",
    label: "Where are you travelling from?",
    hint: "Your nearest city or airport — it drives the flight cost",
  },
  {
    id: "where",
    label: "Where would you like to go?",
    hint: "A city, a country, or just the feel of it — “somewhere warm and walkable”",
  },
  {
    id: "days",
    label: "How long for?",
    hint: "A number of days, or a long weekend — happy to suggest one",
  },
  {
    id: "budget",
    label: "Roughly what would you like to spend?",
    hint: "A rough total for the trip — or leave it to me",
  },
];


/**
 * Asks about money and nothing else. Narrow on purpose.
 *
 * This is the only phrase-matching left in routing, and it can only ever *remove*
 * an agent — so a miss means the traveller gets a plan they did not ask for, never
 * a misread request. That is why a regex is safe here and was not safe as a
 * general intent classifier, where "iternary?" silently changed which agents ran.
 */
const COST_ONLY =
  /\b(how much|what would .*\bcost|what does .*\bcost|cost\?|ballpark|rough(?:ly)? (?:cost|price))\b/i;

/** Asks only where to go — choosing, not booking. */
const IDEAS_ONLY =
  /\b(where should i go|where to go|any ideas|suggest somewhere|recommend somewhere)\b/i;

/**
 * Which agents this request needs, in dependency order.
 *
 * Entirely deterministic and free: no model call decides the route, so every
 * routing decision is unit-testable — which is the whole reason the brief puts
 * this in tools/ rather than in an agent.
 *
 * The default is to plan. Someone describing a trip wants it planned without
 * having to say the word "itinerary"; the two patterns above are the only things
 * that narrow it, and both only ever subtract.
 */
export function route(text: string, constraints: Constraints): AgentName[] {
  const agents: AgentName[] = [];

  // Somewhere to go is a precondition for everything else.
  if (constraints.destination === null) agents.push("destination");

  const costOnly = COST_ONLY.test(text);

  // Only treat it as pure browsing when nothing about the trip itself was stated:
  // "where should I go for 5 days on £900" is a request to plan, not to browse.
  const ideasOnly =
    IDEAS_ONLY.test(text) &&
    constraints.days === null &&
    constraints.budget === null;

  if (!costOnly && !ideasOnly) agents.push("itinerary");

  // Price whatever was planned, and answer a cost question even when nothing was.
  if (!ideasOnly) agents.push("budget");

  // Browsing with a destination already named leaves nothing to do but reconsider.
  return agents.length > 0 ? agents : ["destination"];
}
