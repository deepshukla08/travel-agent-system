import type { PlanEvent, Trace, Constraints, PlanResult, AgentName } from "./types.js";

/** Every network call, and nothing else. */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/**
 * POST /api/plan and yield each SSE event as it arrives.
 *
 * A hand-rolled reader rather than EventSource, because EventSource cannot POST
 * a body. Frames are separated by a blank line, so the tail of each read is held
 * back until its terminator arrives.
 */
export async function* streamPlan(
  request: string,
  /** Earlier turns, oldest first — what makes "make it cheaper" mean something. */
  history: string[] = [],
  /** Undefined on the first turn; the server mints one and returns it in `done`. */
  conversationId?: string,
  signal?: AbortSignal,
): AsyncGenerator<PlanEvent> {
  const response = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request, history, conversationId }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    // The last piece is incomplete until the stream ends.
    buffer = done ? "" : (frames.pop() ?? "");

    for (const frame of frames) {
      const event = parseFrame(frame);
      if (event) yield event;
    }

    if (done) break;
  }
}

function parseFrame(frame: string): PlanEvent | null {
  let name = "";
  let raw = "";

  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) name = line.slice(7).trim();
    else if (line.startsWith("data: ")) raw = line.slice(6);
  }

  if (!name || !raw) return null;

  const data = JSON.parse(raw) as Record<string, unknown>;

  switch (name) {
    case "plan":
      return {
        type: "plan",
        constraints: data.constraints as Constraints,
        route: data.route as AgentName[],
      };
    case "agent":
      return { type: "agent", trace: data as unknown as Trace };
    case "token":
      return { type: "token", text: String(data.text) };
    case "done":
      return { type: "done", result: data as unknown as PlanResult };
    case "error":
      return { type: "error", message: String(data.message) };
    default:
      return null;
  }
}

export interface RunSummary {
  id: string;
  request: string;
  route: string;
  total_ms: number;
  guards_fired?: number;
  created_at: string;
}

/**
 * GET /api/plan/:id — a stored run, rebuilt into what the chat renders.
 *
 * Every agent's own output was persisted, so a run reopened from the sidebar shows
 * the same banners and thinking as when it was live, not just the prose.
 */
export async function fetchRun(id: string): Promise<{
  question: string;
  constraints: Constraints;
  result: PlanResult;
}> {
  const response = await fetch(`${BASE}/api/plan/${id}`);
  if (!response.ok) throw new Error(`Could not open that trip (${response.status})`);

  const run = (await response.json()) as {
    id: string;
    conversation_id: string | null;
    request: string;
    constraints: string;
    route: string;
    answer: string;
    agents: {
      agent: AgentName;
      model: string;
      ms: number;
      ok: number;
      guards: string;
      output: string | null;
      error: string | null;
    }[];
  };

  const output = (agent: AgentName) => {
    const row = run.agents.find((a) => a.agent === agent);
    return row?.output ? JSON.parse(row.output) : null;
  };

  return {
    question: run.request,
    constraints: JSON.parse(run.constraints) as Constraints,
    result: {
      runId: run.id,
      // Null only for runs stored before conversations existed; falling back to
      // the run id keeps each of those a conversation of one rather than merging
      // them all under a shared empty key.
      conversationId: run.conversation_id ?? run.id,
      answer: run.answer,
      route: JSON.parse(run.route) as AgentName[],
      trace: run.agents.map((a) => ({
        agent: a.agent,
        model: a.model,
        ms: a.ms,
        ok: a.ok === 1,
        guards: JSON.parse(a.guards) as string[],
        error: a.error ?? undefined,
      })),
      budget: output("budget"),
      itinerary: output("itinerary"),
      destination: output("destination"),
    },
  };
}

/** GET /api/runs — the audit log. `admin` sees every run and the guard counts. */
export async function fetchRuns(
  role: "user" | "admin",
): Promise<{ role: string; runs: RunSummary[] }> {
  const response = await fetch(`${BASE}/api/runs`, {
    headers: role === "admin" ? { "x-user-role": "admin" } : {},
  });
  if (!response.ok) throw new Error(`Could not load runs (${response.status})`);
  return response.json() as Promise<{ role: string; runs: RunSummary[] }>;
}
