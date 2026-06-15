// SSE streaming calls go DIRECTLY to the backend, bypassing the Vite proxy
// which cannot reliably stream chunked responses.
const BACKEND = "http://localhost:3000";

/**
 * Stream a travel plan or follow-up via SSE.
 */
async function streamRequest(url, body, onProgress) {
  const res = await fetch(BACKEND + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function parseFrame(frame) {
    if (!frame.trim()) return null;
    let type = "message";
    let dataLine = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) type = line.slice(7).trim();
      if (line.startsWith("data: ")) dataLine = line.slice(6).trim();
    }
    if (!dataLine) return null;
    return { type, data: JSON.parse(dataLine) };
  }

  while (true) {
    const { value, done } = await reader.read();

    if (!done) {
      buffer += decoder.decode(value, { stream: true });
    }

    const frames = buffer.split("\n\n");
    buffer = done ? "" : (frames.pop() ?? "");

    for (const frame of frames) {
      const parsed = parseFrame(frame);
      if (!parsed) continue;
      const { type, data } = parsed;
      // Terminal events: handle immediately without yielding
      if (type === "done") {
        onProgress?.({ type, data });
        return data;
      }
      if (type === "clarify") {
        onProgress?.({ type, data });
        return { ...data, needsClarification: true };
      }
      if (type === "error") throw new Error(data.message || "Server error");
      // Yield to the browser's render pipeline before calling onProgress.
      // requestAnimationFrame fires just before the browser's next paint,
      // guaranteeing each state update is actually drawn on screen.
      await new Promise((r) => requestAnimationFrame(r));
      onProgress?.({ type, data });
    }

    if (done) break;
  }

  throw new Error("Stream ended without a done event");
}

export function startPlan(userRequest, onProgress) {
  return streamRequest("/api/travel/plan", { userRequest }, onProgress);
}

export function sendFollowUp(sessionId, userRequest, onProgress) {
  return streamRequest(
    `/api/travel/followup/${sessionId}`,
    { userRequest },
    onProgress,
  );
}

export function sendClarification(sessionId, clarification, onProgress) {
  return streamRequest(
    `/api/travel/clarify/${sessionId}`,
    { clarification },
    onProgress,
  );
}

import axios from "axios";
const api = axios.create({ baseURL: "http://localhost:3000/api/travel" });

export async function getSessions() {
  const { data } = await api.get("/sessions");
  return data.sessions;
}

export async function getSessionMessages(sessionId) {
  const { data } = await api.get(`/session/${sessionId}/messages`);
  return data.messages;
}

export async function listPlans() {
  const { data } = await api.get("/plans");
  return data.plans;
}
