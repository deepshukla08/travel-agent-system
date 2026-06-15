import { getLLM } from "../utils/llm.js";
import { buildBudgetPrompt } from "../prompts/budgetPrompt.js";
import { safeParseJSON } from "../utils/validateJson.js";
import { runWithTools } from "../utils/toolRunner.js";
import { getExchangeRateTool } from "../tools/currencyTool.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

const llm = getLLM({ level: "fast", temperature: 0.2 });
const { model, provider, temperature } = llm._meta;
const TOOLS = [getExchangeRateTool];

export async function budgetAgent(state) {
  const t0 = Date.now();
  const NAME = "Budget Agent";

  logger.agentStart(NAME, model, provider, temperature);
  emit("agent_start", { agent: NAME, step: 3, total: 6, model, provider });

  const prompt = buildBudgetPrompt(
    state.preferences,
    state.destinationResearch,
  );

  // ── LLM + tool-calling loop ────────────────────────────────────────
  const responseText = await runWithTools(llm, TOOLS, prompt, NAME);

  // ── Parse ──────────────────────────────────────────────────────────
  const result = safeParseJSON(responseText);
  if (!result.ok) {
    logger.error(`${NAME}: JSON parse failed — ${result.error}`);
    return { errors: [`Budget Agent parse error: ${result.error}`] };
  }

  logger.stateUpdate("budgetPlan", result.data);
  logger.agentEnd(NAME, Date.now() - t0);
  emit("agent_done", { agent: NAME, step: 3, total: 6 });
  return { budgetPlan: result.data };
}
