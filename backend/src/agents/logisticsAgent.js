import { getLLM } from "../utils/llm.js";
import { buildLogisticsPrompt } from "../prompts/logisticsPrompt.js";
import { safeParseJSON } from "../utils/validateJson.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

const llm = getLLM({ level: "fast", temperature: 0.2 });
const { model, provider, temperature } = llm._meta;

export async function logisticsAgent(state) {
  const t0 = Date.now();
  const NAME = "Logistics Agent";

  logger.agentStart(NAME, model, provider, temperature);
  emit("agent_start", { agent: NAME, step: 5, total: 6, model, provider });

  // ── Input context ──────────────────────────────────────────────────
  logger.context("preferences", state.preferences);
  logger.context("destinationResearch", state.destinationResearch);

  // ── Prompt ─────────────────────────────────────────────────────────
  const prompt = buildLogisticsPrompt(
    state.preferences,
    state.destinationResearch,
  );
  logger.prompt(typeof prompt === "string" ? prompt : JSON.stringify(prompt));

  // ── LLM call ───────────────────────────────────────────────────────
  logger.llmCall(model, provider);
  const response = await llm.invoke(prompt);
  logger.llmResponse(response.content);

  // ── Parse ──────────────────────────────────────────────────────────
  const result = safeParseJSON(response.content);
  if (!result.ok) {
    logger.error(`${NAME}: JSON parse failed — ${result.error}`);
    return { errors: [`Logistics Agent parse error: ${result.error}`] };
  }

  // ── State update ───────────────────────────────────────────────────
  logger.stateUpdate("logistics", result.data);
  logger.agentEnd(NAME, Date.now() - t0);
  emit("agent_done", { agent: NAME, step: 5, total: 6 });
  return { logistics: result.data };
}
