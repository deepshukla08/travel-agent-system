import { useEffect, useState } from "react";
import { fetchRuns, type RunSummary } from "../lib/api.js";

/**
 * The audit log, and the second-role stub.
 *
 * Switching to admin sends `x-user-role: admin`, and the server returns every
 * run plus the guard-fired counts. That column is the point: it shows where code
 * overruled the model, which is an audit of AI behaviour rather than of HTTP.
 *
 * ponytail: a header is forgeable and is NOT access control — it marks where the
 * boundary goes. Upgrade path is Entra ID App Roles read from a validated JWT.
 */
export function RunLog() {
  const [role, setRole] = useState<"user" | "admin">("user");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    fetchRuns(role)
      .then((data) => {
        setRuns(data.runs);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [role, open]);

  return (
    <section className="panel">
      <div className="row">
        <button type="button" className="link" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"} recent runs
        </button>

        {open && (
          <label className="muted small">
            viewing as{" "}
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "user" | "admin")}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
        )}
      </div>

      {open && error && <p className="error small">{error}</p>}

      {open && !error && (
        <table className="runs">
          <thead>
            <tr>
              <th>request</th>
              <th>agents</th>
              <th>ms</th>
              {role === "admin" && <th>guards</th>}
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={role === "admin" ? 4 : 3} className="muted">
                  No runs yet.
                </td>
              </tr>
            )}
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{run.request.slice(0, 60)}</td>
                <td className="small">
                  {(JSON.parse(run.route) as string[]).join(" → ")}
                </td>
                <td>{run.total_ms}</td>
                {role === "admin" && <td>{run.guards_fired ?? 0}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
