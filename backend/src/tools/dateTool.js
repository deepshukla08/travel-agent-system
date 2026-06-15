import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ─── Utility functions ────────────────────────────────────────────────────────
export function getCurrentDate() {
  return new Date().toISOString().split("T")[0];
}

export function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}

export function formatDateRange(startDate, numberOfDays) {
  const start = new Date(startDate);
  const end = new Date(startDate);
  end.setDate(end.getDate() + numberOfDays - 1);
  return `${start.toDateString()} to ${end.toDateString()}`;
}

// ─── LangChain tools ──────────────────────────────────────────────────────────

/** Returns today's date so the LLM can anchor the itinerary to real calendar dates. */
export const getCurrentDateTool = tool(
  async () => {
    const today = getCurrentDate();
    return `Today's date is ${today} (${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })})`;
  },
  {
    name: "get_current_date",
    description:
      "Get today's date. Call this first so you know the current date before calculating trip start and end dates.",
    schema: z.object({}),
  },
);

/** Given a start date + number of days, returns each day's real calendar date and weekday. */
export const getTripDatesTool = tool(
  async ({ startDate, numberOfDays }) => {
    const dates = [];
    for (let i = 0; i < numberOfDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dates.push({
        day: i + 1,
        date: d.toISOString().split("T")[0],
        dayName: d.toLocaleDateString("en-US", { weekday: "long" }),
        displayDate: d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        }),
      });
    }
    return JSON.stringify(dates);
  },
  {
    name: "get_trip_dates",
    description:
      "Given a trip start date (YYYY-MM-DD) and number of days, returns the real calendar date and weekday name for every day of the trip. Use these dates in the itinerary.",
    schema: z.object({
      startDate: z
        .string()
        .describe("Trip start date in YYYY-MM-DD format, e.g. 2026-05-20"),
      numberOfDays: z.number().describe("Total number of trip days"),
    }),
  },
);
