import {
  StateGraph,
  START,
  END,
  interrupt,
  MemorySaver,
} from "@langchain/langgraph";
import { TravelState } from "./state.js";
import { preferenceAgent } from "../agents/preferenceAgent.js";
import { supervisorAgent } from "../agents/supervisorAgent.js";
import { destinationResearchAgent } from "../agents/destinationResearchAgent.js";
import { budgetAgent } from "../agents/budgetAgent.js";
import { itineraryAgent } from "../agents/itineraryAgent.js";
import { logisticsAgent } from "../agents/logisticsAgent.js";
import { finalPlannerAgent } from "../agents/finalPlannerAgent.js";
import { checkClarificationNeeded } from "../utils/clarificationChecker.js";

// Node names must not clash with state key names.
export const NODE = {
  PREFERENCE: "preferenceNode",
  SUPERVISOR: "supervisorNode",
  DESTINATION: "destinationNode",
  BUDGET: "budgetNode",
  ITINERARY: "itineraryNode",
  LOGISTICS: "logisticsNode",
  FINAL: "finalPlannerNode",
};

/**
 * Preference node with built-in human-in-the-loop support via LangGraph's
 * interrupt() primitive.
 *
 * Flow:
 *  1. Run the Preference Agent on the user's (possibly vague) request.
 *  2. Check if critical fields are missing.
 *  3. If yes → call interrupt(message).
 *     - The graph pauses and surfaces `message` to the caller via the stream.
 *     - The MemorySaver checkpointer persists full graph state automatically.
 *     - When the route resumes the graph with Command({ resume: userAnswer }),
 *       interrupt() returns `userAnswer` here and execution continues.
 *  4. Re-run the Preference Agent with the enriched request, then proceed.
 */
async function preferenceNodeWithHITL(state) {
  const result = await preferenceAgent(state);
  const preferences = result.preferences ?? {};

  const { needsClarification, message } = checkClarificationNeeded(preferences);

  if (needsClarification) {
    // ── LangGraph interrupt ────────────────────────────────────────────────
    // Pauses the graph. `message` is surfaced as the interrupt value in the
    // stream chunk: { __interrupt__: [{ value: message, ... }] }
    // Resumes when the caller passes Command({ resume: userAnswer }).
    const userAnswer = interrupt(message);
    // ──────────────────────────────────────────────────────────────────────

    const enrichedRequest = `${state.userRequest}\n\nAdditional details provided by the user: ${userAnswer}`;

    const enrichedResult = await preferenceAgent({
      ...state,
      userRequest: enrichedRequest,
    });

    return {
      userRequest: enrichedRequest,
      preferences: enrichedResult.preferences ?? preferences,
    };
  }

  return result;
}

// ── Singleton checkpointer ─────────────────────────────────────────────────────
// MemorySaver stores thread checkpoints in process memory.
// thread_id = MongoDB session._id — ties each session to its graph state so
// that /clarify can resume exactly where /plan was interrupted.
const checkpointer = new MemorySaver();

export function buildTravelGraph() {
  return (
    new StateGraph(TravelState)
      .addNode(NODE.PREFERENCE, preferenceNodeWithHITL)
      .addNode(NODE.SUPERVISOR, supervisorAgent)
      .addNode(NODE.DESTINATION, destinationResearchAgent)
      .addNode(NODE.BUDGET, budgetAgent)
      .addNode(NODE.ITINERARY, itineraryAgent)
      .addNode(NODE.LOGISTICS, logisticsAgent)
      .addNode(NODE.FINAL, finalPlannerAgent)
      // PREFERENCE always goes to SUPERVISOR
      .addEdge(START, NODE.PREFERENCE)
      .addEdge(NODE.PREFERENCE, NODE.SUPERVISOR)
      // SUPERVISOR conditionally routes to the cheapest valid entry point
      .addConditionalEdges(NODE.SUPERVISOR, (state) => state.entryPoint, {
        destination: NODE.DESTINATION,
        budget: NODE.BUDGET,
        itinerary: NODE.ITINERARY,
        logistics: NODE.LOGISTICS,
        final: NODE.FINAL,
      })
      // Linear edges continue from every possible entry point onward
      .addEdge(NODE.DESTINATION, NODE.BUDGET)
      .addEdge(NODE.BUDGET, NODE.ITINERARY)
      .addEdge(NODE.ITINERARY, NODE.LOGISTICS)
      .addEdge(NODE.LOGISTICS, NODE.FINAL)
      .addEdge(NODE.FINAL, END)
      .compile({ checkpointer })
  );
}

// Pre-built singleton imported by the route layer.
export const travelGraph = buildTravelGraph();
