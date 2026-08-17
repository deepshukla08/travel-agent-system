export function buildSynthesisePrompt(state, contributors) {
  const sections = [];

  if (state.destination) {
    sections.push(
      `## From the Destination Agent\n${JSON.stringify(state.destination, null, 2)}`,
    );
  }
  if (state.itinerary) {
    sections.push(
      `## From the Itinerary Agent\n${JSON.stringify(state.itinerary, null, 2)}`,
    );
  }
  if (state.budget) {
    sections.push(
      `## From the Budget Agent\n${JSON.stringify(state.budget, null, 2)}`,
    );
  }

  const failed = (state.errors ?? []).length
    ? `\n## Steps that failed\n${state.errors.map((e) => `- ${e}`).join("\n")}\n
Say plainly which part is missing and why. Do not invent the missing content — a
gap the traveller knows about is safer than a gap they do not.`
    : "";

  // The overage instruction is explicit because burying it in prose would
  // recreate the exact failure the Budget Agent exists to prevent.
  const budgetInstruction =
    state.budget?.withinBudget === false
      ? `
## Required: this trip is over budget

The estimate is ${state.budget.overageAmount} ${state.budget.currency} over the stated budget.
Lead the Budget section with that fact — an explicit callout near the top of the document,
not a remark further down. State the estimate, the budget, and the gap, then present the
cheaper alternative as a concrete option. Never present an over-budget trip as if it fits.`
      : "";

  const uncertaintyInstruction = state.itinerary?.uncertainties?.length
    ? `
## Required: carry the itinerary's uncertainties through

The Itinerary Agent flagged doubts (confidence: ${state.itinerary.confidence}). Keep them in
the final document as a short "Worth checking before you book" list. Do not quietly drop them
to make the plan read as more certain than it is.`
    : "";

  return `You are assembling the final answer from specialist agent output. You are a writer here,
not a planner: use only what the agents produced, and add no new recommendations, prices,
or activities of your own.

The traveller originally asked:
"${state.userRequest}"

Agents that contributed: ${contributors.join(", ") || "none"}

${sections.join("\n\n")}
${budgetInstruction}
${uncertaintyInstruction}
${failed}

Write a clear Markdown document with these sections, skipping any the agents produced nothing for:

1. **Trip Overview** — where, how long, who for, and why this destination suits them
   (use the Destination Agent's justification; do not invent your own reasoning)
2. **Budget** — a breakdown table, the total, and an explicit within-budget or over-budget verdict
3. **Day-by-Day Itinerary** — including each day's travel and sequencing notes
4. **Worth Checking Before You Book** — the itinerary's uncertainties, if any

Be warm and readable. Use headings, bullets, and tables. Do not include a JSON dump.`;
}
