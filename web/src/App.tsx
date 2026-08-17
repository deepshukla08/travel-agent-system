import { useState } from "react";
import { streamPlan } from "./lib/api.js";
import type { AgentName, Constraints, PlanResult, Trace } from "./lib/types.js";
import { AgentActivity } from "./components/AgentActivity.js";
import { Answer } from "./components/Answer.js";
import { RunLog } from "./components/RunLog.js";

const EXAMPLES = [
  "A five day trip somewhere warm in Europe for under £1500",
  "Plan 4 days in Lisbon for 2 people",
  "Roughly what does a week in Rome cost?",
  "Where should I go for a warm February break?",
];

export default function App() {
  const [request, setRequest] = useState("");
  const [running, setRunning] = useState(false);
  const [constraints, setConstraints] = useState<Constraints | null>(null);
  const [route, setRoute] = useState<AgentName[]>([]);
  const [trace, setTrace] = useState<Trace[]>([]);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(text: string) {
    if (!text.trim() || running) return;

    setRunning(true);
    setError(null);
    setResult(null);
    setConstraints(null);
    setRoute([]);
    setTrace([]);

    try {
      for await (const event of streamPlan(text)) {
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
            break;
          case "error":
            setError(event.message);
            break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Trip Planner</h1>
        <p className="muted">
          Three specialised agents. An orchestrator decides which ones your
          request needs.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(request);
        }}
      >
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Describe the trip you want…"
          rows={3}
          disabled={running}
        />
        <div className="row">
          <button type="submit" disabled={running || !request.trim()}>
            {running ? "Planning…" : "Plan my trip"}
          </button>
        </div>
      </form>

      {!constraints && !running && (
        <div className="examples">
          <span className="muted small">Try:</span>
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              className="link"
              onClick={() => {
                setRequest(e);
                void submit(e);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <AgentActivity
        constraints={constraints}
        route={route}
        trace={trace}
        running={running}
      />

      {result && <Answer result={result} />}

      <RunLog />
    </div>
  );
}
