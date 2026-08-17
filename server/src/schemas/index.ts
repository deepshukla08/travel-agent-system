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
  destination: z.string().nullable(),
  days: z.number().int().positive().nullable(),
  travellers: z.number().int().positive().nullable(),
  budget: z
    .object({ currency: z.string(), max: z.number().positive() })
    .nullable(),
  hard: z.array(HardConstraintSchema),
  interests: z.array(z.string()),
});

// ── Destination agent ────────────────────────────────────────────────────────

export const SuggestionSchema = z.object({
  name: z.string(),
  country: z.string(),
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

export const PlanRequestSchema = z.object({
  request: z.string().trim().min(3).max(2000),
});

export type HardConstraint = z.infer<typeof HardConstraintSchema>;
export type Constraints = z.infer<typeof ConstraintsSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type DestinationResult = z.infer<typeof DestinationResultSchema>;
export type Day = z.infer<typeof DaySchema>;
export type ItineraryResult = z.infer<typeof ItineraryResultSchema>;
export type BudgetResult = z.infer<typeof BudgetResultSchema>;
export type Alternative = z.infer<typeof AlternativeSchema>;

/**
 * Zod schema → the JSON Schema Gemini accepts on `responseJsonSchema`.
 * `$schema` is stripped: the API rejects unrecognised top-level keys.
 */
export function toGeminiSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json["$schema"];
  return json;
}
