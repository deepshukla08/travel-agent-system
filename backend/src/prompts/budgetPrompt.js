export function buildBudgetPrompt(preferences, destinationResearch) {
  const destination =
    destinationResearch?.destination ??
    preferences?.destination ??
    "the destination";
  return `You are a travel budget estimation agent with access to a get_exchange_rate tool.

Travel preferences:
${JSON.stringify(preferences, null, 2)}

Destination info:
${JSON.stringify(destinationResearch, null, 2)}

Steps:
1. Determine the local currency for ${destination} (e.g. INR for India, AED for UAE, THB for Thailand, JPY for Japan, EUR for Europe).
2. Call get_exchange_rate to get the current USD → local currency rate.
3. Use the real rate to show costs in BOTH USD and local currency in your estimates.

CRITICAL CONSTRAINT: If the user specified a budget amount (check preferences.budgetAmount), ALL estimates MUST fit within that budget. Do not exceed it under any circumstances — redistribute across categories to stay within the limit. If no specific amount was given, estimate realistically based on their budgetLevel.

Estimate a total trip cost for the full trip (all travelers combined) that fits within the user's budget.

Return ONLY valid JSON with this exact structure:
{
  "currency": "USD",
  "localCurrency": "3-letter code e.g. INR",
  "exchangeRate": "e.g. 1 USD = 83.5 INR",
  "duration": "number of days",
  "travelers": "string describing travelers",
  "breakdown": {
    "stay": "number in USD",
    "food": "number in USD",
    "transport": "number in USD",
    "attractions": "number in USD",
    "shoppingMisc": "number in USD"
  },
  "totalEstimate": "number in USD",
  "totalInLocalCurrency": "string e.g. '₹95,000'",
  "assumptions": ["list of assumptions made in this estimate"],
  "savingTips": ["practical tips to save money on this trip"]
}

Return only the JSON, no explanation, no markdown.`;
}
