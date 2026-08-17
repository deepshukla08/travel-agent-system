import { Router } from "express";
import { randomUUID } from "node:crypto";
import { PlanRequestSchema } from "../schemas/index.js";
import { pipeline } from "../graph/pipeline.js";
import type { TripStateType } from "../graph/state.js";
import { saveRun, getRun, getConversation } from "../storage/runs.js";
import { validate, notFound, wrap } from "./deps.js";

export const planRouter = Router();

/**
 * POST /api/plan — runs the graph, streaming one SSE event per node.
 *
 * Streamed in three modes at once: "updates" carries each node's patch, which is
 * what the activity feed renders live, "custom" carries the answer's tokens as
 * synthesis writes them, and "values" carries the accumulated state, whose last
 * emission is the final result. One pass, no re-running the graph to find out
 * what it produced.
 *
 * Persistence happens here, not in the agents — that is what keeps them pure.
 */
planRouter.post(
  "/",
  wrap(async (req, res) => {
    const { request, history, conversationId } = validate(
      PlanRequestSchema,
      req.body,
    );

    // Minted here on the first turn so the client never has to invent one; it
    // just echoes back whatever `done` gave it.
    const chatId = conversationId ?? randomUUID();

    // A follow-up ("make it cheaper") means nothing on its own, so the parser and
    // the agents are given the earlier turns too.
    //
    // ponytail: concatenation, not a summariser — a stale number in turn one can
    // still be picked up. Thread a real conversation state if that starts to bite.
    const conversation = [...(history ?? []), request].join("\n");

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
        { request: conversation },
        { streamMode: ["updates", "values", "custom"] },
      );

      for await (const [mode, data] of stream as AsyncIterable<
        [string, unknown]
      >) {
        if (mode === "values") {
          latest = data as TripStateType;
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
          // and what was extracted. The UI needs this before any agent starts.
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

    const runId = saveRun({
      request,
      conversationId: chatId,
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
      // The client echoes this back on the next turn, so a chat's runs stay joined.
      conversationId: chatId,
      answer: latest.answer,
      route: latest.route,
      trace: latest.trace,
      budget: latest.budget,
      itinerary: latest.itinerary,
      destination: latest.destination,
    });
    res.end();
  }),
);

/**
 * GET /api/plan/conversation/:id — every turn of one chat, oldest first.
 *
 * Declared before /:id so "conversation" is not swallowed as a run id.
 */
planRouter.get(
  "/conversation/:id",
  wrap(async (req, res) => {
    const chat = getConversation(String(req.params.id));
    if (!chat) return notFound(res, "conversation");
    res.json(chat);
  }),
);

/** GET /api/plan/:id — a stored run with its per-agent audit rows. */
planRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const run = getRun(String(req.params.id));
    if (!run) return notFound(res, "run");
    res.json(run);
  }),
);
