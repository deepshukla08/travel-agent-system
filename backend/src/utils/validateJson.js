/**
 * Safely parse JSON from an LLM response.
 * Handles raw JSON, markdown code blocks, and JSON embedded in text.
 */
export function safeParseJSON(text) {
  // 1. Try direct parse
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    // continue
  }

  // 2. Try extracting from markdown code block ```json ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return { ok: true, data: JSON.parse(codeBlockMatch[1].trim()) };
    } catch {
      // continue
    }
  }

  // 3. Try extracting the first { ... } block
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return { ok: true, data: JSON.parse(jsonMatch[0]) };
    } catch {
      // continue
    }
  }

  return {
    ok: false,
    error: "Failed to parse JSON from LLM response",
    raw: text,
  };
}
