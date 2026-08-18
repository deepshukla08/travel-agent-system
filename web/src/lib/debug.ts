import type { Constraints, PlanEvent, TripResult } from "./types.js";

/**
 * Graph state, logged to the browser console as it arrives.
 *
 * On in dev, and in any build when the URL carries `?debug` — so a deployed demo
 * can be opened up without a rebuild. Silent otherwise: a production console full
 * of internals is noise for the person using the app.
 */
export const debugEnabled =
  import.meta.env.DEV ||
  new URLSearchParams(window.location.search).has("debug");

const enabled = debugEnabled;

export interface RunLogger {
  event(e: PlanEvent): void;
  fail(message: string): void;
}

const NOOP: RunLogger = { event() {}, fail() {} };

const style = {
  head: "color:#6aa6ff;font-weight:600",
  ok: "color:#3f7d4f",
  bad: "color:#b3452f",
  guard: "color:#a4741a",
  dim: "color:#8a8073",
};

/** One console group per run, so concurrent turns never interleave. */
export function debugRun(request: string): RunLogger {
  if (!enabled) return NOOP;

  let tokens = 0;
  const started = Date.now();

  /** The last state seen, so each snapshot can be reported as what changed. */
  let state: Record<string, unknown> = {};

  console.group(`%c✈ plan run %c${request}`, style.head, style.dim);

  function finish(result: TripResult): void {
    console.log(
      `%cdone%c  run ${result.runId ?? "(questions only — not stored)"}  ·  ${tokens} token frames  ·  ${((Date.now() - started) / 1000).toFixed(1)}s wall`,
      style.head,
      style.dim,
    );

    if (result.trace.length > 0) {
      console.table(
        result.trace.map((t) => ({
          agent: t.agent,
          ok: t.ok,
          seconds: +(t.ms / 1000).toFixed(1),
          model: t.model,
          guards: t.guards.length,
        })),
      );
    }

    // ── TEMPORARY DEBUG ──────────────────────────────────────────────────
    // Everything below is a debugging aid, kept in one block so it comes out
    // in one deletion. Remove this block and the `state` log to revert.

    // A second itinerary entry is the replan cycle, and it is otherwise
    // invisible — you would just see the agent listed twice.
    const plans = result.trace.filter((t) => t.agent === "itinerary").length;
    if (plans > 1) {
      console.log(
        `%c↻ replanned%c  the trip was rebuilt and re-priced once`,
        style.guard,
        style.dim,
      );
    }

    // The destination's own cost guess per candidate. This is the number behind
    // every "why is it so far under budget" question: it is an eyeball estimate,
    // and the Budget Agent's total below is the itemised one.
    if (result.destination?.suggestions.length) {
      console.table(
        result.destination.suggestions.map((s) => ({
          name: s.name,
          estimated: s.estimatedTotalCost,
          days: s.suggestedDays,
          legs: s.legs.map((l) => `${l.place}:${l.nights}`).join(" → "),
        })),
      );
    }

    // Budget against target, worked out here so the arithmetic is visible rather
    // than inferred from two numbers in different places.
    const b = result.budget;
    if (b) {
      const max = b.verdict === "unstated" ? null : b.total + b.headroom - b.overage;
      console.log(
        `%cbudget%c  ${b.total} ${b.currency}` +
          (max
            ? `  of ${max}  ·  ${Math.round((b.total / max) * 100)}% used  ·  ${b.verdict}` +
              (b.overage ? `  ·  over by ${b.overage}` : "") +
              (b.headroom ? `  ·  ${b.headroom} unspent` : "")
            : `  ·  no budget was stated`),
        style.head,
        b.verdict === "over" ? style.bad : style.dim,
      );
    }

    if (result.itinerary) {
      console.log(
        `%citinerary%c  ${result.itinerary.days.length} days  ·  ${result.itinerary.days.filter((d) => d.uncertain).length} flagged uncertain`,
        style.head,
        style.dim,
      );
    }

    // The whole accumulated graph state, expandable. Everything the agents
    // wrote, plus what parse settled and what synthesis produced.
    console.log("state", result);
    // ── END TEMPORARY DEBUG ──────────────────────────────────────────────

    console.groupEnd();
  }

  return {
    event(e) {
      switch (e.type) {
        case "plan":
          // The routing decision, before any agent runs — the interesting bit.
          console.log(
            `%cparse%c → route: %c${e.route.join(" → ") || "(none — asking instead)"}`,
            style.head,
            style.dim,
            style.ok,
          );
          console.log("constraints", summarise(e.constraints));
          console.log("hard constraints", e.constraints.hard);
          return;

        case "agent":
          console.log(
            `%c${e.trace.ok ? "✓" : "✕"} ${e.trace.agent}%c  ${(e.trace.ms / 1000).toFixed(1)}s  ${e.trace.model}`,
            e.trace.ok ? style.ok : style.bad,
            style.dim,
          );
          for (const g of e.trace.guards) {
            console.log(`%c  guard fired: ${g}`, style.guard);
          }
          if (e.trace.error) console.log(`%c  ${e.trace.error}`, style.bad);
          return;

        case "token":
          // Counted, not logged — one line per token would bury everything else.
          tokens++;
          return;

        case "state": {
          // TripState after a node ran. Only what changed is printed: the full
          // object every time is mostly the same fields, and the point is seeing
          // what a node actually wrote. The whole thing is one click away.
          const changed = Object.keys(e.state).filter(
            (key) => JSON.stringify(e.state[key]) !== JSON.stringify(state[key]),
          );
          state = e.state;

          if (changed.length === 0) return;

          console.groupCollapsed(
            `%cstate%c  ${changed.join(", ")}`,
            style.head,
            style.dim,
          );
          for (const key of changed) console.log(key, e.state[key]);
          console.log("(whole state)", e.state);
          console.groupEnd();
          return;
        }

        case "error":
          console.log(`%c✕ ${e.message}`, style.bad);
          return;

        case "done":
          finish(e.result);
          return;
      }
    },

    fail(message) {
      console.log(`%c✕ ${message}`, style.bad);
      console.groupEnd();
    },
  };
}

/** The fields worth seeing at a glance; `hard` is logged separately in full. */
function summarise(c: Constraints) {
  return {
    origin: c.origin,
    destination: c.destination,
    days: c.days,
    travellers: c.travellers,
    budget: c.budget,
    interests: c.interests,
  };
}
