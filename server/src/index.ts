import express, { type Express } from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { planRouter } from "./api/plan.js";
import { runsRouter } from "./api/runs.js";
import { errorHandler } from "./api/deps.js";

/** Assembles the app: middleware and routes, nothing else. */
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: config.allowedOrigins }));
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", models: config.modelChain });
  });

  app.use("/api/plan", planRouter);
  app.use("/api/runs", runsRouter);

  app.use(errorHandler);
  return app;
}

// Listen only when this file is the entrypoint, so the API checks can import
// createApp() and bind their own ephemeral port instead.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(config.port, () => {
    console.log(`server listening on http://localhost:${config.port}`);
    console.log(`model chain: ${config.modelChain.join(" → ")}`);
  });
}
