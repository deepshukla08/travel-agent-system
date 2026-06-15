import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true },
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
