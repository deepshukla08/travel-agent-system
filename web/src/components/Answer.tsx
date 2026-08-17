import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PlanResult } from "../lib/types.js";

interface Props {
  /** Null until `done` arrives — while streaming there is prose but no result. */
  result: PlanResult | null;
  /** The tokens so far, or the finished answer once there is one. */
  markdown: string;
  streaming: boolean;
}

/**
 * The answer, with the two things that must not be buried in prose: an
 * over-budget verdict and any day the Itinerary Agent flagged uncertain.
 *
 * Both are rendered from structured fields rather than trusted to appear in the
 * markdown — that is what makes the behavioural constraints visible in the UI.
 * They render once the run finishes; before then there is only the prose, which
 * is why the banners sit above it and not inside it.
 */
export function Answer({ result, markdown, streaming }: Props) {
  const flagged = result?.itinerary?.days.filter((d) => d.uncertain) ?? [];
  const budget = result?.budget;

  return (
    <div className="answer">
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

      {/* The caret is drawn on the last block by CSS, so it sits in the text
          rather than on a line of its own. */}
      <article className={streaming ? "markdown streaming" : "markdown"}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>

      {result && (
        <footer className="muted small">
          Run {result.runId} · agents:{" "}
          {result.trace.map((t) => t.agent).join(", ") || "none"}
        </footer>
      )}
    </div>
  );
}
