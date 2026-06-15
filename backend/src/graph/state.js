import { Annotation } from "@langchain/langgraph";

export const TravelState = Annotation.Root({
  userRequest: Annotation({
    reducer: (a, b) => (b !== undefined ? b : a),
    default: () => "",
  }),
  preferences: Annotation({
    reducer: (a, b) => (b !== undefined ? b : a),
    default: () => null,
  }),
  destinationResearch: Annotation({
    reducer: (a, b) => (b !== undefined ? b : a),
    default: () => null,
  }),
  budgetPlan: Annotation({
    reducer: (a, b) => (b !== undefined ? b : a),
    default: () => null,
  }),
  itinerary: Annotation({
    reducer: (a, b) => (b !== undefined ? b : a),
    default: () => null,
  }),
  logistics: Annotation({
    reducer: (a, b) => (b !== undefined ? b : a),
    default: () => null,
  }),
  finalPlan: Annotation({
    reducer: (a, b) => (b !== undefined ? b : a),
    default: () => "",
  }),
  errors: Annotation({
    reducer: (a, b) => [...(a || []), ...(b || [])],
    default: () => [],
  }),
  // Set by the supervisor node — determines which agent to enter next
  entryPoint: Annotation({
    reducer: (a, b) => (b !== undefined ? b : a),
    default: () => "destination",
  }),
});
