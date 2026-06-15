import { Router } from "express";
import { Command } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Session } from "../db/models/Session.js";
import { Plan } from "../db/models/Plan.js";
import { logger } from "../utils/logger.js";
import { travelGraph } from "../graph/travelGraph.js";
import { emitterStorage } from "../utils/emitter.js";
import { getLLM } from "../utils/llm.js";

const router = Router();

/** Write one SSE frame and flush immediately */
function sseWrite(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Set SSE response headers */
function setupSSE(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

/**
 * Stream the travel graph for a given thread, forwarding agent events to SSE.
 *
 * `input` is either:
 *   - an initial state object  { userRequest, errors: [] }   for new runs
 *   - Command({ resume: answer })                             to resume after interrupt
 *
 * Agents emit their own agent_start / agent_done events via emitterStorage
 * (AsyncLocalStorage), which are piped directly to the SSE response â€” no
 * manual per-node wrapping needed.
 *
 * Returns:
 *   { interrupted: true,  message }       â€” graph paused; clarification needed
 *   { interrupted: false, finalState }    â€” graph completed normally
 */
async function streamGraphWithSSE(res, input, threadId) {
  const graphConfig = { configurable: { thread_id: threadId } };
  const streamConfig = { ...graphConfig, streamMode: "updates" };

  let interruptMessage = null;

  // Run the graph stream inside the emitterStorage context so that every
  // emit() call inside an agent reaches the SSE response for this request.
  await emitterStorage.run(
    (type, data) => sseWrite(res, type, data),
    async () => {
      const stream = await travelGraph.stream(input, streamConfig);
      for await (const chunk of stream) {
        if ("__interrupt__" in chunk) {
          // LangGraph paused at interrupt() â€” surface the clarification message
          interruptMessage =
            chunk.__interrupt__[0]?.value ?? "More details needed.";
          return; // Stop consuming the stream; graph state is saved in MemorySaver
        }
        // Normal node completion â€” agents have already emitted agent_start / agent_done
      }
    },
  );

  if (interruptMessage !== null) {
    return { interrupted: true, message: interruptMessage };
  }

  // Stream finished â€” retrieve final accumulated state from the checkpointer
  const { values: finalState } = await travelGraph.getState(graphConfig);
  return { interrupted: false, finalState };
}

/**
 * POST /api/travel/plan
 * Start a new travel planning session â€” streams progress via SSE.
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
    logger.info(`New session ${session._id}: "${userRequest}"`);

    setupSSE(req, res);
    sseWrite(res, "start", { message: "Graph started", userRequest });

    // thread_id = session._id so that /clarify can resume the SAME graph thread
    const result = await streamGraphWithSSE(
      res,
      { userRequest, errors: [] },
      session._id.toString(),
    );

    if (result.interrupted) {
      // Graph paused â€” ask user for more details
      session.awaitingClarification = true;
      await session.save();

      sseWrite(res, "clarify", {
        sessionId: session._id,
        message: result.message,
      });
      res.end();
      return;
    }

    const { finalState } = result;
    session.messages.push({ role: "assistant", content: finalState.finalPlan });
    await session.save();

    const plan = await Plan.create({
      sessionId: session._id,
      userRequest,
      finalPlan: finalState.finalPlan,
      fullState: finalState,
    });

    sseWrite(res, "done", {
      sessionId: session._id,
      planId: plan._id,
      finalPlan: finalState.finalPlan,
      errors: finalState.errors ?? [],
    });
    res.end();
  } catch (err) {
    logger.error(err.message);
    try {
      sseWrite(res, "error", { message: err.message });
      res.end();
    } catch (_) {
      next(err);
    }
  }
});

/**
 * POST /api/travel/clarify/:sessionId
 * Human-in-the-loop: resume a paused graph after the user provides missing details.
 * Uses LangGraph's Command({ resume }) to continue from the exact interrupt() call
 * inside preferenceNodeWithHITL â€” no need to re-run from scratch.
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
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (!session.awaitingClarification) {
      return res
        .status(400)
        .json({ error: "Session is not awaiting clarification" });
    }

    session.messages.push({ role: "user", content: clarification });
    session.awaitingClarification = false;
    await session.save();

    logger.info(
      `Clarification received for session ${sessionId}: "${clarification}"`,
    );

    setupSSE(req, res);
    sseWrite(res, "start", {
      message: "Got it! Planning your trip now...",
      clarification,
    });

    // Resume the SAME graph thread â€” interrupt() returns `clarification` inside
    // preferenceNodeWithHITL, then the remaining nodes run to completion.
    const result = await streamGraphWithSSE(
      res,
      new Command({ resume: clarification }),
      sessionId,
    );

    if (result.interrupted) {
      // Edge case: another interrupt after the first (should not happen normally)
      session.awaitingClarification = true;
      await session.save();
      sseWrite(res, "clarify", { sessionId, message: result.message });
      res.end();
      return;
    }

    const { finalState } = result;
    session.messages.push({ role: "assistant", content: finalState.finalPlan });
    await session.save();

    const plan = await Plan.create({
      sessionId: session._id,
      userRequest: clarification,
      finalPlan: finalState.finalPlan,
      fullState: finalState,
    });

    sseWrite(res, "done", {
      sessionId: session._id,
      planId: plan._id,
      finalPlan: finalState.finalPlan,
      errors: finalState.errors ?? [],
    });
    res.end();
  } catch (err) {
    logger.error(err.message);
    try {
      sseWrite(res, "error", { message: err.message });
      res.end();
    } catch (_) {
      next(err);
    }
  }
});
/**
 * POST /api/travel/followup/:sessionId
 * Follow-up message -- either a question/comment answered directly by LLM,
 * or a plan modification request that re-runs the full agent graph.
 * Body: { userRequest: string }
 */
router.post("/followup/:sessionId", async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { userRequest } = req.body;

    if (!userRequest?.trim()) {
      return res.status(400).json({ error: "userRequest is required" });
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const lastPlan = await Plan.findOne({ sessionId }).sort({ createdAt: -1 });

    session.messages.push({ role: "user", content: userRequest });
    await session.save();
    logger.info(`Follow-up for session ${sessionId}: "${userRequest}"`);

    // Quickly decide: is the user asking to MODIFY the plan, or just asking a question/comment?
    const isModification = await classifyFollowUpIntent(
      userRequest,
      lastPlan?.fullState,
    );

    setupSSE(req, res);

    if (!isModification) {
      // Direct conversational answer -- no need to re-run agents
      sseWrite(res, "start", { message: "Thinking...", userRequest });
      const answer = await answerFollowUpDirectly(
        userRequest,
        lastPlan?.fullState,
        lastPlan?.finalPlan,
      );
      session.messages.push({ role: "assistant", content: answer });
      await session.save();
      sseWrite(res, "done", {
        sessionId: session._id,
        finalPlan: answer,
        errors: [],
      });
      res.end();
      return;
    }

    // Full graph re-run for plan modifications
    const contextRequest = buildFollowUpRequest(
      userRequest,
      lastPlan?.fullState,
    );
    sseWrite(res, "start", {
      message: "Updating your travel plan...",
      userRequest,
    });

    const followUpThreadId = `${sessionId}-followup-${Date.now()}`;
    // Pass existing plan state so the supervisor can decide which agents to skip
    const existingState = lastPlan?.fullState ?? {};
    const result = await streamGraphWithSSE(
      res,
      {
        userRequest: contextRequest,
        errors: [],
        // Carry forward computed state so supervisor can route intelligently
        preferences: existingState.preferences ?? null,
        destinationResearch: existingState.destinationResearch ?? null,
        budgetPlan: existingState.budgetPlan ?? null,
        itinerary: existingState.itinerary ?? null,
        logistics: existingState.logistics ?? null,
      },
      followUpThreadId,
    );

    const { finalState } = result;
    session.messages.push({ role: "assistant", content: finalState.finalPlan });
    await session.save();

    const plan = await Plan.create({
      sessionId: session._id,
      userRequest,
      finalPlan: finalState.finalPlan,
      fullState: finalState,
    });

    sseWrite(res, "done", {
      sessionId: session._id,
      planId: plan._id,
      finalPlan: finalState.finalPlan,
      errors: finalState.errors ?? [],
    });
    res.end();
  } catch (err) {
    logger.error(err.message);
    try {
      sseWrite(res, "error", { message: err.message });
      res.end();
    } catch (_) {
      next(err);
    }
  }
});

/**
 * GET /api/travel/sessions
 * Returns a list of all sessions with their first user message as a title.
 */
router.get("/sessions", async (req, res, next) => {
  try {
    const sessions = await Session.find({}, "messages createdAt updatedAt");

    const list = sessions
      .map((s) => {
        const firstUserMsg = s.messages?.find((m) => m.role === "user");
        // ObjectId always has a reliable embedded creation timestamp
        const fallbackDate = s._id.getTimestamp();
        const effectiveDate = s.updatedAt ?? s.createdAt ?? fallbackDate;
        return {
          _id: s._id,
          title: firstUserMsg
            ? firstUserMsg.content.slice(0, 80)
            : "New conversation",
          createdAt: s.createdAt ?? fallbackDate,
          updatedAt: effectiveDate,
          _sortMs: new Date(effectiveDate).getTime() || fallbackDate.getTime(),
        };
      })
      // Sort newest first in JS — avoids null-ordering ambiguity in MongoDB
      .sort((a, b) => b._sortMs - a._sortMs)
      .map(({ _sortMs, ...rest }) => rest); // strip internal sort key

    res.json({ sessions: list });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/travel/plans
 */
router.get("/plans", async (req, res, next) => {
  try {
    const plans = await Plan.find({}, "sessionId userRequest createdAt").sort({
      createdAt: -1,
    });
    res.json({ plans });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/travel/plans/:id
 */
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
 * GET /api/travel/session/:sessionId/messages
 */
router.get("/session/:sessionId/messages", async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.sessionId, "messages");
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ messages: session.messages });
  } catch (err) {
    next(err);
  }
});

function buildFollowUpRequest(followUp, lastState) {
  const previousPrefs = lastState?.preferences
    ? JSON.stringify(lastState.preferences, null, 2)
    : "None available";

  return `This is a follow-up to a previous travel plan.

Previous extracted preferences:
${previousPrefs}

User follow-up request: "${followUp}"

Update the travel plan based on this follow-up. Keep all previous details that the user did not mention changing.`;
}

async function classifyFollowUpIntent(userRequest, lastState) {
  try {
    const llm = getLLM({ level: "fast", temperature: 0 });
    const destination =
      lastState?.preferences?.destination ?? "the destination";
    const response = await llm.invoke([
      new SystemMessage(
        `You are a classifier. The user has an existing travel plan for ${destination}.
Decide if their message is a MODIFICATION request (they want to change, update, add, or remove something from the plan)
or a QUESTION/COMMENT (they are asking about, commenting on, or discussing the existing plan without changing it).
Reply with exactly one word: MODIFY or QUESTION.`,
      ),
      new HumanMessage(userRequest),
    ]);
    const verdict = (response.content ?? "").trim().toUpperCase();
    return verdict === "MODIFY";
  } catch {
    return true;
  }
}

async function answerFollowUpDirectly(userRequest, lastState, finalPlan) {
  const llm = getLLM({ level: "fast", temperature: 0.5 });
  const context = finalPlan
    ? `Here is the current travel plan:\n\n${finalPlan}`
    : lastState?.preferences
      ? `Preferences: ${JSON.stringify(lastState.preferences)}`
      : "No existing plan context available.";
  const response = await llm.invoke([
    new SystemMessage(
      `You are a helpful travel agent assistant. Answer the user's question or comment about their travel plan.
Be concise and helpful. If they point out an error or issue with the plan, acknowledge it and suggest a correction.
Use markdown formatting where appropriate.`,
    ),
    new HumanMessage(context + "\n\nUser message: " + userRequest),
  ]);
  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
}

export default router;
