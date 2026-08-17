import { getLLM } from "../utils/llm.js";
import { buildDestinationPrompt } from "../prompts/destinationPrompt.js";
import { runStructuredAgent } from "../utils/runStructuredAgent.js";
import { DestinationOutputSchema } from "../schemas/agents.js";
import { webSearchTool } from "../tools/webSearchTool.js";
import { logger } from "../utils/logger.js";

export const NAME = "Destination Agent";

const llm = getLLM({ level: "smart", temperature: 0.4 });
const TOOLS = [webSearchTool];

/**
 * Drop any candidate that fails a hard constraint.
 *
 * This is the enforcement point for "must never recommend a destination that
 * breaks a hard constraint". The prompt asks the model to self-report
 * violations; this function is what makes the report matter. A model that lies
 * by marking a violation "pass" is a separate problem, but a model that is
 * honest can no longer have its own warning ignored.
 */
export function filterViolatingCandidates(candidates = []) {
  const kept = [];
  const violations = [];

  for (const candidate of candidates) {
    const failed = (candidate.constraintChecks ?? []).filter(
      (c) => c.verdict === "fail",
    );

    if (failed.length === 0) {
      kept.push(candidate);
      continue;
    }

    violations.push(
      `${candidate.name}: ${failed.map((f) => `${f.kind} — ${f.reason}`).join("; ")}`,
    );
  }

  return { kept, violations };
}

export async function destinationAgent(state) {
  const preferences = state.preferences ?? {};

  let output = await runStructuredAgent({
    llm,
    tools: TOOLS,
    prompt: buildDestinationPrompt(preferences),
    schema: DestinationOutputSchema,
    name: NAME,
  });

  let { kept, violations } = filterViolatingCandidates(output.candidates);

  // Everything broke a constraint — retry once, naming what was rejected, so
  // the model does not simply propose the same places again.
  if (kept.length === 0) {
    logger.warn(
      `${NAME}: all ${output.candidates.length} candidates violated a hard constraint — retrying`,
    );

    output = await runStructuredAgent({
      llm,
      tools: TOOLS,
      prompt: buildDestinationPrompt(preferences, violations),
      schema: DestinationOutputSchema,
      name: `${NAME} (retry)`,
    });

    ({ kept, violations } = filterViolatingCandidates(output.candidates));
  }

  if (kept.length === 0) {
    throw new Error(
      `${NAME}: no destination satisfies the stated hard constraints. Rejected: ${violations.join(" | ")}`,
    );
  }

  // The model's pick may have just been filtered out; fall back to the best survivor.
  const recommended = kept.some((c) => c.name === output.recommended)
    ? output.recommended
    : kept[0].name;

  const chosen = kept.find((c) => c.name === recommended);

  logger.stateUpdate("destination", { recommended, considered: kept.length });

  return {
    destination: {
      candidates: kept,
      recommended,
      rejected: violations,
    },
    // Downstream agents need a plain destination name to work with.
    resolvedDestination: recommended,
    resolvedCountry: chosen?.country ?? null,
  };
}

/** Everything the orchestrator needs to run, label, and audit this agent. */
export const destinationSpec = {
  key: "destination",
  label: NAME,
  meta: llm._meta,
  run: destinationAgent,
  // Nothing downstream is meaningful without somewhere to go.
  critical: true,
};
