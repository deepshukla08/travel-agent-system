/**
 * Evaluates extracted preferences and decides if the user has provided
 * enough information to build a useful travel plan.
 *
 * Critical fields: destination, numberOfDays, budgetLevel, travelers
 * If 2 or more critical fields are missing → ask the user before proceeding.
 */

const CRITICAL_QUESTIONS = [
  {
    field: "destination",
    missing: (p) => !p.destination,
    question:
      "🗺️  **Where** would you like to travel? (city, country, or region)",
  },
  {
    field: "numberOfDays",
    missing: (p) => !p.numberOfDays,
    question: "📅  **How many days** is your trip?",
  },
  {
    field: "startDate",
    missing: (p) => !p.startDate,
    question:
      "🗓️  **When are you planning to travel?** (e.g. June 15, next month, 2026-07-01)",
  },
  {
    field: "budgetLevel",
    missing: (p) => !p.budgetLevel,
    question:
      "💰  **What is your budget level?** (budget / mid-range / luxury, or an approximate amount)",
  },
  {
    field: "travelers",
    missing: (p) => !p.travelers || p.travelers === "unknown",
    question:
      "👥  **How many people** are traveling, and what is the group type? (solo, couple, family of 4, group of friends, etc.)",
  },
  {
    field: "travelStyle",
    missing: (p) => !p.travelStyle,
    question:
      "🎯  **What type of trip** are you looking for? (relaxed sightseeing, adventure, beach, cultural, honeymoon, etc.)",
  },
];

/**
 * @param {object} preferences - Output from the Preference Agent
 * @returns {{ needsClarification: boolean, questions: string[], message: string|null }}
 */
export function checkClarificationNeeded(preferences = {}) {
  const missingCritical = CRITICAL_QUESTIONS.filter((q) =>
    q.missing(preferences),
  );

  // Require clarification when 2 or more critical fields are missing
  const needsClarification = missingCritical.length >= 2;

  if (!needsClarification) {
    return { needsClarification: false, questions: [], message: null };
  }

  const questions = missingCritical.map((q) => q.question);

  const message =
    `I'd love to help plan your trip! I just need a few more details to create the perfect plan:\n\n` +
    questions.join("\n\n") +
    `\n\nPlease answer the questions above and I'll start building your itinerary right away! 🚀`;

  return { needsClarification: true, questions, message };
}
