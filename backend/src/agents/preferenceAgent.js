import { getLLM } from "../utils/llm.js";
import { buildPreferencePrompt } from "../prompts/preferencePrompt.js";
import { safeParseJSON } from "../utils/validateJson.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

const llm = getLLM({ level: "fast", temperature: 0 });
const { model, provider, temperature } = llm._meta;

export async function preferenceAgent(state) {
  const t0 = Date.now();
  const NAME = "Preference Agent";

  logger.agentStart(NAME, model, provider, temperature);
  emit("agent_start", { agent: NAME, step: 1, total: 6, model, provider });

  // ── Input context ──────────────────────────────────────────────────
  logger.context("userRequest", { userRequest: state.userRequest });

  // ── Prompt ─────────────────────────────────────────────────────────
  const prompt = buildPreferencePrompt(state.userRequest);
  logger.prompt(typeof prompt === "string" ? prompt : JSON.stringify(prompt));

  // ── LLM call ───────────────────────────────────────────────────────
  logger.llmCall(model, provider);
  const response = await llm.invoke(prompt);
  logger.llmResponse(response.content);

  // ── Parse ──────────────────────────────────────────────────────────
  const result = safeParseJSON(response.content);
  if (!result.ok) {
    logger.error(`${NAME}: JSON parse failed — ${result.error}`);
    return { errors: [`Preference Agent parse error: ${result.error}`] };
  }

  // ── State update ───────────────────────────────────────────────────
  logger.stateUpdate("preferences", result.data);
  logger.agentEnd(NAME, Date.now() - t0);
  emit("agent_done", { agent: NAME, step: 1, total: 6, output: result.data });
  return { preferences: result.data };
}
