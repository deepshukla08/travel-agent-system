export function buildDestinationPrompt(preferences) {
  return `You are a destination research agent with access to a web_search tool.

Travel preferences:
${JSON.stringify(preferences, null, 2)}

Use web_search to gather current, accurate information. Make these searches:
1. "top attractions in ${preferences?.destination ?? "the destination"} for tourists"
2. "best areas to stay in ${preferences?.destination ?? "the destination"} ${preferences?.travelStyle ?? ""}"
3. "local food must-try restaurants ${preferences?.destination ?? "the destination"}"

After completing your searches, return ONLY valid JSON with this exact structure:
{
  "destination": "string",
  "topAttractions": ["list of top attractions to visit"],
  "areasToStay": ["recommended area - brief reason for recommendation"],
  "localExperiences": ["unique local experiences to try"],
  "foodHighlights": ["must-try local foods and restaurants"],
  "travelNotes": ["important practical notes for this destination"]
}

Return only the JSON, no explanation, no markdown.`;
}
