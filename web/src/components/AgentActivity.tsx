import { AGENT_LABELS, type AgentName, type Constraints, type Trace } from "../lib/types.js";

interface Props {
  constraints: Constraints | null;
  route: AgentName[];
  trace: Trace[];
  running: boolean;
}

/**
 * Shows the routing decision and each agent as it completes.
 *
 * This is the "which agents contributed" requirement and the agent-activity
 * state in one place. The route is rendered before any agent runs, so the
 * orchestration decision is visible rather than inferred from the output.
 */
export function AgentActivity({ constraints, route, trace, running }: Props) {
  if (!constraints && trace.length === 0) return null;

  const byAgent = new Map(trace.map((t) => [t.agent, t]));

  return (
    <section className="panel">
      {constraints && (
        <>
          <h2>What we read from your request</h2>
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
        Agents for this request
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
    </section>
  );
}
