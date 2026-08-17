export function buildBudgetPrompt(preferences, destination, itinerary) {
  const place =
    itinerary?.destination ??
    destination?.recommended ??
    preferences?.destination ??
    "the destination";

  const hasBudget = typeof preferences?.budgetAmount === "number";
  const currency = preferences?.budgetCurrency || "USD";

  const budgetBlock = hasBudget
    ? `The traveller's stated budget is ${preferences.budgetAmount} ${currency} in total, for the whole trip and all travellers.

Report "totalEstimate" in ${currency} and set "currency" to "${currency}", so your figure can be
compared directly against their budget. Do not report the total in a different currency.`
    : `The traveller did not state a budget amount. Estimate realistically for a
"${preferences?.budgetLevel ?? "mid-range"}" trip and set "withinBudget" to null.`;

  // Budget runs last precisely so it can price the real plan rather than a guess.
  const planBlock = itinerary
    ? `## The actual plan you are pricing

${JSON.stringify(itinerary, null, 2)}

Price what this itinerary actually contains — these specific activities, this many days,
this pace. Do not price a generic trip.`
    : `## No itinerary was produced

Estimate from the destination and trip length below. Say so in "assumptions".`;

  return `You are the Budget Agent. You estimate what a trip genuinely costs and check it honestly
against the traveller's budget. You have a get_exchange_rate tool.

## Traveller preferences

${JSON.stringify(preferences, null, 2)}

## Destination

${place}

${planBlock}

## Budget

${budgetBlock}

## The rule that matters

Estimate what this trip HONESTLY costs. Do not adjust your numbers to fit the budget.

If the real cost exceeds their budget, say so plainly:
  - "withinBudget": false
  - "overageAmount": how much over, in the same currency as totalEstimate
  - "cheaperAlternative": a concrete, specific way to bring it within budget

Quietly shrinking your estimates so the total happens to land under the budget is the one
thing you must never do. A traveller who books on a dishonest estimate is stranded. An
honest overage with a real alternative is a useful answer; a fabricated fit is not.

Your "withinBudget" claim is recomputed from your own numbers afterwards, so an inconsistent
answer will simply be corrected — there is nothing to gain from misreporting it.

A "cheaperAlternative" must be actionable and specific: name the changes and their effect.
"Travel in shoulder season instead of August (-25% on accommodation), stay in Gràcia rather
than the Gothic Quarter, cook three dinners" — not "consider budget options".

## Currency

Call get_exchange_rate to convert accurately, and show the local-currency total for context.

Return ONLY valid JSON with this exact structure:
{
  "currency": "the currency of totalEstimate",
  "localCurrency": "3-letter code at the destination",
  "exchangeRate": "e.g. '1 GBP = 1.17 EUR'",
  "breakdown": {
    "flights": 0,
    "accommodation": 0,
    "food": 0,
    "localTransport": 0,
    "activities": 0,
    "miscellaneous": 0
  },
  "totalEstimate": 0,
  "totalInLocalCurrency": "e.g. '€1,750'",
  "withinBudget": "true, false, or null if no budget was stated",
  "overageAmount": "how much over budget, or 0 if within",
  "cheaperAlternative": {
    "summary": "how to bring this within budget",
    "changes": ["specific change and its saving"],
    "newTotalEstimate": 0
  },
  "assumptions": ["what this estimate assumes"],
  "savingTips": ["practical ways to spend less"]
}

Set "cheaperAlternative" to null ONLY when the trip is within budget or no budget was stated.

Return only the JSON, no explanation, no markdown.`;
}

/**
 * Follow-up prompt used when the trip is over budget but the model returned no
 * alternative. Asks for the missing piece only, rather than re-running the
 * whole estimate.
 */
export function buildCheaperAlternativePrompt(budget, preferences) {
  const currency = budget.currency;

  return `A trip you priced comes to ${budget.totalEstimate} ${currency}, which is
${budget.overageAmount} ${currency} over the traveller's budget of ${preferences.budgetAmount} ${currency}.

Your estimate:
${JSON.stringify(budget.breakdown, null, 2)}

Propose a concrete cheaper alternative that brings the trip within ${preferences.budgetAmount} ${currency}.
Name specific changes and what each one saves. If it genuinely cannot be done within that
budget, say so in "summary" and get as close as possible.

Return ONLY valid JSON:
{
  "summary": "one or two sentences on the approach",
  "changes": ["specific change and its saving"],
  "newTotalEstimate": 0
}

Return only the JSON, no explanation, no markdown.`;
}
