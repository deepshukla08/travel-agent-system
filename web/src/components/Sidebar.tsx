import { useEffect, useState } from "react";
import { fetchRuns, type RunSummary } from "../lib/api.js";

interface Props {
  /** The run currently in the thread, so the list can mark it. */
  activeId?: string;
  /** Bumped when a run finishes, so the list picks it up. */
  reload: number;
  onOpen: (id: string) => void;
  onNew: () => void;
}

/**
 * Past trips, and the second-role stub.
 *
 * Switching to admin sends `x-user-role: admin`, and the server returns every run
 * plus the guard-fired counts. That count is the point: it shows where code
 * overruled the model, which is an audit of AI behaviour rather than of HTTP.
 *
 * ponytail: a header is forgeable and is NOT access control — it marks where the
 * boundary goes. Upgrade path is Entra ID App Roles read from a validated JWT.
 */
export function Sidebar({ activeId, reload, onOpen, onNew }: Props) {
  const [role, setRole] = useState<"user" | "admin">("user");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns(role)
      .then((data) => {
        setRuns(data.runs);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [role, reload]);

  return (
    <aside className="sidebar">
      <div className="sidebar__top">
        <span className="brand__mark" aria-hidden="true">
          ✈
        </span>
        <div>
          <strong>Trip Planner</strong>
          <div className="muted tiny">three agents, one orchestrator</div>
        </div>
      </div>

      <button type="button" className="ghost newtrip" onClick={onNew}>
        <span aria-hidden="true">＋</span> New trip
      </button>

      <div className="sidebar__list">
        <h2>Recent</h2>

        {error && <p className="error small">{error}</p>}
        {!error && runs.length === 0 && (
          <p className="muted small">Nothing planned yet.</p>
        )}

        {runs.map((run) => {
          const agents = (JSON.parse(run.route) as string[]).length;

          return (
            <button
              key={run.id}
              type="button"
              title={run.request}
              className={`runitem${run.id === activeId ? " runitem--active" : ""}`}
              onClick={() => onOpen(run.id)}
            >
              <span className="runitem__text">{run.request}</span>
              <span className="runitem__meta">
                {agents} {agents === 1 ? "agent" : "agents"} ·{" "}
                {(run.total_ms / 1000).toFixed(1)}s
                {role === "admin" && run.guards_fired
                  ? ` · ${run.guards_fired} guards`
                  : ""}
              </span>
            </button>
          );
        })}
      </div>

      <label className="sidebar__foot muted small">
        viewing as{" "}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "user" | "admin")}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </label>
    </aside>
  );
}
