import { z } from "zod";

/**
 * Output contracts for the three agents.
 *
 * These exist so the behavioural rules in the brief are enforced by the schema
 * rather than hoped for in a prompt. A model that ignores an instruction fails
 * validation here and gets one repair attempt with the error fed back.
 *
 * Numbers use z.coerce because models routinely emit "1500" for a number field.
 * Coercing is cheaper than burning a retry on a formatting quibble.
 */

// ── Destination ──────────────────────────────────────────────────────────────

export const ConstraintCheckSchema = z.object({
  kind: z.string().min(1),
  verdict: z.enum(["pass", "fail"]),
  reason: z.string().min(1),
});

export const DestinationCandidateSchema = z.object({
  name: z.string().min(1),
  country: z.string().min(1),
  // "Must justify each suggestion against the stated preferences" — a one-word
  // justification is not one, so the floor is a real sentence.
  justification: z.string().min(25),
  matchedPreferences: z.array(z.string()).default([]),
  constraintChecks: z.array(ConstraintCheckSchema).default([]),
  estimatedBudgetBand: z.string().nullish(),
  bestTimeToVisit: z.string().nullish(),
});

export const DestinationOutputSchema = z.object({
  candidates: z.array(DestinationCandidateSchema).min(1),
  recommended: z.string().min(1),
});

// ── Itinerary ────────────────────────────────────────────────────────────────

export const ItineraryDaySchema = z.object({
  day: z.coerce.number().int().positive(),
  date: z.string().nullish(),
  title: z.string().min(1),
  morning: z.string().min(1),
  afternoon: z.string().min(1),
  evening: z.string().min(1),
  meals: z.string().nullish(),
  // "Each day must be realistic on travel time and sequencing" — required, so
  // the model cannot quietly omit the reasoning that makes a day plausible.
  travelNotes: z.string().min(1),
  estimatedDailySpend: z.union([z.string(), z.number()]).nullish(),
});

export const ItineraryOutputSchema = z
  .object({
    destination: z.string().min(1),
    totalDays: z.coerce.number().int().positive(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    days: z.array(ItineraryDaySchema).min(1),
    confidence: z.enum(["high", "medium", "low"]),
    uncertainties: z.array(z.string()).default([]),
  })
  // "It must say so when it is uncertain" — claiming less than full confidence
  // while listing nothing uncertain is exactly the silence the brief forbids.
  .refine((d) => d.confidence === "high" || d.uncertainties.length > 0, {
    message:
      "confidence is not 'high', so at least one entry in uncertainties is required",
    path: ["uncertainties"],
  })
  // A 5-day trip that returns 3 days is a wrong answer, not a short one.
  .refine((d) => d.days.length === d.totalDays, {
    message: "days array length must equal totalDays",
    path: ["days"],
  });

// ── Budget ───────────────────────────────────────────────────────────────────

export const CheaperAlternativeSchema = z.object({
  summary: z.string().min(1),
  changes: z.array(z.string()).min(1),
  newTotalEstimate: z.coerce.number().nonnegative(),
});

export const BudgetOutputSchema = z.object({
  currency: z.string().min(1),
  localCurrency: z.string().nullish(),
  exchangeRate: z.string().nullish(),
  breakdown: z.record(z.string(), z.coerce.number()),
  totalEstimate: z.coerce.number().positive(),
  // Deliberately nullable: the model's opinion is recorded, then overwritten by
  // the deterministic check in budgetAgent. Never trusted as-is.
  withinBudget: z.boolean().nullish(),
  overageAmount: z.coerce.number().nonnegative().default(0),
  cheaperAlternative: CheaperAlternativeSchema.nullish(),
  assumptions: z.array(z.string()).default([]),
  savingTips: z.array(z.string()).default([]),
});

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Validate parsed agent JSON against a schema.
 * On failure returns a flat, promptable error string so the repair retry can
 * tell the model exactly which field it got wrong.
 */
export function validateOutput(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };

  const error = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

  return { ok: false, error };
}
