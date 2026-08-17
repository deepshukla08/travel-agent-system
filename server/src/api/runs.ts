import { Router } from "express";
import { listRuns } from "../storage/runs.js";
import { wrap } from "./deps.js";

export const runsRouter = Router();

/**
 * GET /api/runs — the audit log.
 *
 * Stubbed role check: an `x-user-role: admin` header sees the full log, everyone
 * else sees their own recent runs only.
 *
 * ponytail: a header is trivially forgeable and is NOT access control. It exists
 * to show where the boundary goes. Upgrade path is Entra ID with App Roles
 * validated from a JWT, checked in this same middleware position.
 */
runsRouter.get(
  "/",
  wrap(async (req, res) => {
    const isAdmin = req.header("x-user-role") === "admin";

    const runs = listRuns(isAdmin ? 200 : 20);

    res.json({
      role: isAdmin ? "admin" : "user",
      // Only an admin sees which guards fired across everyone's runs — that is
      // the AI-behaviour audit, not ordinary user-facing data.
      runs: isAdmin
        ? runs
        : runs.map(({ guards_fired, ...rest }: Record<string, unknown>) => rest),
    });
  }),
);
