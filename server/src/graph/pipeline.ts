import {
  StateGraph,
  START,
  END,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { TripState, type TripStateType } from "./state.js";
import { applyAnswers, parseRequest } from "../tools/parseRequest.js";
import {
  AGENTS,
  missingEssentials,
  route,
  type AgentName,
} from "../tools/route.js";
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

/**
 * Deterministic: settle the constraints and pick the agent set. No model call —
 * which is what keeps the routing decision unit-testable.
 */
function parseNode(state: TripStateType) {
  // Form answers are folded over the free-text parse: given field by field, they
  // are more reliable than anything inferred from a sentence.
  const constraints = applyAnswers(parseRequest(state.request), state.answers);

  // Nothing to plan from — ask instead of spending model calls on a guess.
  // An empty route sends the graph straight to synthesis, which short-circuits.
  //
  // Asked once only. Coming back from the form with every box blank is itself an
  // answer — "you choose" — and asking the same four questions again would be a
  // loop with no way out. With nowhere settled the Destination Agent runs and
  // suggests somewhere, which is what the form offered to do.
  const answered = Object.keys(state.answers).length > 0;
  const needs = answered ? [] : missingEssentials(constraints);
  if (needs.length > 0) return { constraints, needs, route: [] };

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
  const pending = state.route.find((agent) => !done.has(agent));
  if (pending) return pending;

  const plans = ran(state, "itinerary");
  const prices = ran(state, "budget");

  // A revised itinerary has to be re-priced, or the total describes the old trip.
  if (plans > prices) return "budget";
  if (plans === 1 && worthReplanning(state)) return "itinerary";

  return "synthesize";
}

const ran = (state: TripStateType, agent: AgentName): number =>
  state.completed.filter((a) => a === agent).length;

/**
 * Under this share of the budget, the trip is worth rebuilding longer rather
 * than merely noting the underspend.
 *
 * Looser than the guard's 0.6 note, because acting costs two model calls where
 * noting costs nothing. Over budget has no equivalent threshold: any overage on
 * a length we chose is worth one more pass.
 */
const REPLAN_BELOW = 0.7;

/**
 * The one backwards edge in the graph.
 *
 * The Budget Agent is the only one holding a costed, itemised total — the
 * Destination Agent's estimate is a guess, and it misses in both directions: it
 * guessed 850,000 for a trip that priced at 560,000, then 850,000 for one that
 * priced at 1,110,000. So the first pass is really a measurement. Send the trip
 * back to be planned at the length that real per-day cost affords, then re-price
 * it.
 *
 * Only when the length was ours to choose. A trip they asked to be five days
 * long stays five days and reports the overage honestly — resizing someone's
 * stated trip to make the numbers work is the silent fitting the Budget Agent's
 * guard exists to prevent. This is the opposite: the numbers are fixed and the
 * assumption moves.
 *
 * Bounded to one lap, and disclosed through the same guard channel.
 */
function worthReplanning(state: TripStateType): boolean {
  const budget = state.budget;
  const max = state.constraints?.budget?.max;

  // A stated length is a decision, not a variable.
  if (!budget || !state.itinerary || state.constraints?.days != null) return false;
  if (max == null || budget.verdict === "unstated") return false;

  // Too long for the budget, or so far under it that they were sold short.
  return budget.overBudget || budget.total < max * REPLAN_BELOW;
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

/**
 * Merges the agents' output into one answer. Adds nothing of its own.
 *
 * Written straight into the run's custom stream as the model produces it, so the
 * page renders the answer while it is being written rather than after.
 */
async function synthesizeNode(
  state: TripStateType,
  config: LangGraphRunnableConfig,
) {
  // The request could not be planned. Ask, without calling a model — the
  // questions came from the deterministic parser, so there is nothing to generate.
  // The questions themselves render as a form, so this is only the lead-in.
  if (state.needs.length > 0) {
    return {
      answer:
        "Happy to help plan this. Tell me a little about the trip and I'll get started — anything you're unsure about, leave blank and I'll suggest something.",
    };
  }

  // Who to credit. Deduped because a replan puts Itinerary and Budget in the
  // trace twice, and crediting an agent twice reads as five agents, not three.
  const contributors = [
    ...new Set(
      state.trace
        .filter((t) => t.ok && (AGENTS as readonly string[]).includes(t.agent))
        .map((t) => t.agent),
    ),
  ];

  if (contributors.length === 0) {
    const why = state.trace
      .filter((t) => !t.ok)
      .map((t) => `- ${t.agent}: ${t.error}`)
      .join("\n");
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
            `### Day ${d.day}: ${d.title}\nMorning: ${d.morning}\nAfternoon: ${d.afternoon}\nEvening: ${d.evening}\nTravel: ${d.travelNotes}\nSpend for the day: ${d.estimatedSpend}${
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
    (delta) => config.writer?.(delta),
  );

  return { answer: data.markdown };
}

/**
 * Forward targets per agent, plus the single backwards edge: Budget can send a
 * trip back to Itinerary to be re-planned longer. That is the only cycle in the
 * graph, and `next` bounds it to one lap.
 */
function onward(after: AgentName | null): Record<string, NodeName> {
  const from = after ? AGENTS.indexOf(after) + 1 : 0;

  // Keys are what `next` returns; values are the nodes those map to.
  const targets: Record<string, NodeName> = { synthesize: NODE.SYNTHESIZE };
  for (const agent of AGENTS.slice(from)) targets[agent] = NODE_FOR[agent];
  if (after === "budget") targets.itinerary = NODE.ITINERARY;
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
