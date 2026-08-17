import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
  // Which agents produced this answer. Stored on the message so the UI can show
  // attribution when replaying a past conversation, not just live over SSE.
  contributors: { type: [String], default: undefined },
  createdAt: { type: Date, default: Date.now },
});

const sessionSchema = new mongoose.Schema(
  {
    messages: [messageSchema],
    awaitingClarification: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Session = mongoose.model("Session", sessionSchema);
