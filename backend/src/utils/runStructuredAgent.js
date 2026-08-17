import { runWithTools } from "./toolRunner.js";
import { safeParseJSON } from "./validateJson.js";
import { validateOutput } from "../schemas/agents.js";
import { callLLM, normaliseContent } from "./llm.js";
import { logger } from "./logger.js";

const MAX_ATTEMPTS = 2; // first try + one repair

/**
 * Run an agent prompt and return output that is guaranteed to satisfy `schema`.
 *
 * Models drop required fields often enough that a single validation pass would
 * fail runs for cosmetic reasons. One repair attempt — with the exact
 * validation error fed back — recovers most of those cheaply. Two failures is a
 * real fault, so it throws and the caller decides whether to degrade or abort.
 *
 * Tools run on the first attempt only: a repair is a formatting fix, and
 * re-running web searches to correct a missing field wastes free-tier quota.
 */
export async function runStructuredAgent({
  llm,
  tools = [],
  prompt,
  schema,
  name = "Agent",
}) {
  let text = tools.length
    ? await runWithTools(llm, tools, prompt, name)
    : normaliseContent((await callLLM(llm, prompt, { label: name })).content);

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const parsed = safeParseJSON(text);

    if (parsed.ok) {
      const validated = validateOutput(schema, parsed.data);
      if (validated.ok) return validated.data;
      lastError = validated.error;
    } else {
      lastError = parsed.error;
    }

    if (attempt === MAX_ATTEMPTS) break;

    logger.warn(`${name}: output rejected (${lastError}) — repairing`);

    const repairPrompt = `${prompt}

---
Your previous response was REJECTED for this reason:
${lastError}

Your previous response was:
${text.slice(0, 2000)}

Return the corrected JSON only. No explanation, no markdown fences.`;

    text = normaliseContent(
      (await callLLM(llm, repairPrompt, { label: `${name} repair` })).content,
    );
  }

  throw new Error(`${name} returned invalid output — ${lastError}`);
}
