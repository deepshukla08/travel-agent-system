/**
 * Decides whether a request is too vague to act on.
 *
 * Deliberately narrow. A missing destination is NOT a blocker any more — that
 * is the Destination Agent's job, and asking "where do you want to go?" when the
 * user said "somewhere warm in Europe" would skip the agent that exists to
 * answer exactly that.
 *
 * Only two things genuinely block planning: not knowing how long the trip is,
 * and having neither a destination nor any constraint to choose one from.
 */

const BLOCKERS = [
  {
    field: "numberOfDays",
    missing: (p) => !p.numberOfDays,
    question: "📅  **How many days** is your trip?",
  },
  {
    field: "destinationOrConstraints",
    // A destination OR something to pick one from is enough to proceed.
    missing: (p) =>
      !p.destination && (p.hardConstraints ?? []).length === 0,
    question:
      "🗺️  **Where would you like to go**, or what kind of place? (a city, a region, or just 'somewhere warm and walkable')",
  },
];

/** Asked alongside a blocker, so the user answers everything in one go. */
const NICE_TO_HAVE = [
  {
    missing: (p) => !p.startDate,
    question:
      "🗓️  **When are you travelling?** (a date or month is fine — otherwise I'll assume a few weeks out)",
  },
  {
    missing: (p) => !p.budgetAmount && !p.budgetLevel,
    question:
      "💰  **What's your budget?** (a total amount, or just budget / mid-range / luxury)",
  },
  {
    missing: (p) => !p.travelers || p.travelers === "unknown",
    question:
      "👥  **Who's travelling?** (solo, couple, family of 4, group of friends...)",
  },
];

/**
 * @param {object} preferences - structured output from the preference step
 * @returns {{ needsClarification: boolean, questions: string[], message: string|null }}
 */
export function checkClarificationNeeded(preferences = {}) {
  const blocking = BLOCKERS.filter((q) => q.missing(preferences));

  if (blocking.length === 0) {
    return { needsClarification: false, questions: [], message: null };
  }

  const questions = [
    ...blocking.map((q) => q.question),
    ...NICE_TO_HAVE.filter((q) => q.missing(preferences)).map((q) => q.question),
  ];

  const message =
    `I'd love to help plan your trip! I just need a little more to go on:\n\n` +
    questions.join("\n\n") +
    `\n\nAnswer what you can and I'll start building your plan. 🚀`;

  return { needsClarification: true, questions, message };
}
