export function buildFinalPlannerPrompt(state) {
  return `You are a senior travel planner creating a final polished travel plan document.

User's original request: "${state.userRequest}"

Here is all the research and planning done by specialist agents:

PREFERENCES:
${JSON.stringify(state.preferences, null, 2)}

DESTINATION RESEARCH:
${JSON.stringify(state.destinationResearch, null, 2)}

BUDGET PLAN:
${JSON.stringify(state.budgetPlan, null, 2)}

ITINERARY:
${JSON.stringify(state.itinerary, null, 2)}

LOGISTICS & TIPS:
${JSON.stringify(state.logistics, null, 2)}

Create a clean, well-structured final travel plan in Markdown format. Make it friendly, readable, and ready to share.

Include these sections:
1. Trip Overview
2. Budget Summary (with breakdown table)
3. Day-by-Day Itinerary
4. Logistics & Tips
5. Important Notes

Use Markdown headings, bullet points, and tables where helpful.`;
}
