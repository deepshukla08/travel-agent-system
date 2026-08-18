import type { Constraints, PlanEvent, TripResult } from "./types.js";

/**
 * Graph state, logged to the browser console as it arrives.
 *
 * On in dev, and in any build when the URL carries `?debug` — so a deployed demo
 * can be opened up without a rebuild. Silent otherwise: a production console full
 * of internals is noise for the person using the app.
 */
const enabled =
  import.meta.env.DEV ||
  new URLSearchParams(window.location.search).has("debug");

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

    // The accumulated graph state — every field the agents wrote.
    console.log("state", {
      destination: result.destination,
      itinerary: result.itinerary,
      budget: result.budget,
      needs: result.needs,
    });

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
