/**
 * Every shape, in one place. Components import types from here and nowhere else.
 * Mirrors server/src/schemas and the SSE events emitted by server/src/api/plan.ts.
 */

export type AgentName = "destination" | "itinerary" | "budget";

/** One question to put back to the traveller, rendered as a form field. */
export interface Need {
  id: "from" | "where" | "days" | "budget";
  label: string;
  hint: string;
}

export interface HardConstraint {
  kind:
    | "region"
    | "climate"
    | "maxBudget"
    | "maxFlightHours"
    | "avoid"
    | "month";
  value: string;
  /** The user's own words, so the UI can show what was matched. */
  raw: string;
}

export interface Constraints {
  /** Where the trip starts — what the flight cost actually depends on. */
  origin: string | null;
  destination: string | null;
  days: number | null;
  travellers: number | null;
  /** `currency` is null when an amount was given without one, e.g. "5k". */
  budget: { currency: string | null; max: number } | null;
  hard: HardConstraint[];
  interests: string[];
}

/** One per model call — drives attribution and the audit view. */
export interface Trace {
  agent: AgentName;
  model: string;
  ms: number;
  ok: boolean;
  /** Where the model was overruled in code. */
  guards: string[];
  error?: string;
}

/** One base on the trip, and how long you stay. */
export interface Leg {
  place: string;
  nights: number;
  note: string;
}

export interface Suggestion {
  name: string;
  country: string;
  /** Where they actually stay, in order — several for a longer trip. */
  legs: Leg[];
  /** The length the agent judged fits, used when none was stated. */
  suggestedDays: number;
  justification: string;
  constraintChecks: { kind: string; passes: boolean; reason: string }[];
  estimatedTotalCost: number;
}

export interface Day {
  day: number;
  title: string;
  morning: string;
  afternoon: string;
  evening: string;
  travelNotes: string;
  /** Food, transport and activities for the day, in the budget currency. */
  estimatedSpend: number;
  uncertain: boolean;
  uncertaintyReason: string | null;
}

export interface Budget {
  currency: string;
  items: { label: string; cost: number }[];
  total: number;
  /**
   * "unstated" means no budget was given, so there is nothing to be within.
   * Kept distinct from "within" because conflating them claimed a trip fitted a
   * limit the traveller had never set.
   */
  verdict: "within" | "over" | "unstated";
  overBudget: boolean;
  overage: number;
  /** Budget left unspent. Large headroom means a better trip was affordable. */
  headroom: number;
  alternative: {
    summary: string;
    changes: string[];
    newTotal: number;
  } | null;
  assumptions: string[];
}

/**
 * A finished trip. `runId` is null when the request could only be answered with
 * questions — there is nothing to store or reopen.
 */
export interface TripResult {
  runId: string | null;
  answer: string;
  route: AgentName[];
  trace: Trace[];
  constraints: Constraints | null;
  /** Present when the request needs more detail — rendered as a form. */
  needs: Need[];
  budget: Budget | null;
  itinerary: { destination: string; days: Day[] } | null;
  destination: { suggestions: Suggestion[] } | null;
}

/** The SSE stream, as a discriminated union. */
export type PlanEvent =
  | { type: "plan"; constraints: Constraints; route: AgentName[] }
  | { type: "agent"; trace: Trace }
  /** A piece of the answer, as the synthesiser writes it. */
  | { type: "token"; text: string }
  /**
   * The whole graph state after a node ran, sent only when the debug console is
   * on. Untyped on purpose: it is whatever TripState holds today, and pinning a
   * mirror of it here would need editing every time a channel is added.
   */
  | { type: "state"; state: Record<string, unknown> }
  | { type: "done"; result: TripResult }
  | { type: "error"; message: string };

export const AGENT_LABELS: Record<AgentName, string> = {
  destination: "Destination",
  itinerary: "Itinerary",
  budget: "Budget",
};
