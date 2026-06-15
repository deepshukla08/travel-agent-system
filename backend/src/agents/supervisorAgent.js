import { getLLM } from "../utils/llm.js";
import { buildSupervisorPrompt } from "../prompts/supervisorPrompt.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

const VALID_ENTRY_POINTS = [
  "destination",
  "budget",
  "itinerary",
  "logistics",
  "final",
];

const llm = getLLM({ level: "fast", temperature: 0 });

export async function supervisorAgent(state) {
  const NAME = "Supervisor";
  const t0 = Date.now();

  // Fresh request — no existing state, always run everything
  const hasAnyExistingState =
    state.destinationResearch ||
    state.budgetPlan ||
    state.itinerary ||
    state.logistics;

  if (!hasAnyExistingState) {
    logger.info(`${NAME}: fresh request → entry point = destination`);
    emit("agent_start", {
      agent: NAME,
      step: 1,
      total: 6,
      model: "fast",
      provider: "supervisor",
    });
    emit("agent_done", { agent: NAME, step: 1, total: 6 });
    return { entryPoint: "destination" };
  }

  emit("agent_start", {
    agent: NAME,
    step: 1,
    total: 6,
    model: "fast",
    provider: "supervisor",
  });
  logger.info(`${NAME}: classifying entry point for follow-up...`);

  try {
    const prompt = buildSupervisorPrompt(state);
    const response = await llm.invoke(prompt);
    const raw = (response.content ?? "").trim().toLowerCase();
    const entryPoint = VALID_ENTRY_POINTS.includes(raw) ? raw : "destination";

    logger.info(`${NAME}: entry point = ${entryPoint} (raw: "${raw}")`);
    emit("agent_done", { agent: NAME, step: 1, total: 6 });
    logger.agentEnd(NAME, Date.now() - t0);

    return { entryPoint };
  } catch (err) {
    logger.error(
      `${NAME}: classification failed — ${err.message}. Defaulting to destination.`,
    );
    emit("agent_done", { agent: NAME, step: 1, total: 6 });
    return { entryPoint: "destination" };
  }
}
