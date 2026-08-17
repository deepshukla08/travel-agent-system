import { AGENT_LABELS, type AgentName, type Constraints, type Trace } from "../lib/types.js";

interface Props {
  constraints: Constraints | null;
  route: AgentName[];
  trace: Trace[];
  running: boolean;
}

/**
 * The thinking, live: what was read from the request, which agents the
 * orchestrator picked, and each one's state as it works.
 *
 * A <details> that is open while the run is going and folds itself away when the
 * answer lands — the reasoning is there to be checked, not to be scrolled past
 * every time. Agents run in sequence, so the first one without a trace entry is
 * the one currently working; no extra event is needed to know that.
 */
export function AgentActivity({ constraints, route, trace, running }: Props) {
  if (!constraints && trace.length === 0) return null;

  const byAgent = new Map(trace.map((t) => [t.agent, t]));
  const ms = trace.reduce((total, t) => total + t.ms, 0);
  const contributed = trace.filter((t) => t.ok).length;

  return (
    <details className="think" open={running}>
      <summary>
        {running
          ? "Thinking"
          : `Planned by ${contributed} of 3 agents · ${(ms / 1000).toFixed(1)}s`}
      </summary>

      {constraints && (
        <>
          <h2>What I read from that</h2>
          <ul className="chips">
            {constraints.destination && <li>{constraints.destination}</li>}
            {constraints.days && <li>{constraints.days} days</li>}
            {constraints.travellers && <li>{constraints.travellers} travelling</li>}
            {constraints.budget && (
              <li>
                max {constraints.budget.max} {constraints.budget.currency}
              </li>
            )}
            {constraints.hard.map((h) => (
              <li key={`${h.kind}-${h.value}`} className="chip--hard">
                {h.kind}: {h.value}
              </li>
            ))}
            {constraints.interests.map((i) => (
              <li key={i} className="chip--soft">
                {i}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>
        Agents on it
        {route.length > 0 && <span className="muted"> — {route.length} of 3</span>}
      </h2>

      <ol className="agents">
        {route.map((agent) => {
          const done = byAgent.get(agent);
          const status = !done ? (running ? "running" : "queued") : done.ok ? "ok" : "failed";

          return (
            <li key={agent} className={`agent agent--${status}`}>
              <div className="agent__head">
                <strong>{AGENT_LABELS[agent]}</strong>
                <span className="agent__status">
                  {status === "ok" && `${(done!.ms / 1000).toFixed(1)}s`}
                  {status === "failed" && "failed"}
                  {status === "running" && "working…"}
                  {status === "queued" && "queued"}
                </span>
              </div>

              {done?.model && done.model !== "-" && (
                <div className="muted small">served by {done.model}</div>
              )}

              {done?.error && <p className="error small">{done.error}</p>}

              {/* Where code overruled the model — the audit trail, surfaced. */}
              {done?.guards.map((g) => (
                <p key={g} className="guard small">
                  guard: {g}
                </p>
              ))}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
