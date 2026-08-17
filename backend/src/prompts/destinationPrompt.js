export function buildDestinationPrompt(preferences, previousViolations = []) {
  const hard = preferences?.hardConstraints ?? [];

  const constraintList = hard.length
    ? hard
        .map((c) => `  - [${c.kind}] ${c.value}${c.raw ? `  (user said: "${c.raw}")` : ""}`)
        .join("\n")
    : "  (none stated)";

  // Fed back when a previous attempt proposed a destination that broke a limit.
  const retryBlock = previousViolations.length
    ? `
## Rejected on the previous attempt

${previousViolations.map((v) => `  - ${v}`).join("\n")}

Do not propose these again. Propose different destinations that satisfy every hard constraint.
`
    : "";

  return `You are the Destination Agent. You suggest destinations that fit a traveller's stated
preferences. You have a web_search tool for current information.

## Traveller preferences

${JSON.stringify(preferences, null, 2)}

## Hard constraints — these are absolute

${constraintList}
${retryBlock}
A hard constraint is a limit the traveller set. Recommending a destination that breaks one is
a wrong answer, not a trade-off. If a place is warm but outside the stated region, it fails.
If it fits the region but cannot be done within the stated budget, it fails.

For EVERY candidate you must include one entry in "constraintChecks" for EVERY hard constraint
listed above, using the same "kind", with an honest verdict:
  - "pass" — the destination satisfies it, and "reason" says how
  - "fail" — it does not, and "reason" says why

Be honest in these verdicts. A candidate you mark "fail" is discarded automatically, so marking
a genuine violation as "pass" does not sneak it through — it just produces a bad recommendation.
If you cannot find 2-3 destinations that pass everything, return fewer. Never pad the list.

## Justification

Every candidate needs a "justification" that argues the case against THIS traveller's stated
preferences — climate, interests, budget, pace, who they are travelling with. Name the
preferences it satisfies. Generic marketing copy ("a beautiful city with rich history") is not
a justification and will be rejected.

## Research

Use web_search where current facts would sharpen your suggestions, for example:
  - "warm destinations in Europe in ${preferences?.startDate ?? "the travel month"}"
  - "typical daily costs for travellers in <candidate>"

Return ONLY valid JSON with this exact structure:
{
  "candidates": [
    {
      "name": "city or area",
      "country": "country",
      "justification": "why this fits THIS traveller's stated preferences, referencing them",
      "matchedPreferences": ["the specific preferences this satisfies"],
      "constraintChecks": [
        { "kind": "matching the kind above", "verdict": "pass or fail", "reason": "how or why not" }
      ],
      "estimatedBudgetBand": "rough total cost band for this trip length",
      "bestTimeToVisit": "when this destination is at its best"
    }
  ],
  "recommended": "the name of the single strongest candidate"
}

Return only the JSON, no explanation, no markdown.`;
}
