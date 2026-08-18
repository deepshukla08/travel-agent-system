import { Annotation } from "@langchain/langgraph";
import type {
  Answers,
  BudgetResult,
  Constraints,
  DestinationResult,
  ItineraryResult,
  Need,
} from "../schemas/index.js";
import type { AgentName } from "../tools/route.js";

/** One entry per agent that ran — the audit trail and the UI attribution. */
export interface Trace {
  agent: AgentName;
  model: string;
  ms: number;
  ok: boolean;
  /** Which guards fired. This is what makes it an audit of AI behaviour. */
  guards: string[];
  error?: string;
}

export type GuardedBudget = BudgetResult & {
  /** "unstated" is not the same as "within" — see guardBudget. */
  verdict: "within" | "over" | "unstated";
  overBudget: boolean;
  overage: number;
  /** Budget left unspent. Large headroom means a better trip was affordable. */
  headroom: number;
};

/**
 * Last write wins — every field using this has a single producer.
 *
 * Called with an explicit type argument on purpose: inferring from `initial`
 * would make replace(null) resolve T to `null` and reject every real value.
 */
function replace<T>(initial: T) {
  return {
    reducer: (a: T, b: T | undefined): T => (b !== undefined ? b : a),
    default: () => initial,
  };
}

/**
 * Appends. Required on any field more than one node writes: without a reducer
 * the last node to finish silently overwrites the others, which produces less
 * output and no error.
 */
function append<T>() {
  return {
    reducer: (a: T[], b: T[] | undefined): T[] => [...(a ?? []), ...(b ?? [])],
    default: (): T[] => [],
  };
}

/**
 * One run, start to finish. No conversation state: a request either has enough to
 * plan from or gets one round of questions, and that is the whole lifecycle.
 */
export const TripState = Annotation.Root({
  request: Annotation<string>(replace<string>("")),

  /** Field-by-field answers when the request came back through the form. */
  answers: Annotation<Answers>(replace<Answers>({})),


  // Settled by tools/, no model involved.
  constraints: Annotation<Constraints | null>(replace<Constraints | null>(null)),
  route: Annotation<AgentName[]>(replace<AgentName[]>([])),

  /** Questions to put back when the request cannot be planned at all. */
  needs: Annotation<Need[]>(replace<Need[]>([])),

  // One field per agent.
  destination: Annotation<DestinationResult | null>(
    replace<DestinationResult | null>(null),
  ),
  itinerary: Annotation<ItineraryResult | null>(
    replace<ItineraryResult | null>(null),
  ),
  budget: Annotation<GuardedBudget | null>(replace<GuardedBudget | null>(null)),

  /** Which agent produced what, in the order they ran. */
  trace: Annotation<Trace[]>(append<Trace>()),
  completed: Annotation<AgentName[]>(append<AgentName>()),

  answer: Annotation<string>(replace<string>("")),
});

export type TripStateType = typeof TripState.State;
