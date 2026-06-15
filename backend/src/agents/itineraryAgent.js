import { getLLM } from "../utils/llm.js";
import { buildItineraryPrompt } from "../prompts/itineraryPrompt.js";
import { safeParseJSON } from "../utils/validateJson.js";
import { runWithTools } from "../utils/toolRunner.js";
import { getCurrentDateTool, getTripDatesTool } from "../tools/dateTool.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

const llm = getLLM({ level: "smart", temperature: 0.5 });
const { model, provider, temperature } = llm._meta;
const TOOLS = [getCurrentDateTool, getTripDatesTool];

export async function itineraryAgent(state) {
  const t0 = Date.now();
  const NAME = "Itinerary Agent";

  logger.agentStart(NAME, model, provider, temperature);
  emit("agent_start", { agent: NAME, step: 4, total: 6, model, provider });

  const prompt = buildItineraryPrompt(
    state.preferences,
    state.destinationResearch,
    state.budgetPlan,
  );

  // ── LLM + tool-calling loop ────────────────────────────────────────
  const responseText = await runWithTools(llm, TOOLS, prompt, NAME);

  // ── Parse ──────────────────────────────────────────────────────────
  const result = safeParseJSON(responseText);
  if (!result.ok) {
    logger.error(`${NAME}: JSON parse failed — ${result.error}`);
    return { errors: [`Itinerary Agent parse error: ${result.error}`] };
  }

  logger.stateUpdate("itinerary", result.data);
  logger.agentEnd(NAME, Date.now() - t0);
  emit("agent_done", { agent: NAME, step: 4, total: 6 });
  return { itinerary: result.data };
}
