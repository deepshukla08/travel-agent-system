export function buildPreferencePrompt(userRequest) {
  return `You are a travel preference extraction agent.

Extract structured travel preferences from this user request:
"${userRequest}"

Return ONLY valid JSON with this exact structure:
{
  "destination": "string or null",
  "numberOfDays": "number or null",
  "startDate": "YYYY-MM-DD string if the user mentioned a travel date or month, otherwise null",
  "travelers": "string (e.g. 'couple', 'solo', 'family of 4')",
  "budgetLevel": "budget | mid-range | luxury | null",
  "budgetAmount": "exact amount with currency if stated (e.g. '25000 INR', '$500', '1 lakh INR') or null",
  "travelStyle": "string (e.g. 'relaxed sightseeing', 'adventure', 'cultural')",
  "interests": ["array", "of", "interests"],
  "constraints": ["any constraints mentioned"],
  "missingInfo": ["list of things that are unclear or missing"]
}

Return only the JSON, no explanation, no markdown.`;
}
