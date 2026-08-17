import mongoose from "mongoose";

/**
 * One row per agent invocation — the audit trail of AI interactions.
 *
 * Written on failure as well as success: an agent that errored and left no
 * trace is the gap an audit log exists to close. Kept separate from Plan so
 * that "what ran" survives even when a run produced no plan at all.
 */
const agentRunSchema = new mongoose.Schema(
  {
    // Groups every agent belonging to a single user request.
    runId: { type: String, required: true, index: true },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },

    agent: {
      type: String,
      required: true,
      enum: ["destination", "itinerary", "budget"],
    },
    status: {
      type: String,
      required: true,
      enum: ["ok", "error"],
    },

    // Which model actually answered — needed to interpret a result months later,
    // since prompts and model versions both drift.
    model: String,
    provider: String,
    temperature: Number,

    latencyMs: Number,
    toolCalls: [{ name: String, ms: Number, ok: Boolean }],
    error: String,
  },
  { timestamps: true },
);

// The two real access patterns: replay one request, or list a session's history.
agentRunSchema.index({ sessionId: 1, createdAt: -1 });

export const AgentRun = mongoose.model("AgentRun", agentRunSchema);
