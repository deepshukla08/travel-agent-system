import { Annotation } from "@langchain/langgraph";

/** Last write wins — the default for every single-producer field. */
const replace = (defaultValue) => ({
  reducer: (a, b) => (b !== undefined ? b : a),
  default: () => defaultValue,
});

/** Appends, so parallel or repeated writes accumulate instead of clobbering. */
const append = () => ({
  reducer: (a, b) => [...(a || []), ...(b || [])],
  default: () => [],
});

export const TravelState = Annotation.Root({
  userRequest: Annotation(replace("")),

  // Identity of this run — carried in state so the audit rows can be written
  // from the node wrapper without a second context mechanism.
  runId: Annotation(replace(null)),
  sessionId: Annotation(replace(null)),

  preferences: Annotation(replace(null)),

  // ── The three agents' output ──────────────────────────────────────────────
  destination: Annotation(replace(null)),
  itinerary: Annotation(replace(null)),
  budget: Annotation(replace(null)),

  // Convenience fields the Destination Agent resolves for downstream agents.
  resolvedDestination: Annotation(replace(null)),
  resolvedCountry: Annotation(replace(null)),

  // ── Orchestration ─────────────────────────────────────────────────────────
  // The ordered set of agents this request needs. Replaces the old single
  // entryPoint, which could only skip a prefix of a fixed chain.
  route: Annotation(replace([])),
  completed: Annotation(append()),
  contributors: Annotation(append()),

  finalPlan: Annotation(replace("")),
  errors: Annotation(append()),
});
