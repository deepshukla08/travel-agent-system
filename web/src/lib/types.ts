/**
 * Every shape, in one place. Components import types from here and nowhere else.
 * Mirrors server/src/schemas and the SSE events emitted by server/src/api/plan.ts.
 */

export type AgentName = "destination" | "itinerary" | "budget";

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
  destination: string | null;
  days: number | null;
  travellers: number | null;
  budget: { currency: string; max: number } | null;
  hard: HardConstraint[];
  interests: string[];
}

/** One per agent invocation — drives attribution and the audit view. */
export interface Trace {
  agent: AgentName;
  model: string;
  ms: number;
  ok: boolean;
  /** Where the model was overruled in code. */
  guards: string[];
  error?: string;
}

export interface Suggestion {
  name: string;
  country: string;
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
  uncertain: boolean;
  uncertaintyReason: string | null;
}

export interface Budget {
  currency: string;
  items: { label: string; cost: number }[];
  total: number;
  overBudget: boolean;
  overage: number;
  alternative: {
    summary: string;
    changes: string[];
    newTotal: number;
  } | null;
  assumptions: string[];
}

export interface PlanResult {
  runId: string;
  answer: string;
  route: AgentName[];
  trace: Trace[];
  budget: Budget | null;
  itinerary: { destination: string; days: Day[] } | null;
  destination: { suggestions: Suggestion[] } | null;
}

/** The SSE stream, as a discriminated union. */
export type PlanEvent =
  | { type: "plan"; constraints: Constraints; route: AgentName[] }
  | { type: "agent"; trace: Trace }
  | { type: "done"; result: PlanResult }
  | { type: "error"; message: string };

export const AGENT_LABELS: Record<AgentName, string> = {
  destination: "Destination Agent",
  itinerary: "Itinerary Agent",
  budget: "Budget Agent",
};
