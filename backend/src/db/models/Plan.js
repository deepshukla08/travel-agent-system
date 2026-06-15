import mongoose from "mongoose";

const planSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Session",
    required: true,
  },
  userRequest: { type: String, required: true },
  finalPlan: { type: String },
  fullState: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

export const Plan = mongoose.model("Plan", planSchema);
