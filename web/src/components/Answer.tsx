import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PlanResult } from "../lib/types.js";

/**
 * The synthesised answer, with the two things that must not be buried in prose:
 * an over-budget verdict and any day the Itinerary Agent flagged uncertain.
 *
 * Both are rendered from structured fields rather than trusted to appear in the
 * markdown — that is what makes the behavioural constraints visible in the UI.
 */
export function Answer({ result }: { result: PlanResult }) {
  const flagged = result.itinerary?.days.filter((d) => d.uncertain) ?? [];
  const budget = result.budget;

  return (
    <section className="panel">
      {budget?.overBudget && (
        <div className="banner banner--over">
          <strong>
            Over budget by {budget.overage} {budget.currency}
          </strong>
          <p>
            Honest estimate is {budget.total} {budget.currency}. This has not been
            trimmed to fit.
          </p>

          {budget.alternative && (
            <div className="alternative">
              <strong>Cheaper alternative: {budget.alternative.summary}</strong>
              <ul>
                {budget.alternative.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p>
                Revised total: {budget.alternative.newTotal} {budget.currency}
                {budget.alternative.newTotal > (budget.total - budget.overage) && (
                  <em> — still above the stated budget, but as close as possible.</em>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {budget && !budget.overBudget && (
        <div className="banner banner--within">
          <strong>
            Within budget — {budget.total} {budget.currency}
          </strong>
        </div>
      )}

      {flagged.length > 0 && (
        <div className="banner banner--uncertain">
          <strong>Worth checking before you book</strong>
          <ul>
            {flagged.map((d) => (
              <li key={d.day}>
                Day {d.day}: {d.uncertaintyReason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <article className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
      </article>

      <footer className="muted small">
        Run {result.runId} · agents: {result.trace.map((t) => t.agent).join(", ") || "none"}
      </footer>
    </section>
  );
}
