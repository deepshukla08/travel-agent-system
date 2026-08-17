import { StateGraph, START, END } from "@langchain/langgraph";
import { TripState, type TripStateType } from "./state.js";
import { parseRequest } from "../tools/parseRequest.js";
import { AGENTS, route, type AgentName } from "../tools/route.js";
import { destinationAgent } from "../agents/destination.js";
import { itineraryAgent } from "../agents/itinerary.js";
import { budgetAgent } from "../agents/budget.js";
import { generate } from "../agents/model.js";
import { prompt } from "../agents/prompts.js";
import { AgentError } from "../agents/guards.js";
import { z } from "zod/v4";

/**
 * Node names are suffixed because LangGraph forbids a node sharing a name with a
 * state channel, and each agent writes a channel of its own name.
 */
const NODE = {
  PARSE: "parse",
  DESTINATION: "destinationAgent",
  ITINERARY: "itineraryAgent",
  BUDGET: "budgetAgent",
  SYNTHESIZE: "synthesize",
} as const;

type NodeName = (typeof NODE)[keyof typeof NODE];

const NODE_FOR: Record<AgentName, NodeName> = {
  destination: NODE.DESTINATION,
  itinerary: NODE.ITINERARY,
  budget: NODE.BUDGET,
};

/** Deterministic: parse the request and decide the route. No model call. */
function parseNode(state: TripStateType) {
  const constraints = parseRequest(state.request);
  return { constraints, route: route(state.request, constraints) };
}

/**
 * The conditional edge. Advances to the next agent the route still needs, then
 * falls through to synthesis.
 *
 * Routing lives in the edge rather than in if-statements inside a node, so the
 * compiled graph encodes which agents can run — and `completed` is the audit
 * trail and the "which agents contributed" display, for free.
 */
export function next(state: TripStateType): AgentName | "synthesize" {
  const done = new Set(state.completed);
  return state.route.find((agent) => !done.has(agent)) ?? "synthesize";
}

/**
 * Wraps an agent so a failure is recorded and the run continues honestly.
 *
 * A guard throwing is a correct outcome, not a crash — the run reports what went
 * wrong instead of presenting a plan that breaks a stated constraint.
 */
function guarded(
  agent: AgentName,
  fn: (state: TripStateType) => Promise<Partial<TripStateType>>,
) {
  return async (state: TripStateType): Promise<Partial<TripStateType>> => {
    try {
      return await fn(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isGuard = err instanceof AgentError;

      console.error(`[${agent}] ${isGuard ? "guard fired" : "failed"}: ${message}`);

      return {
        completed: [agent],
        trace: [
          {
            agent,
            model: "-",
            ms: 0,
            ok: false,
            guards: isGuard ? [message] : [],
            error: message,
          },
        ],
      };
    }
  };
}

const AnswerSchema = z.object({ markdown: z.string() });

/** Merges the agents' output into one answer. Adds nothing of its own. */
async function synthesizeNode(state: TripStateType) {
  const contributors = state.trace.filter((t) => t.ok).map((t) => t.agent);

  if (contributors.length === 0) {
    const why = state.trace.map((t) => `- ${t.agent}: ${t.error}`).join("\n");
    return {
      answer: `I could not build a plan for this request.\n\n${why || "- no agent ran"}`,
    };
  }

  const sections: string[] = [];
  if (state.destination) {
    sections.push(
      `## From the Destination Agent\n\n${state.destination.suggestions
        .map(
          (s) =>
            `### ${s.name}, ${s.country} (est. ${s.estimatedTotalCost})\n${s.justification}`,
        )
        .join("\n\n")}`,
    );
  }
  if (state.itinerary) {
    sections.push(
      `## From the Itinerary Agent\n\n${state.itinerary.days
        .map(
          (d) =>
            `### Day ${d.day}: ${d.title}\nMorning: ${d.morning}\nAfternoon: ${d.afternoon}\nEvening: ${d.evening}\nTravel: ${d.travelNotes}${
              d.uncertain ? `\nUNCERTAIN: ${d.uncertaintyReason}` : ""
            }`,
        )
        .join("\n\n")}`,
    );
  }
  if (state.budget) {
    sections.push(
      `## From the Budget Agent\n\n${state.budget.items
        .map((i) => `- ${i.label}: ${i.cost}`)
        .join("\n")}\nTotal: ${state.budget.total} ${state.budget.currency}`,
    );
  }

  // Told explicitly, because burying an overage in prose would recreate the exact
  // failure the Budget Agent exists to prevent.
  const directives: string[] = [];
  if (state.budget?.overBudget) {
    directives.push(
      `## Required: this trip is over budget

It exceeds the stated budget by ${state.budget.overage} ${state.budget.currency}. Lead the
Budget section with that fact as an explicit callout, state the estimate and the budget, then
present this cheaper alternative as a concrete option:

${JSON.stringify(state.budget.alternative, null, 2)}

Never present an over-budget trip as if it fits.`,
    );
  }
  const flagged = state.itinerary?.days.filter((d) => d.uncertain) ?? [];
  if (flagged.length > 0) {
    directives.push(
      `## Required: carry the uncertainties through

Days ${flagged.map((d) => d.day).join(", ")} were flagged uncertain. Keep them in a "Worth
checking before you book" list. Do not drop them to make the plan read as more certain.`,
    );
  }
  const failures = state.trace.filter((t) => !t.ok);
  if (failures.length > 0) {
    directives.push(
      `## Required: say what is missing

These agents did not complete: ${failures.map((f) => `${f.agent} (${f.error})`).join("; ")}.
Say plainly which part is missing. Do not invent the missing content.`,
    );
  }

  const { data } = await generate(
    AnswerSchema,
    prompt("synthesize", {
      request: state.request,
      contributors: contributors.join(", "),
      sections: sections.join("\n\n"),
      directives: directives.join("\n\n"),
    }),
  );

  return { answer: data.markdown };
}

/**
 * Only forward targets are declared per agent. `next` never returns a completed
 * agent, so a self-edge is unreachable — declaring one would put a cycle in the
 * compiled graph and invite the reader to wonder whether it can loop.
 */
function onward(after: AgentName | null): Record<string, NodeName> {
  const from = after ? AGENTS.indexOf(after) + 1 : 0;

  // Keys are what `next` returns; values are the nodes those map to.
  const targets: Record<string, NodeName> = { synthesize: NODE.SYNTHESIZE };
  for (const agent of AGENTS.slice(from)) targets[agent] = NODE_FOR[agent];
  return targets;
}

export function buildPipeline() {
  const graph = new StateGraph(TripState)
    .addNode(NODE.PARSE, parseNode)
    .addNode(NODE.DESTINATION, guarded("destination", destinationAgent))
    .addNode(NODE.ITINERARY, guarded("itinerary", itineraryAgent))
    .addNode(NODE.BUDGET, guarded("budget", budgetAgent))
    .addNode(NODE.SYNTHESIZE, synthesizeNode)
    .addEdge(START, NODE.PARSE)
    .addConditionalEdges(NODE.PARSE, next, onward(null))
    .addConditionalEdges(NODE.DESTINATION, next, onward("destination"))
    .addConditionalEdges(NODE.ITINERARY, next, onward("itinerary"))
    .addConditionalEdges(NODE.BUDGET, next, onward("budget"))
    .addEdge(NODE.SYNTHESIZE, END);

  return graph.compile();
}

export const pipeline = buildPipeline();
