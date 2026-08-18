import { useEffect, useState } from "react";
import { fetchRecent, type RecentTrip } from "../lib/api.js";
import type { Constraints } from "../lib/types.js";

interface Props {
  /** What was asked before, when coming back from the questions — not retyped. */
  initial?: string;
  disabled: boolean;
  onSubmit: (request: string) => void;
  onOpen: (id: string) => void;
}

const EXAMPLES = [
  "A five day trip somewhere warm in Europe for under £1500",
  "4 days in Lisbon from London for 2 people, around £900",
  "3 days in Udaipur from Ahmedabad under 20,000 INR",
  "Roughly what does a week in Rome cost?",
];

/** Where a trip starts: one box, one request. */
export function PromptPage({ initial, disabled, onSubmit, onOpen }: Props) {
  const [draft, setDraft] = useState(initial ?? "");
  const [recent, setRecent] = useState<RecentTrip[]>([]);

  useEffect(() => {
    // Past trips are a convenience, not the point of the page — a failure here
    // must not stop anyone planning a new one.
    fetchRecent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  return (
    <div className="landing">
      <h1>Where are we going?</h1>
      <p className="lede">
        Say where you'd like to go, how long for, and what you'd like to spend.
        Three specialist agents will plan it — and only the ones your request
        actually needs will run.
      </p>

      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(draft);
        }}
      >
        <textarea
          value={draft}
          rows={3}
          autoFocus
          placeholder="e.g. 5 days somewhere warm in Europe from London, under £1500"
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(draft);
            }
          }}
        />
        <button type="submit" disabled={disabled || !draft.trim()}>
          Plan my trip
        </button>
      </form>

      <div className="examples">
        <span className="muted small">Or try one of these</span>
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            className="chip-btn"
            disabled={disabled}
            onClick={() => onSubmit(e)}
          >
            {e}
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <section className="recent">
          <h2>Earlier trips</h2>
          <ul>
            {recent.map((run) => (
              <li key={run.id}>
                <button type="button" onClick={() => onOpen(run.id)}>
                  <span className="recent__where">{titleOf(run)}</span>
                  <span className="recent__meta">
                    {(JSON.parse(run.route) as string[]).length} of 3 agents ·{" "}
                    {(run.total_ms / 1000).toFixed(0)}s
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The destination if one was settled, else the request itself. */
function titleOf(run: RecentTrip): string {
  try {
    const c = JSON.parse(run.constraints) as Constraints;
    if (c.destination) {
      return c.days ? `${c.destination} · ${c.days} days` : c.destination;
    }
  } catch {
    // Fall through to the raw request.
  }
  return run.request.slice(0, 60);
}
