import { getLLM, callLLM, normaliseContent } from "../utils/llm.js";
import { buildSynthesisePrompt } from "../prompts/synthesisePrompt.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

/**
 * Merges the agents' output into one coherent answer.
 *
 * An orchestration step, not an agent: it contributes no travel knowledge and
 * is explicitly forbidden from adding recommendations of its own, so that every
 * claim in the final document is traceable to one of the three agents.
 */
const llm = getLLM({ level: "smart", temperature: 0.4 });

export async function synthesise(state) {
  const t0 = Date.now();
  const contributors = state.contributors ?? [];

  emit("stage", { stage: "synthesis", status: "start" });

  // Nothing succeeded — say so rather than asking the model to write about nothing.
  if (!state.destination && !state.itinerary && !state.budget) {
    emit("stage", { stage: "synthesis", status: "error" });
    const detail = state.errors?.length
      ? state.errors.join("; ")
      : "no agent produced any output";
    return {
      finalPlan: `I could not put a plan together for this request.\n\n**What went wrong:** ${detail}\n\nPlease try again, or rephrase your request with a bit more detail.`,
    };
  }

  const response = await callLLM(
    llm,
    buildSynthesisePrompt(state, contributors),
    { label: "synthesis", timeoutMs: 90_000 },
  );

  const finalPlan = normaliseContent(response.content);

  logger.stateUpdate("finalPlan", `${finalPlan.slice(0, 160)}...`);
  emit("stage", { stage: "synthesis", status: "done", ms: Date.now() - t0 });

  return { finalPlan };
}
