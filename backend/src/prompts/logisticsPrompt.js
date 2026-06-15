export function buildLogisticsPrompt(preferences, destinationResearch) {
  return `You are a travel logistics advisor.

Travel preferences:
${JSON.stringify(preferences, null, 2)}

Destination info:
${JSON.stringify(destinationResearch, null, 2)}

Provide practical logistics and travel advice for this trip.

Return ONLY valid JSON with this exact structure:
{
  "localTransport": ["best transport options in the destination"],
  "safetyTips": ["important safety advice for travelers"],
  "documentsVisa": ["required documents, visa info, and entry requirements"],
  "weatherPacking": ["weather expectations and packing recommendations"],
  "timingTips": ["best time of day advice, booking tips, timing recommendations"],
  "commonMistakes": ["mistakes tourists commonly make and how to avoid them"]
}

Return only the JSON, no explanation, no markdown.`;
}
