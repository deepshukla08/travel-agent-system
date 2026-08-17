import { getLLM } from "../utils/llm.js";
import { buildItineraryPrompt } from "../prompts/itineraryPrompt.js";
import { runStructuredAgent } from "../utils/runStructuredAgent.js";
import { ItineraryOutputSchema } from "../schemas/agents.js";
import { getCurrentDateTool, getTripDatesTool } from "../tools/dateTool.js";
import { logger } from "../utils/logger.js";

export const NAME = "Itinerary Agent";

const llm = getLLM({ level: "smart", temperature: 0.5 });
const TOOLS = [getCurrentDateTool, getTripDatesTool];

export async function itineraryAgent(state) {
  const preferences = state.preferences ?? {};

  const itinerary = await runStructuredAgent({
    llm,
    tools: TOOLS,
    prompt: buildItineraryPrompt(preferences, state.destination),
    schema: ItineraryOutputSchema,
    name: NAME,
  });

  logger.stateUpdate("itinerary", {
    destination: itinerary.destination,
    totalDays: itinerary.totalDays,
    confidence: itinerary.confidence,
    uncertainties: itinerary.uncertainties.length,
  });

  return { itinerary };
}

export const itinerarySpec = {
  key: "itinerary",
  label: NAME,
  meta: llm._meta,
  run: itineraryAgent,
  // A failed itinerary still leaves a usable destination and budget answer.
  critical: false,
};
