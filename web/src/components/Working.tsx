import { AGENT_LABELS, type AgentName, type Constraints, type Trace } from "../lib/types.js";

interface Props {
  request: string;
  constraints: Constraints | null;
  route: AgentName[];
  trace: Trace[];
}

/**
 * Shown while the agents work.
 *
 * This is the brief's "clear loading and agent activity state", and it is also
 * where the orchestration becomes visible: what was read from the request, which
 * agents were chosen, and which are still going. Agents run in sequence, so the
 * first one without a trace entry is the one working — no extra event needed.
 */
export function Working({ request, constraints, route, trace }: Props) {
  const done = new Map(trace.map((t) => [t.agent, t]));
  const finished = route.filter((a) => done.has(a)).length;

  return (
    <div className="working">
      <p className="working__request">“{request}”</p>

      {constraints && <Chips constraints={constraints} />}

      <div className="working__bar">
        <div
          className="working__bar-fill"
          style={{
            width: `${route.length ? (finished / route.length) * 100 : 8}%`,
          }}
        />
      </div>

      {route.length === 0 ? (
        <p className="muted">Reading your request…</p>
      ) : (
        <ol className="steps">
          {route.map((agent) => {
            const entry = done.get(agent);
            const state = !entry ? "running" : entry.ok ? "ok" : "failed";

            return (
              <li key={agent} className={`step step--${state}`}>
                <span className="step__name">{AGENT_LABELS[agent]}</span>
                <span className="step__note">
                  {state === "ok" && `${(entry!.ms / 1000).toFixed(1)}s`}
                  {state === "failed" && "couldn't finish"}
                  {state === "running" && "working…"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  INR: "₹",
  JPY: "¥",
};

export function money(amount: number, currency: string | null): string {
  const grouped = Math.round(amount).toLocaleString("en-GB");
  if (!currency) return grouped; // unstated — the Budget Agent decides and says so

  const symbol = SYMBOLS[currency];
  return symbol ? `${symbol}${grouped}` : `${grouped} ${currency}`;
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A parsed constraint, said the way a person would say it. */
function describe(kind: string, value: string): string {
  switch (kind) {
    case "climate":
      return `${value} weather`;
    case "region":
      return `in ${sentenceCase(value)}`;
    case "month":
      return sentenceCase(value);
    case "maxFlightHours":
      return `flights under ${value}h`;
    case "avoid":
      return `avoiding ${value}`;
    default:
      return value;
  }
}

/** What was read from the request — the parse, made visible. */
export function Chips({ constraints }: { constraints: Constraints }) {
  return (
    <ul className="chips">
      {constraints.origin && <li>from {constraints.origin}</li>}
      {constraints.destination && <li>{constraints.destination}</li>}
      {constraints.days && <li>{constraints.days} days</li>}
      {constraints.travellers && <li>{constraints.travellers} travelling</li>}
      {constraints.budget && (
        <li>up to {money(constraints.budget.max, constraints.budget.currency)}</li>
      )}
      {constraints.hard
        // The budget has its own chip above; showing the same limit twice, once
        // as "maxBudget", reads like a database dump.
        .filter((h) => h.kind !== "maxBudget")
        .map((h) => (
          <li key={`${h.kind}-${h.value}`} className="chip--hard">
            {describe(h.kind, h.value)}
          </li>
        ))}
      {constraints.interests.map((i) => (
        <li key={i} className="chip--soft">
          {i}
        </li>
      ))}
    </ul>
  );
}
