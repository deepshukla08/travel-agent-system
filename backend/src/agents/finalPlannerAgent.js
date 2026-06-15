import { getLLM } from "../utils/llm.js";
import { buildFinalPlannerPrompt } from "../prompts/finalPlannerPrompt.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

const llm = getLLM({ level: "smart", temperature: 0.4 });
const { model, provider, temperature } = llm._meta;

export async function finalPlannerAgent(state) {
  const t0 = Date.now();
  const NAME = "Final Planner Agent";

  logger.agentStart(NAME, model, provider, temperature);
  emit("agent_start", { agent: NAME, step: 6, total: 6, model, provider });

  // ── Input context — entire accumulated state ───────────────────────
  logger.context("preferences", state.preferences);
  logger.context("destinationResearch", state.destinationResearch);
  logger.context("budgetPlan", state.budgetPlan);
  logger.context("itinerary", state.itinerary);
  logger.context("logistics", state.logistics);

  // ── Prompt ─────────────────────────────────────────────────────────
  const prompt = buildFinalPlannerPrompt(state);
  logger.prompt(typeof prompt === "string" ? prompt : JSON.stringify(prompt));

  // ── LLM call ───────────────────────────────────────────────────────
  logger.llmCall(model, provider);
  const response = await llm.invoke(prompt);
  logger.llmResponse(response.content);

  // ── State update ───────────────────────────────────────────────────
  logger.stateUpdate("finalPlan", response.content.slice(0, 200) + "...");
  logger.agentEnd(NAME, Date.now() - t0);
  emit("agent_done", { agent: NAME, step: 6, total: 6 });
  return { finalPlan: response.content };
}
