import { Annotation } from "@langchain/langgraph";
import type {
  BudgetResult,
  Constraints,
  DestinationResult,
  ItineraryResult,
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
  overBudget: boolean;
  overage: number;
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

export const TripState = Annotation.Root({
  request: Annotation<string>(replace<string>("")),

  // Filled by tools/, no model involved.
  constraints: Annotation<Constraints | null>(replace<Constraints | null>(null)),
  route: Annotation<AgentName[]>(replace<AgentName[]>([])),

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
