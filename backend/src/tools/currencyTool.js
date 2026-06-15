import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ─── LangChain tool ───────────────────────────────────────────────────────────
/**
 * Fetches the live USD exchange rate for any currency using open.er-api.com
 * (free tier, no API key required).
 */
export const getExchangeRateTool = tool(
  async ({ targetCurrency }) => {
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/USD");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rate = data.rates?.[targetCurrency.toUpperCase()];
      if (!rate) {
        return JSON.stringify({
          error: `No rate for ${targetCurrency}. Try: EUR, GBP, JPY, INR, AED, THB, SGD, AUD, CAD, MXN, IDR, TRY, BRL`,
        });
      }
      return JSON.stringify({
        baseCurrency: "USD",
        targetCurrency: targetCurrency.toUpperCase(),
        rate,
        meaning: `1 USD = ${rate} ${targetCurrency.toUpperCase()}`,
        lastUpdated: data.time_last_update_utc,
      });
    } catch (err) {
      return JSON.stringify({
        error: "Exchange rate fetch failed. Fall back to USD-only estimates.",
        detail: err.message,
      });
    }
  },
  {
    name: "get_exchange_rate",
    description:
      "Get the live USD exchange rate for the destination's local currency. Use this to show budget costs in both USD and local currency so the traveler knows exactly what to expect.",
    schema: z.object({
      targetCurrency: z
        .string()
        .describe(
          "3-letter ISO currency code for the destination country, e.g. INR for India, AED for Dubai, THB for Thailand, EUR for Europe, JPY for Japan",
        ),
    }),
  },
);
