import { Router } from "express";
import { PlanRequestSchema } from "../schemas/index.js";
import { pipeline } from "../graph/pipeline.js";
import type { TripStateType } from "../graph/state.js";
import { saveRun, getRun, listRuns } from "../storage/runs.js";
import { validate, notFound, wrap } from "./deps.js";

export const planRouter = Router();

/**
 * POST /api/plan — runs the graph, streaming one SSE event per node.
 *
 * Streamed in three modes at once: "updates" carries each node's patch, which is
 * what the activity view renders live, "custom" carries the answer's prose as
 * synthesis writes it, and "values" carries the accumulated state, whose last
 * emission is the final result. One pass, no re-running the graph to find out
 * what it produced.
 *
 * Persistence happens here, not in the agents — that is what keeps them pure.
 */
planRouter.post(
  "/",
  wrap(async (req, res) => {
    const { request, answers, debug } = validate(PlanRequestSchema, req.body);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // stop proxies buffering the stream
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const started = Date.now();
    let latest: TripStateType | null = null;

    try {
      const stream = await pipeline.stream(
        { request, answers: answers ?? {} },
        { streamMode: ["updates", "values", "custom"] },
      );

      for await (const [mode, data] of stream as AsyncIterable<
        [string, unknown]
      >) {
        if (mode === "values") {
          latest = data as TripStateType;
          // The whole state after every node, for the debug console: what each
          // node actually wrote, rather than what the UI chose to render.
          if (debug) send("state", data);
          continue;
        }

        // One SSE frame per piece of prose the synthesiser writes.
        if (mode === "custom") {
          send("token", { text: String(data) });
          continue;
        }

        for (const [node, update] of Object.entries(
          data as Record<string, Partial<TripStateType>>,
        )) {
          // The parse node publishes the routing decision: which agents will run
          // and what was extracted. The view needs this before any agent starts.
          if (node === "parse") {
            send("plan", { constraints: update.constraints, route: update.route });
            continue;
          }

          // Each agent reports itself through its trace entry, so attribution
          // comes from the same data the audit log stores.
          const entry = update.trace?.[0];
          if (entry) send("agent", entry);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`plan run failed — ${message}`);
      send("error", { message });
      res.end();
      return;
    }

    if (!latest) {
      send("error", { message: "The graph produced no state." });
      res.end();
      return;
    }

    // A run that only asked questions is not a trip, so it is not stored — there is
    // nothing to reopen, and the audit log is for work that was actually done.
    const runId =
      latest.needs.length > 0
        ? null
        : saveRun({
            request,
            constraints: latest.constraints,
            route: latest.route,
            answer: latest.answer,
            totalMs: Date.now() - started,
            trace: latest.trace,
            outputs: {
              destination: latest.destination,
              itinerary: latest.itinerary,
              budget: latest.budget,
            },
          });

    send("done", {
      runId,
      answer: latest.answer,
      route: latest.route,
      trace: latest.trace,
      needs: latest.needs,
      constraints: latest.constraints,
      budget: latest.budget,
      itinerary: latest.itinerary,
      destination: latest.destination,
    });
    res.end();
  }),
);

/** GET /api/plan/recent — past trips, for the landing page. */
planRouter.get(
  "/recent",
  wrap(async (_req, res) => {
    res.json({ runs: listRuns(20) });
  }),
);

/**
 * GET /api/plan/:id — a stored trip with its per-agent audit rows.
 *
 * This is what makes a trip's URL worth having: it reopens exactly as generated,
 * banners and reasoning included, without re-running a single agent.
 */
planRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const run = getRun(String(req.params.id));
    if (!run) return notFound(res, "trip");
    res.json(run);
  }),
);
