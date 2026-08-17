import mongoose from "mongoose";

/**
 * The outcome of one planning run.
 *
 * Agent output is stored under named fields rather than the previous single
 * opaque `fullState` blob, so a plan can be inspected without knowing the
 * graph's internals. The shapes themselves are already validated by the Zod
 * schemas at the agent boundary, so they are stored as Mixed rather than
 * restating those schemas here and having two definitions drift apart.
 */
const planSchema = new mongoose.Schema(
  {
    // Joins to the AgentRun audit rows for this request.
    runId: { type: String, index: true },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },

    userRequest: { type: String, required: true },

    // Which agents the orchestrator selected, and which actually contributed.
    // Persisted so attribution survives a page reload instead of living only
    // in the SSE stream.
    route: [String],
    contributors: [String],

    preferences: mongoose.Schema.Types.Mixed,
    destination: mongoose.Schema.Types.Mixed,
    itinerary: mongoose.Schema.Types.Mixed,
    budget: mongoose.Schema.Types.Mixed,

    finalPlan: String,

    // Denormalised for querying "which plans came in over budget" without
    // reaching into the budget sub-document.
    budgetFlagged: { type: Boolean, default: false },

    // Not named `errors`: that is a reserved Mongoose document path and would
    // collide with the document's own validation-error bag.
    runErrors: [String],
  },
  { timestamps: true },
);

planSchema.index({ sessionId: 1, createdAt: -1 });

export const Plan = mongoose.model("Plan", planSchema);
