/** Shared test helpers. Not a *.test.ts file, so the runner does not execute it. */

/**
 * Which agent is calling a stub, by schema identity.
 *
 * The comparison goes through here because `generate` takes a generic
 * `ZodType<T>`, which TypeScript will not narrow to one specific schema object —
 * so a bare `schema === DestinationResultSchema` is a type error even though it
 * is exactly right at runtime. Routing it through `unknown` keeps the test suite
 * inside `npm run typecheck`, which is what catches dead imports and stale
 * helpers before anyone reads them.
 */
export const isSchema = (schema: unknown, target: unknown): boolean =>
  schema === target;

/**
 * The agents that ran, in order, from a trace.
 *
 * Not deduped: the replan cycle runs Itinerary and Budget twice, and the
 * repetition is exactly what those checks assert.
 */
export function agentsIn(trace: { agent: string }[]): string[] {
  return trace.map((t) => t.agent);
}

