/** Shared test helpers. Not a *.test.ts file, so the runner does not execute it. */

/**
 * The three specialists that ran, from a trace.
 *
 * The trace also carries the intent step, because it is a model call and the audit
 * would be incomplete without it — but it contributes no travel content, so
 * anything asking "which agents ran" filters it out, exactly as synthesis does.
 */
export function agentsIn(trace: { agent: string }[]): string[] {
  return trace.filter((t) => t.agent !== "intent").map((t) => t.agent);
}

