import { logger } from "../utils/logger.js";

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.path} — ${err.message}`);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
}
