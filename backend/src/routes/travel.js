import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Session } from "../db/models/Session.js";
import { Plan } from "../db/models/Plan.js";
import { AgentRun } from "../db/models/AgentRun.js";
import { logger } from "../utils/logger.js";
import { travelGraph } from "../graph/travelGraph.js";
import { emitterStorage } from "../utils/emitter.js";
import { getLLM, callLLM, normaliseContent } from "../utils/llm.js";

const router = Router();

/** Write one SSE frame and flush immediately */
function sseWrite(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function setupSSE(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // stop proxies buffering the stream
  res.flushHeaders();
}

/**
 * Stream the travel graph, forwarding agent events to SSE.
 *
 * `input` is either an initial state object for a new run, or
 * Command({ resume }) to continue a run paused at interrupt().
 *
 * Returns { interrupted: true, message } or { interrupted: false, finalState }.
 */
async function streamGraphWithSSE(res, input, threadId) {
  const graphConfig = { configurable: { thread_id: threadId } };

  let interruptMessage = null;

  // Agents call emit() with no HTTP knowledge; AsyncLocalStorage carries the
  // writer for this request down to them.
  await emitterStorage.run(
    (type, data) => sseWrite(res, type, data),
    async () => {
      const stream = await travelGraph.stream(input, {
        ...graphConfig,
        streamMode: "updates",
      });

      for await (const chunk of stream) {
        if ("__interrupt__" in chunk) {
          interruptMessage =
            chunk.__interrupt__[0]?.value ?? "More details needed.";
          return; // state is held by the checkpointer
        }
      }
    },
  );

  if (interruptMessage !== null) {
    return { interrupted: true, message: interruptMessage };
  }

  const { values: finalState } = await travelGraph.getState(graphConfig);
  return { interrupted: false, finalState };
}

/**
 * Persist a completed run and emit the terminal SSE frame.
 *
 * Shared by /plan, /clarify and /followup so all three record the same audit
 * fields — attribution that only some endpoints wrote would be a broken trail.
 */
async function finishRun({ res, session, runId, userRequest, finalState }) {
  const contributors = finalState.contributors ?? [];

  session.messages.push({
    role: "assistant",
    content: finalState.finalPlan,
    contributors,
  });
  await session.save();

  const plan = await Plan.create({
    runId,
    sessionId: session._id,
    userRequest,
    route: finalState.route ?? [],
    contributors,
    preferences: finalState.preferences,
    destination: finalState.destination,
    itinerary: finalState.itinerary,
    budget: finalState.budget,
    finalPlan: finalState.finalPlan,
    budgetFlagged: finalState.budget?.withinBudget === false,
    runErrors: finalState.errors ?? [],
  });

  sseWrite(res, "done", {
    sessionId: session._id,
    planId: plan._id,
    runId,
    finalPlan: finalState.finalPlan,
    contributors,
    route: finalState.route ?? [],
    budget: finalState.budget ?? null,
    itinerary: finalState.itinerary ?? null,
    destination: finalState.destination ?? null,
    errors: finalState.errors ?? [],
  });
  res.end();
}

/** SSE has already sent 200 + headers, so errors must go down the stream. */
function failStream(res, err, next) {
  logger.error(err.message);
  if (res.headersSent) {
    sseWrite(res, "error", { message: err.message });
    res.end();
    return;
  }
  next(err);
}

/**
 * POST /api/travel/plan
 * Body: { userRequest: string }
 */
router.post("/plan", async (req, res, next) => {
  try {
    const { userRequest } = req.body;
    if (!userRequest?.trim()) {
      return res.status(400).json({ error: "userRequest is required" });
    }

    const session = await Session.create({
      messages: [{ role: "user", content: userRequest }],
    });
    const runId = randomUUID();

    logger.graphStart(userRequest);
    setupSSE(res);
    sseWrite(res, "start", { message: "Planning started", userRequest, runId });

    // thread_id = session id so /clarify can resume this exact graph thread
    const result = await streamGraphWithSSE(
      res,
      {
        userRequest,
        runId,
        sessionId: session._id.toString(),
        errors: [],
      },
      session._id.toString(),
    );

    if (result.interrupted) {
      session.awaitingClarification = true;
      await session.save();
      sseWrite(res, "clarify", {
        sessionId: session._id,
        message: result.message,
      });
      return res.end();
    }

    await finishRun({
      res,
      session,
      runId,
      userRequest,
      finalState: result.finalState,
    });
  } catch (err) {
    failStream(res, err, next);
  }
});

/**
 * POST /api/travel/clarify/:sessionId
 * Resumes a run paused at interrupt() with the user's answer.
 * Body: { clarification: string }
 */
router.post("/clarify/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { clarification } = req.body;

    if (!clarification?.trim()) {
      return res.status(400).json({ error: "clarification is required" });
    }

    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!session.awaitingClarification) {
      return res
        .status(400)
        .json({ error: "Session is not awaiting clarification" });
    }

    session.messages.push({ role: "user", content: clarification });
    session.awaitingClarification = false;
    await session.save();

    const runId = randomUUID();
    setupSSE(res);
    sseWrite(res, "start", { message: "Got it — planning now...", runId });

    const result = await streamGraphWithSSE(
      res,
      new Command({ resume: clarification }),
      sessionId,
    );

    if (result.interrupted) {
      session.awaitingClarification = true;
      await session.save();
      sseWrite(res, "clarify", { sessionId, message: result.message });
      return res.end();
    }

    await finishRun({
      res,
      session,
      runId,
      userRequest: clarification,
      finalState: result.finalState,
    });
  } catch (err) {
    failStream(res, err, next);
  }
});

/**
 * POST /api/travel/followup/:sessionId
 * Either answers a question about the existing plan directly, or re-runs the
 * graph to modify it. Body: { userRequest: string }
 */
router.post("/followup/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { userRequest } = req.body;

    if (!userRequest?.trim()) {
      return res.status(400).json({ error: "userRequest is required" });
    }

    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const lastPlan = await Plan.findOne({ sessionId }).sort({ createdAt: -1 });

    session.messages.push({ role: "user", content: userRequest });
    await session.save();

    const isModification = await classifyFollowUpIntent(userRequest, lastPlan);

    setupSSE(res);

    // A question about the plan does not need the agents re-run.
    if (!isModification) {
      sseWrite(res, "start", { message: "Thinking...", userRequest });
      const answer = await answerFollowUpDirectly(userRequest, lastPlan);
      session.messages.push({ role: "assistant", content: answer });
      await session.save();
      sseWrite(res, "done", {
        sessionId: session._id,
        finalPlan: answer,
        contributors: [],
        errors: [],
      });
      return res.end();
    }

    const runId = randomUUID();
    sseWrite(res, "start", { message: "Updating your plan...", userRequest, runId });

    // A fresh thread, seeded with prior output so the router can skip agents
    // whose work still stands.
    const result = await streamGraphWithSSE(
      res,
      {
        userRequest: buildFollowUpRequest(userRequest, lastPlan),
        runId,
        sessionId,
        errors: [],
        preferences: lastPlan?.preferences ?? null,
        destination: lastPlan?.destination ?? null,
        itinerary: lastPlan?.itinerary ?? null,
        budget: lastPlan?.budget ?? null,
      },
      `${sessionId}-followup-${runId}`,
    );

    // Follow-ups can interrupt too. The previous version destructured
    // finalState unconditionally here and threw on that path.
    if (result.interrupted) {
      session.awaitingClarification = true;
      await session.save();
      sseWrite(res, "clarify", { sessionId, message: result.message });
      return res.end();
    }

    await finishRun({
      res,
      session,
      runId,
      userRequest,
      finalState: result.finalState,
    });
  } catch (err) {
    failStream(res, err, next);
  }
});

// ── Read endpoints ───────────────────────────────────────────────────────────

/** GET /api/travel/sessions */
router.get("/sessions", async (req, res, next) => {
  try {
    const sessions = await Session.find({}, "messages createdAt updatedAt").sort(
      { updatedAt: -1 },
    );

    res.json({
      sessions: sessions.map((s) => {
        const firstUserMsg = s.messages?.find((m) => m.role === "user");
        // ObjectIds carry a creation timestamp, so there is always a fallback
        // for documents written before timestamps were enabled.
        const fallback = s._id.getTimestamp();
        return {
          _id: s._id,
          title: firstUserMsg
            ? firstUserMsg.content.slice(0, 80)
            : "New conversation",
          createdAt: s.createdAt ?? fallback,
          updatedAt: s.updatedAt ?? s.createdAt ?? fallback,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/travel/session/:sessionId/messages */
router.get("/session/:sessionId/messages", async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.sessionId, "messages");
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ messages: session.messages });
  } catch (err) {
    next(err);
  }
});

/** GET /api/travel/plans */
router.get("/plans", async (req, res, next) => {
  try {
    const plans = await Plan.find(
      {},
      "runId sessionId userRequest route contributors budgetFlagged createdAt",
    ).sort({ createdAt: -1 });
    res.json({ plans });
  } catch (err) {
    next(err);
  }
});

/** GET /api/travel/plans/:id */
router.get("/plans/:id", async (req, res, next) => {
  try {
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    res.json({ plan });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/travel/runs/:runId
 * The audit trail for one request: which agents ran, on which model, how long,
 * and whether they succeeded.
 */
router.get("/runs/:runId", async (req, res, next) => {
  try {
    const runs = await AgentRun.find({ runId: req.params.runId }).sort({
      createdAt: 1,
    });
    res.json({ runId: req.params.runId, agents: runs });
  } catch (err) {
    next(err);
  }
});

// ── Follow-up helpers ────────────────────────────────────────────────────────

function buildFollowUpRequest(followUp, lastPlan) {
  const previousPrefs = lastPlan?.preferences
    ? JSON.stringify(lastPlan.preferences, null, 2)
    : "None available";

  return `This is a follow-up to an existing travel plan.

Previously extracted preferences:
${previousPrefs}

The traveller now says: "${followUp}"

Update the plan accordingly. Keep everything they did not ask to change.`;
}

async function classifyFollowUpIntent(userRequest, lastPlan) {
  try {
    const llm = getLLM({ level: "fast", temperature: 0 });
    const destination = lastPlan?.preferences?.destination ?? "their destination";

    const response = await callLLM(
      llm,
      [
        new SystemMessage(
          `The user has an existing travel plan for ${destination}.
Decide whether their message is a MODIFICATION request (change, update, add, or remove
something in the plan) or a QUESTION/COMMENT about the existing plan.
Reply with exactly one word: MODIFY or QUESTION.`,
        ),
        new HumanMessage(userRequest),
      ],
      { label: "followup-intent" },
    );

    return normaliseContent(response.content).trim().toUpperCase() === "MODIFY";
  } catch {
    // Re-running the agents is the safer default: it may be slower, but it
    // cannot answer a modification request with stale content.
    return true;
  }
}

async function answerFollowUpDirectly(userRequest, lastPlan) {
  const llm = getLLM({ level: "fast", temperature: 0.5 });

  const context = lastPlan?.finalPlan
    ? `The current travel plan:\n\n${lastPlan.finalPlan}`
    : lastPlan?.preferences
      ? `Known preferences: ${JSON.stringify(lastPlan.preferences)}`
      : "No existing plan context available.";

  // Budget state is repeated explicitly so a chat reply cannot contradict the
  // Budget Agent's verdict and quietly imply an over-budget trip is affordable.
  const budgetNote =
    lastPlan?.budget?.withinBudget === false
      ? `\n\nNote: this trip is ${lastPlan.budget.overageAmount} ${lastPlan.budget.currency} OVER the stated budget. Do not imply it fits.`
      : "";

  const response = await callLLM(
    llm,
    [
      new SystemMessage(
        `You are a helpful travel assistant. Answer the user's question about their travel
plan concisely, using markdown where it helps. If they point out a problem, acknowledge it
and suggest a correction. Do not invent prices or venues that are not in the plan.`,
      ),
      new HumanMessage(`${context}${budgetNote}\n\nUser message: ${userRequest}`),
    ],
    { label: "followup-answer" },
  );

  return normaliseContent(response.content);
}

export default router;
