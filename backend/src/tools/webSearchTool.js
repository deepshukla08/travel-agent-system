import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * Web search tool powered by Tavily REST API (called directly via fetch).
 * Requires TAVILY_API_KEY in .env — get a free key at https://tavily.com
 * Falls back gracefully to LLM knowledge when no key is set.
 */
export const webSearchTool = tool(
  async ({ query }) => {
    if (!process.env.TAVILY_API_KEY) {
      return JSON.stringify({
        note: "Live web search unavailable. Add TAVILY_API_KEY to .env for real-time results (free at https://tavily.com). Using LLM training knowledge instead.",
        query,
      });
    }
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          search_depth: "basic",
          max_results: 3,
          include_answer: true,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        return JSON.stringify({
          error: `Tavily HTTP ${response.status}`,
          detail: text,
          query,
        });
      }
      const data = await response.json();
      // Return the AI answer + top result snippets
      const results = (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content?.slice(0, 400),
      }));
      return JSON.stringify({ answer: data.answer ?? null, results });
    } catch (err) {
      return JSON.stringify({
        error: "Search failed",
        detail: err.message,
        query,
      });
    }
  },
  {
    name: "web_search",
    description:
      "Search the web for up-to-date travel information: current attraction reviews, hotel areas, local food recommendations, safety advisories, visa requirements, and travel tips.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "Specific search query, e.g. 'best areas to stay in Bangkok for tourists 2025' or 'top attractions New York City'",
        ),
    }),
  },
);
