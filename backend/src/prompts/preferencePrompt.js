export function buildPreferencePrompt(userRequest) {
  return `You are a travel preference extraction step. Extract structured data from a user's request.

User request:
"${userRequest}"

## Hard constraints vs soft preferences

A HARD constraint is something the user stated as a requirement or limit. Breaking it makes
the answer wrong. A SOFT preference is a taste or a nice-to-have.

  "somewhere warm in Europe, under £1500, no long-haul flights"
    hard: climate=warm, region=Europe, maxBudget=1500, maxFlightHours
    soft: (none stated)

  "I love food markets and would prefer somewhere walkable"
    hard: (none)
    soft: food markets, walkable

Only record a hard constraint the user actually stated. Do not invent one, and do not
promote a preference ("I like beaches") into a constraint ("must be coastal").

Allowed \`kind\` values: region | climate | maxBudget | avoid | maxFlightHours | accessibility | dates

## Budget

"budgetAmount" must be a PLAIN NUMBER with no currency symbol, no commas, and no units.
Convert spoken units yourself: "1 lakh" is 100000, "25k" is 25000, "2 crore" is 20000000.
Put the ISO 4217 code in "budgetCurrency" (GBP, USD, EUR, INR, JPY...).
If no amount was stated, use null for both — never guess a number and never use 0.

## Destination

If the user did not name a place, set "destination" to null. Do NOT guess one — choosing
a destination is another agent's job, and a guess here would silently skip it.

Return ONLY valid JSON with this exact structure:
{
  "destination": "string or null",
  "numberOfDays": "number or null",
  "startDate": "YYYY-MM-DD if a date or month was mentioned, otherwise null",
  "travelers": "string (e.g. 'couple', 'solo', 'family of 4')",
  "budgetLevel": "budget | mid-range | luxury | null",
  "budgetAmount": "number or null",
  "budgetCurrency": "ISO 4217 code or null",
  "travelStyle": "string (e.g. 'relaxed sightseeing', 'adventure', 'cultural')",
  "interests": ["array of interests"],
  "hardConstraints": [
    { "kind": "one of the allowed kinds", "value": "the limit itself", "raw": "the user's own words" }
  ],
  "softPreferences": ["nice-to-haves that are not requirements"],
  "missingInfo": ["things that are unclear or missing"]
}

Return only the JSON, no explanation, no markdown.`;
}
