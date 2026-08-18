import { z } from "zod/v4";

/**
 * Every shape that crosses HTTP or comes back from the model.
 *
 * Defined once here: `z.infer` gives the TypeScript type and `toGeminiSchema`
 * gives the model contract, so the two can never drift apart.
 */

// ── Parsed constraints (produced by tools/, no model involved) ────────────────

export const HardConstraintSchema = z.object({
  kind: z.enum([
    "region",
    "climate",
    "maxBudget",
    "maxFlightHours",
    "avoid",
    "month",
  ]),
  value: z.string(),
  /** The user's own words, so the UI and audit log can show what was matched. */
  raw: z.string(),
});

export const ConstraintsSchema = z.object({
  /**
   * Where the trip starts. Flights are usually the largest cost and the only
   * thing that makes a flight-time limit checkable, so without this the Budget
   * Agent quietly assumes an origin — it was pricing "return from UK" for
   * travellers who never said so.
   */
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  days: z.number().int().positive().nullable(),
  travellers: z.number().int().positive().nullable(),
  budget: z
    .object({
      /**
       * Null when an amount was given without one ("5k"). Left unresolved on
       * purpose — the Budget Agent picks the currency that fits the trip and
       * discloses the choice, rather than the parser guessing sterling.
       */
      currency: z.string().nullable(),
      max: z.number().positive(),
    })
    .nullable(),
  hard: z.array(HardConstraintSchema),
  interests: z.array(z.string()),
});

// ── Destination agent ────────────────────────────────────────────────────────

/**
 * One base on a trip, and how long you stay there.
 *
 * Ten days planned as ten days in one city is a worse trip than a route through
 * two or three places — and the shape of a trip belongs to the agent choosing
 * where to go, not to the one filling in the days.
 */
export const LegSchema = z.object({
  place: z.string(),
  nights: z.number().int().positive(),
  /** Why it earns those nights, and how you reach it from the previous leg. */
  note: z.string(),
});

export const SuggestionSchema = z.object({
  name: z.string(),
  country: z.string(),
  /**
   * Where the traveller actually stays, in order: one entry for a city break,
   * several for a longer trip through a region.
   */
  legs: z.array(LegSchema).min(1),
  /**
   * A trip length that suits this destination and budget.
   *
   * Echoes the traveller's figure when they gave one, and proposes one their
   * budget affords when they did not — the planner used to assume five days
   * silently, which is a guess dressed as a decision.
   */
  suggestedDays: z.number().int().positive(),
  /** Must argue against the stated preferences; length is enforced by a guard. */
  justification: z.string(),
  /** One verdict per hard constraint. The guard drops any "fail". */
  constraintChecks: z.array(
    z.object({
      kind: z.string(),
      passes: z.boolean(),
      reason: z.string(),
    }),
  ),
  estimatedTotalCost: z.number(),
});

export const DestinationResultSchema = z.object({
  suggestions: z.array(SuggestionSchema),
});

// ── Itinerary agent ─────────────────────────────────────────────────────────

export const DaySchema = z.object({
  day: z.number().int().positive(),
  title: z.string(),
  morning: z.string(),
  afternoon: z.string(),
  evening: z.string(),
  /** Transit time and why this ordering is physically doable. */
  travelNotes: z.string(),
  /**
   * What this day costs for food, local transport and activities, in the stated
   * budget currency. Required so a plan states its own price instead of leaving
   * the Budget Agent to infer one, and so a day that overshoots is visible.
   */
  estimatedSpend: z.number().nonnegative(),
  /** "Must say so when uncertain" — a field, not a hope. */
  uncertain: z.boolean(),
  uncertaintyReason: z.string().nullable(),
});

export const ItineraryResultSchema = z.object({
  destination: z.string(),
  days: z.array(DaySchema),
});

// ── Budget agent ────────────────────────────────────────────────────────────

export const BudgetItemSchema = z.object({
  label: z.string(),
  cost: z.number(),
});

export const AlternativeSchema = z.object({
  summary: z.string(),
  changes: z.array(z.string()),
  newTotal: z.number(),
});

export const BudgetResultSchema = z.object({
  currency: z.string(),
  items: z.array(BudgetItemSchema),
  /** Recomputed from items by a guard — the model does not get the final word. */
  total: z.number(),
  alternative: AlternativeSchema.nullable(),
  assumptions: z.array(z.string()),
});

// ── HTTP ────────────────────────────────────────────────────────────────────

/**
 * One question to put back to the traveller, as a field the UI can render.
 *
 * Structured rather than prose so the client builds a real form. Every field is
 * optional to answer — a vague reply like "whatever you suggest" is fine, because
 * the parser simply finds nothing and the agent discloses its assumption.
 */
export const NeedSchema = z.object({
  id: z.enum(["from", "where", "days", "budget"]),
  label: z.string(),
  hint: z.string(),
});

/**
 * Answers typed into that form, field by field.
 *
 * Sent alongside the request rather than flattened into it: the form knows which
 * answer was which, and re-guessing that from a sentence loses it. A bare
 * "Lisbon" in the where field is a destination, but in free prose it reads as
 * nothing at all — which had the form asking the same questions twice.
 */
export const AnswersSchema = z.object({
  from: z.string().trim().max(200).optional(),
  where: z.string().trim().max(200).optional(),
  days: z.string().trim().max(60).optional(),
  budget: z.string().trim().max(60).optional(),
});

/**
 * One request in, one trip out.
 *
 * Deliberately not a conversation. This was a chat with carried constraints, a
 * staleness graph and follow-up routing, and nearly every defect lived there: a
 * destination silently replaced, a budget forgotten between turns, an off-topic
 * aside becoming a travel preference. The brief asks for a request and a
 * synthesised answer, so that is what this is — plus one round of questions when
 * the request genuinely cannot be planned.
 */
export const PlanRequestSchema = z.object({
  // Only non-empty is required. A short or nonsense message like "?" parses to no
  // constraints, which the pipeline answers with the form rather than an error.
  request: z.string().trim().min(1).max(2000),
  /** Field-by-field answers, when the request came back through the form. */
  answers: AnswersSchema.optional(),
  /**
   * Stream the accumulated graph state after every node, for the browser's debug
   * console. Off by default: it is the whole state on every step, which no one
   * using the app needs to be sent.
   */
  debug: z.boolean().optional(),
});

export type HardConstraint = z.infer<typeof HardConstraintSchema>;
export type Constraints = z.infer<typeof ConstraintsSchema>;
export type Leg = z.infer<typeof LegSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type DestinationResult = z.infer<typeof DestinationResultSchema>;
export type Day = z.infer<typeof DaySchema>;
export type ItineraryResult = z.infer<typeof ItineraryResultSchema>;
export type BudgetResult = z.infer<typeof BudgetResultSchema>;
export type Need = z.infer<typeof NeedSchema>;
export type Answers = z.infer<typeof AnswersSchema>;

/**
 * Zod schema → the JSON Schema Gemini accepts on `responseJsonSchema`.
 * `$schema` is stripped: the API rejects unrecognised top-level keys.
 */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json["$schema"];
  return json;
}
