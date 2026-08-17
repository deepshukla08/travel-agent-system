import { getLLM, callLLM, normaliseContent } from "../utils/llm.js";
import { buildPreferencePrompt } from "../prompts/preferencePrompt.js";
import { safeParseJSON } from "../utils/validateJson.js";
import { parseBudget } from "../utils/parseBudget.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

/**
 * Turns the user's sentence into structured preferences.
 *
 * This is an orchestration step, not one of the three agents. It has no travel
 * knowledge and makes no recommendations — it only reads the request. Badging
 * it as an agent would inflate the agent count without adding a specialism,
 * so it emits a "stage" event instead of an "agent" one.
 */
const llm = getLLM({ level: "fast", temperature: 0 });

const VALID_CONSTRAINT_KINDS = new Set([
  "region",
  "climate",
  "maxBudget",
  "avoid",
  "maxFlightHours",
  "accessibility",
  "dates",
]);

/**
 * Coerce whatever the model returned into the shape the agents rely on.
 * Exported for testing — the budget guarantee downstream is only as good as
 * the number that arrives here.
 */
export function normalisePreferences(raw = {}) {
  const prefs = { ...raw };

  // budgetAmount must end up a number or null — never a string like "1 lakh INR",
  // because the budget check is a numeric comparison.
  if (typeof prefs.budgetAmount !== "number" || !(prefs.budgetAmount > 0)) {
    const parsed = parseBudget(prefs.budgetAmount);
    prefs.budgetAmount = parsed.amount;
    prefs.budgetCurrency = prefs.budgetCurrency || parsed.currency;
  }

  if (prefs.budgetAmount != null && !prefs.budgetCurrency) {
    // A number with no currency is ambiguous; fall back to the raw request text.
    prefs.budgetCurrency = parseBudget(String(raw.budgetAmount ?? "")).currency;
  }

  prefs.hardConstraints = Array.isArray(prefs.hardConstraints)
    ? prefs.hardConstraints
        .filter((c) => c && VALID_CONSTRAINT_KINDS.has(c.kind))
        .map((c) => ({ kind: c.kind, value: c.value, raw: c.raw ?? null }))
    : [];

  for (const key of ["interests", "softPreferences", "missingInfo"]) {
    if (!Array.isArray(prefs[key])) prefs[key] = [];
  }

  if (typeof prefs.numberOfDays === "string") {
    const n = Number.parseInt(prefs.numberOfDays, 10);
    prefs.numberOfDays = Number.isFinite(n) ? n : null;
  }

  return prefs;
}

export async function extractPreferences(userRequest) {
  const t0 = Date.now();
  emit("stage", { stage: "preferences", status: "start" });

  const response = await callLLM(llm, buildPreferencePrompt(userRequest), {
    label: "preferences",
  });

  const parsed = safeParseJSON(normaliseContent(response.content));
  if (!parsed.ok) {
    emit("stage", { stage: "preferences", status: "error" });
    throw new Error(`Preference extraction failed — ${parsed.error}`);
  }

  const preferences = normalisePreferences(parsed.data);

  logger.stateUpdate("preferences", preferences);
  emit("stage", {
    stage: "preferences",
    status: "done",
    ms: Date.now() - t0,
  });

  return preferences;
}
