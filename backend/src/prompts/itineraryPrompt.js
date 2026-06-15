export function buildItineraryPrompt(
  preferences,
  destinationResearch,
  budgetPlan,
) {
  return `You are an expert travel itinerary planner with access to get_current_date and get_trip_dates tools.

Travel preferences:
${JSON.stringify(preferences, null, 2)}

Destination research:
${JSON.stringify(destinationResearch, null, 2)}

Budget plan:
${JSON.stringify(budgetPlan, null, 2)}

Steps:
${
  preferences?.startDate
    ? `1. The user's trip starts on ${preferences.startDate}. Call get_trip_dates with startDate="${preferences.startDate}" and numberOfDays=${preferences?.numberOfDays ?? 7} to get the real calendar dates.`
    : `1. Call get_current_date to know today's date.\n2. Assume the trip starts about 2 weeks from today.\n3. Call get_trip_dates with your chosen start date and ${preferences?.numberOfDays ?? "the number of"} days to get the real calendar dates.`
}
4. Use those real dates (e.g. "Monday, May 26, 2026") as the title for each day — NOT just "Day 1", "Day 2".

Create a detailed day-by-day itinerary that fits the budget and preferences.

Return ONLY valid JSON with this exact structure:
{
  "destination": "string",
  "totalDays": "number",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "days": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "title": "Day 1 — Monday, May 26, 2026: Arrival & First Impressions",
      "morning": "Morning activity description",
      "afternoon": "Afternoon activity description",
      "evening": "Evening activity description",
      "meals": "Meal suggestions for the day",
      "estimatedDailySpend": "USD amount as string e.g. '$80'"
    }
  ]
}

Return only the JSON, no explanation, no markdown.`;
}
