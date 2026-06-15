import { getLLM } from "../utils/llm.js";
import { buildDestinationPrompt } from "../prompts/destinationPrompt.js";
import { safeParseJSON } from "../utils/validateJson.js";
import { runWithTools } from "../utils/toolRunner.js";
import { webSearchTool } from "../tools/webSearchTool.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

const llm = getLLM({ level: "smart", temperature: 0.4 });
const { model, provider, temperature } = llm._meta;
const TOOLS = [webSearchTool];

export async function destinationResearchAgent(state) {
  const t0 = Date.now();
  const NAME = "Destination Research Agent";

  logger.agentStart(NAME, model, provider, temperature);
  emit("agent_start", { agent: NAME, step: 2, total: 6, model, provider });

  const prompt = buildDestinationPrompt(state.preferences);

  // ── LLM + tool-calling loop ────────────────────────────────────────
  const responseText = await runWithTools(llm, TOOLS, prompt, NAME);

  // ── Parse ──────────────────────────────────────────────────────────
  const result = safeParseJSON(responseText);
  if (!result.ok) {
    logger.error(`${NAME}: JSON parse failed — ${result.error}`);
    return {
      errors: [`Destination Research Agent parse error: ${result.error}`],
    };
  }

  logger.stateUpdate("destinationResearch", result.data);
  logger.agentEnd(NAME, Date.now() - t0);
  emit("agent_done", { agent: NAME, step: 2, total: 6 });
  return { destinationResearch: result.data };
}
