import {
  StateGraph,
  START,
  END,
  interrupt,
  MemorySaver,
} from "@langchain/langgraph";
import { TravelState } from "./state.js";
import { destinationSpec } from "../agents/destinationAgent.js";
import { itinerarySpec } from "../agents/itineraryAgent.js";
import { budgetSpec } from "../agents/budgetAgent.js";
import { extractPreferences } from "../orchestrator/preferences.js";
import { routeRequest } from "../orchestrator/router.js";
import { synthesise } from "../orchestrator/synthesise.js";
import { checkClarificationNeeded } from "../utils/clarificationChecker.js";
import { AgentRun } from "../db/models/AgentRun.js";
import { logger } from "../utils/logger.js";
import { emit } from "../utils/emitter.js";

// Node names must not collide with state key names.
export const NODE = {
  PREFERENCES: "preferencesNode",
  ROUTER: "routerNode",
  DESTINATION: "destinationNode",
  ITINERARY: "itineraryNode",
  BUDGET: "budgetNode",
  SYNTHESISE: "synthesiseNode",
};

/**
 * The three specialised agents, in dependency order. Everything else in this
 * file is orchestration: Itinerary needs somewhere to go, and Budget prices a
 * plan once it exists, so a route is always a subset of this sequence.
 */
const SPECS = [destinationSpec, itinerarySpec, budgetSpec];
const AGENT_ORDER = SPECS.map((s) => s.key);

const NODE_FOR_AGENT = {
  destination: NODE.DESTINATION,
  itinerary: NODE.ITINERARY,
  budget: NODE.BUDGET,
};

/**
 * Write one audit row per agent invocation. Never allowed to break a run — a
 * logging failure must not cost the user their travel plan.
 */
async function recordRun(state, row) {
  if (!state.runId || !state.sessionId) return;

  try {
    await AgentRun.create({
      runId: state.runId,
      sessionId: state.sessionId,
      ...row,
    });
  } catch (err) {
    logger.error(`Audit write failed for ${row.agent} — ${err.message}`);
  }
}

/**
 * Wraps an agent so every invocation is timed, streamed, and audited in one
 * place. Agents stay pure functions of state; attribution and bookkeeping live
 * here rather than being repeated in each of them.
 */
function agentNode(spec) {
  return async function node(state) {
    const t0 = Date.now();
    const { key, label, meta, critical } = spec;

    emit("agent_start", {
      agent: label,
      model: meta.model,
      provider: meta.provider,
    });

    try {
      const patch = await spec.run(state);
      const latencyMs = Date.now() - t0;

      logger.agentEnd(label, latencyMs);
      emit("agent_done", { agent: label, ms: latencyMs });
      await recordRun(state, { agent: key, status: "ok", latencyMs, ...meta });

      return { ...patch, completed: [key], contributors: [label] };
    } catch (err) {
      const latencyMs = Date.now() - t0;

      logger.error(`${label} failed — ${err.message}`);
      emit("agent_error", { agent: label, message: err.message });
      await recordRun(state, {
        agent: key,
        status: "error",
        latencyMs,
        error: err.message,
        ...meta,
      });

      return {
        completed: [key],
        errors: [`${label}: ${err.message}`],
        // A critical agent failing makes the rest of the route pointless.
        // Emptying it sends the graph straight to synthesis, which reports the
        // failure honestly instead of building on nothing.
        ...(critical ? { route: [] } : {}),
      };
    }
  };
}

/**
 * Preference extraction with human-in-the-loop clarification.
 *
 * interrupt() pauses the graph and surfaces `message` through the stream; the
 * checkpointer holds the state until the route resumes with
 * Command({ resume: answer }), at which point interrupt() returns that answer.
 */
async function preferencesNode(state) {
  const preferences = await extractPreferences(state.userRequest);

  const { needsClarification, message } = checkClarificationNeeded(preferences);
  if (!needsClarification) return { preferences };

  const answer = interrupt(message);

  const enrichedRequest = `${state.userRequest}\n\nAdditional details provided by the user: ${answer}`;

  return {
    userRequest: enrichedRequest,
    preferences: await extractPreferences(enrichedRequest),
  };
}

async function routerNode(state) {
  const route = await routeRequest(state.userRequest, state.preferences, {
    destination: state.destination,
    itinerary: state.itinerary,
    budget: state.budget,
  });

  return { route };
}

/**
 * Advance to the next agent the route still needs.
 *
 * This is what makes routing a set rather than an offset: any subset of the
 * three can run, in dependency order, and the graph falls through to synthesis
 * once the route is exhausted.
 */
export function pickNext(state) {
  const done = new Set(state.completed ?? []);
  const next = (state.route ?? []).find((agent) => !done.has(agent));
  return next ?? "synthesise";
}

/**
 * The nodes reachable from a given point in the sequence.
 *
 * Only forward targets are declared. pickNext never returns an already
 * completed agent, so a self-edge could not be taken — but declaring one would
 * put a cycle in the compiled graph and invite the reader to wonder whether it
 * can loop. `null` means "from the router", where every agent is still ahead.
 */
function onwardFrom(afterKey) {
  const start = afterKey ? AGENT_ORDER.indexOf(afterKey) + 1 : 0;

  const targets = { synthesise: NODE.SYNTHESISE };
  for (const key of AGENT_ORDER.slice(start)) {
    targets[key] = NODE_FOR_AGENT[key];
  }
  return targets;
}

// ponytail: MemorySaver keeps checkpoints in process memory. A restart drops any
// run paused awaiting clarification while Mongo still says awaitingClarification,
// and it cannot be shared across instances. Fine for a single-instance deploy;
// swap in MongoDBSaver when running more than one.
const checkpointer = new MemorySaver();

export function buildTravelGraph() {
  const graph = new StateGraph(TravelState)
    .addNode(NODE.PREFERENCES, preferencesNode)
    .addNode(NODE.ROUTER, routerNode)
    .addNode(NODE.SYNTHESISE, synthesise);

  for (const spec of SPECS) {
    graph.addNode(NODE_FOR_AGENT[spec.key], agentNode(spec));
  }

  graph
    .addEdge(START, NODE.PREFERENCES)
    .addEdge(NODE.PREFERENCES, NODE.ROUTER)
    .addConditionalEdges(NODE.ROUTER, pickNext, onwardFrom(null));

  for (const spec of SPECS) {
    graph.addConditionalEdges(
      NODE_FOR_AGENT[spec.key],
      pickNext,
      onwardFrom(spec.key),
    );
  }

  graph.addEdge(NODE.SYNTHESISE, END);

  return graph.compile({ checkpointer });
}

export const travelGraph = buildTravelGraph();
