import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AGENT_LABELS, type TripResult } from "../lib/types.js";
import { Chips, money } from "./Working.js";

interface Props {
  request: string;
  result: TripResult;
  onNew: () => void;
}

/**
 * A finished trip, as a document rather than a chat transcript.
 *
 * The two things that must never be buried in prose — an over-budget verdict and
 * any day flagged uncertain — are rendered from structured fields, so they appear
 * whether or not the synthesiser mentioned them. That is what makes the
 * behavioural constraints visible rather than hoped for.
 */
export function TripPage({ request, result, onNew }: Props) {
  const { itinerary, budget, destination, constraints } = result;
  const flagged = itinerary?.days.filter((d) => d.uncertain) ?? [];

  const chosen = destination?.suggestions[0];
  const route = chosen?.legs ?? [];

  const place =
    itinerary?.destination ??
    constraints?.destination ??
    chosen?.name ??
    "Your trip";

  return (
    <article className="trip">
      <header className="trip__head">
        <button type="button" className="ghost" onClick={onNew}>
          ← Plan another trip
        </button>

        <h1>{place}</h1>
        <p className="muted trip__ask">“{request}”</p>
        {constraints && <Chips constraints={constraints} />}
      </header>

      {/* A trip through more than one place is a route, and the reader needs to see
          the shape of it before the days. */}
      {route.length > 1 && (
        <section className="card">
          <h2>The route</h2>
          <ol className="route">
            {route.map((leg) => (
              <li key={leg.place}>
                <strong>{leg.place}</strong>
                <span className="muted"> · {leg.nights} nights</span>
                <p className="muted small">{leg.note}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {budget && <BudgetVerdict budget={budget} />}

      {flagged.length > 0 && (
        <section className="card card--warn">
          <h2>Worth checking before you book</h2>
          <ul>
            {flagged.map((d) => (
              <li key={d.day}>
                <strong>Day {d.day}</strong> — {d.uncertaintyReason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Only present when the agent chose: a named destination skips it entirely,
          so `destination` being set is the whole test. It used to also require an
          empty constraints.destination — which the agent itself now fills in, so
          the section never rendered and the justifications the brief asks for were
          generated, checked and thrown away. */}
      {destination && destination.suggestions.length > 0 && (
        <section className="card">
          <h2>Why here</h2>
          {destination.suggestions.map((s, i) => (
            <div key={s.name} className="suggestion">
              <h3>
                {s.name}, {s.country}
                {i > 0 && <span className="muted"> · also considered</span>}
              </h3>
              <p>{s.justification}</p>
            </div>
          ))}
        </section>
      )}

      {itinerary && (
        <section className="days">
          <h2>Day by day</h2>
          {itinerary.days.map((d) => (
            <div key={d.day} className="day">
              <div className="day__num">{d.day}</div>
              <div className="day__body">
                <h3>{d.title}</h3>

                <dl className="day__parts">
                  <dt>Morning</dt>
                  <dd>{d.morning}</dd>
                  <dt>Afternoon</dt>
                  <dd>{d.afternoon}</dd>
                  <dt>Evening</dt>
                  <dd>{d.evening}</dd>
                </dl>

                <p className="day__travel">{d.travelNotes}</p>

                <div className="day__foot">
                  <span>{money(d.estimatedSpend, budget?.currency ?? null)}</span>
                  {d.uncertain && <span className="day__flag">worth checking</span>}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {budget && <BudgetTable budget={budget} />}

      {result.answer && (
        <section className="card">
          <h2>In summary</h2>
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.answer}</ReactMarkdown>
          </div>
        </section>
      )}

      <Provenance result={result} />
    </article>
  );
}

/** The budget verdict, from the guard's arithmetic rather than the prose. */
function BudgetVerdict({ budget }: { budget: NonNullable<TripResult["budget"]> }) {
  if (budget.verdict === "over") {
    return (
      <section className="card card--over">
        <h2>Over budget by {money(budget.overage, budget.currency)}</h2>
        <p>
          The honest estimate is {money(budget.total, budget.currency)}. It has not
          been trimmed to fit.
        </p>

        {budget.alternative && (
          <div className="alt">
            <h3>A cheaper way: {budget.alternative.summary}</h3>
            <ul>
              {budget.alternative.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p>
              That brings it to{" "}
              <strong>{money(budget.alternative.newTotal, budget.currency)}</strong>.
            </p>
          </div>
        )}
      </section>
    );
  }

  if (budget.verdict === "within") {
    // "Within budget" alone makes a third-of-the-budget trip look like a win.
    // Same threshold as the guard's underspend note — see guards.ts.
    const max = budget.total + budget.headroom;
    const thin = max > 0 && budget.total < max * 0.6;

    return (
      <section className="card card--ok">
        <h2>Within budget — {money(budget.total, budget.currency)}</h2>
        {thin && (
          <p className="muted">
            That leaves {money(budget.headroom, budget.currency)} of your budget
            unspent — a longer trip, or a step up in tier, is affordable.
          </p>
        )}
      </section>
    );
  }

  // No budget was given, so there is nothing to be within. Saying otherwise told
  // people a trip fitted a limit they had never set.
  return (
    <section className="card">
      <h2>Estimated total — {money(budget.total, budget.currency)}</h2>
      <p className="muted">
        You didn't set a budget, so this is an estimate rather than a check.
      </p>
    </section>
  );
}

function BudgetTable({ budget }: { budget: NonNullable<TripResult["budget"]> }) {
  return (
    <section className="card">
      <h2>What it costs</h2>

      <table className="costs">
        <tbody>
          {budget.items.map((i) => (
            <tr key={i.label}>
              <td>{i.label}</td>
              <td>{money(i.cost, budget.currency)}</td>
            </tr>
          ))}
          <tr className="costs__total">
            <td>Total</td>
            <td>{money(budget.total, budget.currency)}</td>
          </tr>
        </tbody>
      </table>

      {budget.assumptions.length > 0 && (
        <>
          <h3>Assuming</h3>
          <ul className="muted">
            {budget.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Who made this, and where code overruled the model.
 *
 * The brief asks for agent attribution because transparency matters in a real
 * tool. Kept to a readable line, with the technical detail folded away — a
 * traveller does not need a model name under their itinerary, but it should be
 * one click from it.
 */
function Provenance({ result }: { result: TripResult }) {
  const agents = result.trace;

  // Deduped: a replan runs Itinerary and Budget twice, and listing them twice
  // would claim five agents where there are three. The full sequence, replan and
  // all, is still in the table below.
  const credited = [...new Map(agents.filter((t) => t.ok).map((t) => [t.agent, t])).values()];
  const guards = agents.flatMap((t) => t.guards);

  return (
    <footer className="provenance">
      <p>
        Planned by{" "}
        <strong>
          {credited
            .map((t) => AGENT_LABELS[t.agent])
            .join(", ") || "no agents"}
        </strong>
        {credited.length > 0 && ` of 3 specialist agents`}
      </p>

      <details>
        <summary>How this was planned</summary>

        <table className="trace">
          <thead>
            <tr>
              <th>step</th>
              <th>model</th>
              <th>time</th>
            </tr>
          </thead>
          <tbody>
            {result.trace.map((t, i) => (
              <tr key={`${t.agent}-${i}`} className={t.ok ? "" : "trace--failed"}>
                <td>{t.agent}</td>
                <td>{t.model}</td>
                <td>{(t.ms / 1000).toFixed(1)}s</td>
              </tr>
            ))}
          </tbody>
        </table>

        {guards.length > 0 && (
          <>
            <h3>Checks that changed the answer</h3>
            <ul className="guards">
              {guards.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </>
        )}

        {agents.some((t) => !t.ok) && (
          <p className="error small">
            {agents
              .filter((t) => !t.ok)
              .map((t) => `${t.agent}: ${t.error}`)
              .join(" · ")}
          </p>
        )}
      </details>
    </footer>
  );
}
