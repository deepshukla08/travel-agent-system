import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db/database.js";
import travelRoutes from "./routes/travel.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { logger } from "./utils/logger.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/travel", travelRoutes);
app.use(errorHandler);

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    logger.success(`Server running on http://localhost:${PORT}`);
    logger.info("POST /api/travel/plan                     — new travel plan");
    logger.info("POST /api/travel/followup/:sessionId      — refine a plan");
    logger.info("GET  /api/travel/plans                    — list all plans");
    logger.info("GET  /api/travel/plans/:id                — get one plan");
    logger.info(
      "GET  /api/travel/session/:id/messages     — conversation history",
    );
  });
}

start().catch((err) => {
  logger.error(err.message);
  process.exit(1);
});
