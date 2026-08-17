import { logger } from "../utils/logger.js";

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.path} — ${err.stack ?? err.message}`);

  // The full message can carry connection strings and provider payloads, so it
  // stays in the server log. Clients get the status and nothing more.
  res.status(err.status ?? 500).json({ error: "Internal server error" });
}
