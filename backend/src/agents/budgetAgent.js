import { getLLM } from "../utils/llm.js";
import {
  buildBudgetPrompt,
  buildCheaperAlternativePrompt,
} from "../prompts/budgetPrompt.js";
import { runStructuredAgent } from "../utils/runStructuredAgent.js";
import {
  BudgetOutputSchema,
  CheaperAlternativeSchema,
} from "../schemas/agents.js";
import { getExchangeRateTool } from "../tools/currencyTool.js";
import { parseBudget } from "../utils/parseBudget.js";
import { logger } from "../utils/logger.js";

export const NAME = "Budget Agent";

// Budget does the numeric reasoning, so it gets the stronger model.
const llm = getLLM({ level: "smart", temperature: 0.2 });
const TOOLS = [getExchangeRateTool];

/**
 * Recompute the budget verdict from the numbers, ignoring what the model claimed.
 *
 * This is the enforcement point for "must never silently exceed the budget".
 * The prompt asks for honesty; this function removes the need to trust it. If
 * totalEstimate is over the stated budget then withinBudget is false and
 * overageAmount is the real difference, whatever the model said.
 *
 * Exported for testing — this is the assertion that matters most in this repo.
 */
export function enforceBudgetVerdict(budget, preferences) {
  const stated = resolveStatedBudget(preferences);

  // No budget stated means nothing to exceed — a verdict would be meaningless.
  if (stated.amount == null) {
    return { ...budget, withinBudget: null, overageAmount: 0 };
  }

  const total = Number(budget.totalEstimate);
  const withinBudget = total <= stated.amount;
  const overageAmount = withinBudget ? 0 : Math.round(total - stated.amount);

  if (budget.withinBudget === true && !withinBudget) {
    logger.warn(
      `${NAME}: model claimed within budget but ${total} > ${stated.amount} — overridden`,
    );
  }

  return { ...budget, withinBudget, overageAmount, budgetAmount: stated.amount };
}

/** Preferences should carry a number already; parse defensively in case they don't. */
function resolveStatedBudget(preferences = {}) {
  if (typeof preferences.budgetAmount === "number" && preferences.budgetAmount > 0) {
    return {
      amount: preferences.budgetAmount,
      currency: preferences.budgetCurrency ?? null,
    };
  }
  return parseBudget(preferences.budgetAmount);
}

export async function budgetAgent(state) {
  const preferences = state.preferences ?? {};

  const raw = await runStructuredAgent({
    llm,
    tools: TOOLS,
    prompt: buildBudgetPrompt(preferences, state.destination, state.itinerary),
    schema: BudgetOutputSchema,
    name: NAME,
  });

  const budget = enforceBudgetVerdict(raw, preferences);

  // Over budget with no alternative offered — the brief requires one, so ask
  // for just that piece rather than re-running the whole estimate.
  if (budget.withinBudget === false && !budget.cheaperAlternative) {
    logger.warn(`${NAME}: over budget with no alternative — requesting one`);

    try {
      budget.cheaperAlternative = await runStructuredAgent({
        llm,
        prompt: buildCheaperAlternativePrompt(budget, preferences),
        schema: CheaperAlternativeSchema,
        name: `${NAME} (alternative)`,
      });
    } catch (err) {
      // Better an honest gap than a fabricated alternative. The overage is
      // still flagged, which is the part that must never be silent.
      logger.error(`${NAME}: could not produce an alternative — ${err.message}`);
      budget.alternativeUnavailable = true;
    }
  }

  logger.stateUpdate("budget", {
    totalEstimate: budget.totalEstimate,
    withinBudget: budget.withinBudget,
    overageAmount: budget.overageAmount,
  });

  return { budget };
}

export const budgetSpec = {
  key: "budget",
  label: NAME,
  meta: llm._meta,
  run: budgetAgent,
  // A failed costing still leaves a usable destination and itinerary.
  critical: false,
};
