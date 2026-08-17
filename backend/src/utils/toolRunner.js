import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { callLLM, normaliseContent } from "./llm.js";
import { logger } from "./logger.js";
import { emit } from "./emitter.js";

const MAX_ITERATIONS = 6; // safety cap on tool-call loops

/**
 * Runs a prompt through an LLM with tools bound, handling the full
 * tool-calling loop automatically:
 *   1. Invoke LLM with the prompt
 *   2. If it calls tools → execute them all in parallel → feed results back
 *   3. Repeat until the LLM produces a plain text response (no more tool calls)
 *
 * @param {import("@langchain/core/language_models/chat_models").BaseChatModel} llm
 * @param {import("@langchain/core/tools").StructuredTool[]} tools
 * @param {string} promptText
 * @param {string} [agentName] - Name of the calling agent (for SSE tool events)
 * @returns {Promise<string>} Final text content from the LLM
 */
export async function runWithTools(
  llm,
  tools,
  promptText,
  agentName = "Agent",
) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const llmWithTools = llm.bindTools(tools);
  const messages = [new HumanMessage(promptText)];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await callLLM(llmWithTools, messages, { label: agentName });
    messages.push(response);

    // No tool calls → final text answer
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return normaliseContent(response.content);
    }

    // Execute all tool calls in parallel
    const toolMessages = await Promise.all(
      response.tool_calls.map(async (tc) => {
        const fn = toolMap.get(tc.name);
        let result;
        if (fn) {
          try {
            logger.toolCall(tc.name, tc.args);
            emit("tool_start", {
              agent: agentName,
              tool: tc.name,
              args: tc.args,
            });
            result = await fn.invoke(tc.args);
            logger.toolResult(tc.name, result);
            const resultStr =
              typeof result === "string" ? result : JSON.stringify(result);
            emit("tool_result", {
              agent: agentName,
              tool: tc.name,
              result: resultStr.slice(0, 300),
            });
          } catch (err) {
            result = JSON.stringify({ error: err.message });
            emit("tool_result", {
              agent: agentName,
              tool: tc.name,
              result: `Error: ${err.message}`,
            });
          }
        } else {
          result = JSON.stringify({ error: `Unknown tool: ${tc.name}` });
          emit("tool_result", {
            agent: agentName,
            tool: tc.name,
            result: `Unknown tool: ${tc.name}`,
          });
        }
        return new ToolMessage({
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: tc.id,
        });
      }),
    );

    messages.push(...toolMessages);
  }

  // Exceeded iteration limit — return whatever the last AI message had
  const last = messages.findLast((m) => m._getType?.() === "ai");
  return normaliseContent(last?.content);
}
