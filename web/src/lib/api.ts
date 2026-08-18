import type {
  AgentName,
  Constraints,
  PlanEvent,
  Trace,
  TripResult,
} from "./types.js";

/** Every network call, and nothing else. */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/**
 * A failed response, said in words a reader can act on.
 *
 * The API answers errors as `{"error":"..."}`. Putting that JSON on screen tells
 * someone planning a holiday nothing, so it is unwrapped, and the cases that are
 * really about the app being unreachable get said plainly.
 */
async function readableError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");

  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) detail = parsed.error;
  } catch {
    // Not JSON — a proxy or gateway page, so the raw text is no better.
  }

  if (response.status >= 500) {
    return "Something went wrong on our side. Please try that again.";
  }
  if (response.status === 404) {
    return "I couldn't find that trip.";
  }
  return detail || `That didn't go through (${response.status}).`;
}

/**
 * POST /api/plan and yield each SSE event as it arrives.
 *
 * A hand-rolled reader rather than EventSource, because EventSource cannot POST
 * a body. Frames are separated by a blank line, so the tail of each read is held
 * back until its terminator arrives.
 */
export async function* streamPlan(
  request: string,
  /** Field-by-field answers, when the request came back through the form. */
  answers?: Record<string, string>,
  signal?: AbortSignal,
): AsyncGenerator<PlanEvent> {
  const response = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request, answers }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await readableError(response));
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
      return { type: "done", result: data as unknown as TripResult };
    case "error":
      return { type: "error", message: String(data.message) };
    default:
      return null;
  }
}

/** A run as stored, before it is rebuilt into a TripResult. */
interface StoredRun {
  id: string;
  request: string;
  constraints: string | null;
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
}

/**
 * GET /api/plan/:id — a stored trip, rebuilt into what the page renders.
 *
 * Every agent's output was persisted, so a trip opened from its URL shows exactly
 * what was generated — banners, day plans, reasoning — without re-running an agent.
 * That is what makes a trip's link worth having.
 */
export async function fetchTrip(
  id: string,
): Promise<{ request: string; result: TripResult }> {
  const response = await fetch(`${BASE}/api/plan/${id}`);
  if (!response.ok) throw new Error(await readableError(response));

  const run = (await response.json()) as StoredRun;

  const output = (agent: AgentName) => {
    const row = run.agents.find((a) => a.agent === agent);
    return row?.output ? JSON.parse(row.output) : null;
  };

  return {
    request: run.request,
    result: {
      runId: run.id,
      answer: run.answer,
      route: JSON.parse(run.route) as AgentName[],
      constraints: run.constraints
        ? (JSON.parse(run.constraints) as Constraints)
        : null,
      trace: run.agents.map((a) => ({
        agent: a.agent,
        model: a.model,
        ms: a.ms,
        ok: a.ok === 1,
        guards: JSON.parse(a.guards) as string[],
        error: a.error ?? undefined,
      })),
      // A stored trip is finished; there is nothing left to ask.
      needs: [],
      budget: output("budget"),
      itinerary: output("itinerary"),
      destination: output("destination"),
    },
  };
}

export interface RecentTrip {
  id: string;
  request: string;
  constraints: string;
  route: string;
  total_ms: number;
  guards_fired: number;
  created_at: string;
}

/** GET /api/plan/recent — past trips, for the landing page. */
export async function fetchRecent(): Promise<RecentTrip[]> {
  const response = await fetch(`${BASE}/api/plan/recent`);
  if (!response.ok) throw new Error(await readableError(response));

  const data = (await response.json()) as { runs: RecentTrip[] };
  return data.runs;
}
