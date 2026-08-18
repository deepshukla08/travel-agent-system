import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTrip, streamPlan } from "./lib/api.js";
import { debugRun } from "./lib/debug.js";
import type { AgentName, Constraints, Trace, TripResult } from "./lib/types.js";
import { PromptPage } from "./components/PromptPage.js";
import { TripForm } from "./components/TripForm.js";
import { TripPage } from "./components/TripPage.js";
import { Working } from "./components/Working.js";

/**
 * One request in, one trip out.
 *
 * Deliberately not a chat. This was a conversation with carried constraints and
 * follow-up routing, and nearly every defect lived there — a forgotten budget, a
 * destination silently replaced, an aside becoming a travel preference. The brief
 * asks for a request and a synthesised answer, so that is the whole shape: ask,
 * watch the agents work, read the trip.
 */

/**
 * A trip gets a URL so it can be reopened and shared. The History API is enough
 * for two screens — a router would be a dependency for one route.
 */
function useTripId(): [string | null, (id: string | null) => void] {
  const read = () => /^\/trip\/([\w-]+)/.exec(window.location.pathname)?.[1] ?? null;
  const [id, setId] = useState<string | null>(read);

  useEffect(() => {
    const onPop = () => setId(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: string | null) => {
    window.history.pushState({}, "", next ? `/trip/${next}` : "/");
    setId(next);
  }, []);

  return [id, go];
}

export default function App() {
  const [tripId, goto] = useTripId();

  const [request, setRequest] = useState("");
  const [running, setRunning] = useState(false);
  const [constraints, setConstraints] = useState<Constraints | null>(null);
  const [route, setRoute] = useState<AgentName[]>([]);
  const [trace, setTrace] = useState<Trace[]>([]);
  const [result, setResult] = useState<TripResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);

  // Opening /trip/:id directly, or coming back to it, loads the stored trip.
  useEffect(() => {
    if (!tripId || result?.runId === tripId) return;

    let cancelled = false;
    fetchTrip(tripId)
      .then(({ request: asked, result: stored }) => {
        if (cancelled) return;
        setRequest(asked);
        setResult(stored);
        setConstraints(stored.constraints);
        setRoute(stored.route);
        setTrace(stored.trace);
        setError(null);
      })
      .catch((err: Error) => !cancelled && setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [tripId, result?.runId]);

  function reset() {
    abort.current?.abort();
    setRequest("");
    setConstraints(null);
    setRoute([]);
    setTrace([]);
    setResult(null);
    setError(null);
    goto(null);
  }

  async function plan(text: string, answers?: Record<string, string>) {
    const asked = text.trim();
    if (!asked || running) return;

    setRequest(asked);
    setRunning(true);
    setError(null);
    setResult(null);
    setConstraints(null);
    setRoute([]);
    setTrace([]);

    const controller = new AbortController();
    abort.current = controller;
    const log = debugRun(asked);

    try {
      for await (const event of streamPlan(asked, answers, controller.signal)) {
        log.event(event);

        switch (event.type) {
          case "plan":
            setConstraints(event.constraints);
            setRoute(event.route);
            break;
          case "agent":
            setTrace((prev) => [...prev, event.trace]);
            break;
          case "done":
            setResult(event.result);
            // A trip that was actually planned gets a URL; a set of questions
            // does not — there is nothing stored to reopen.
            if (event.result.runId) goto(event.result.runId);
            break;
          case "error":
            setError(event.message);
            break;
          case "token":
            // Prose arrives for the debug console; the page renders from the
            // finished result.
            break;
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = describeFailure(err);
        log.fail(message);
        setError(message);
      }
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  const asking = result?.needs.length ? result.needs : null;

  return (
    <div className="app">
      {running && (
        <Working
          request={request}
          constraints={constraints}
          route={route}
          trace={trace}
        />
      )}

      {!running && error && (
        <div className="landing">
          <h1>That didn't work</h1>
          <p className="error">{error}</p>
          <button type="button" onClick={reset}>
            Start again
          </button>
        </div>
      )}

      {/* Too vague to plan: ask once, with a form, then generate. */}
      {!running && !error && asking && (
        <div className="landing">
          <h1>Nearly there</h1>
          <p className="lede">{result?.answer}</p>
          <TripForm
            needs={asking}
            disabled={running}
            onSubmit={(text, answers) => void plan(text, answers)}
          />
        </div>
      )}

      {!running && !error && !asking && result && (
        <TripPage request={request} result={result} onNew={reset} />
      )}

      {!running && !error && !asking && !result && (
        <PromptPage
          disabled={running}
          onSubmit={(text) => void plan(text)}
          onOpen={goto}
        />
      )}
    </div>
  );
}

/**
 * A thrown stream failure, said in words.
 *
 * A dropped connection surfaces as "network error" or "Failed to fetch", which
 * reads like a bug report rather than something a reader can act on.
 */
function describeFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : "";

  if (/network error|failed to fetch|load failed/i.test(message)) {
    return "Lost the connection to the planner. It may still be starting up — try again in a moment.";
  }
  return message || "Something went wrong. Please try again.";
}
