import "dotenv/config";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { logger } from "./logger.js";

/**
 * Google AI Studio (Gemini) free tier — see .env.example.
 * Two tiers so agents can pick reasoning power vs. speed:
 *   smart → structured reasoning (destination shortlisting, itinerary, budget maths)
 *   fast  → cheap classification (preference extraction, routing)
 */
const MODELS = {
  smart: process.env.GEMINI_SMART_MODEL || "gemini-2.0-flash",
  fast: process.env.GEMINI_FAST_MODEL || "gemini-2.0-flash-lite",
};

const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 45_000;

export function getLLM({ level = "fast", temperature = 0.3 } = {}) {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error(
      "Missing GOOGLE_API_KEY — get a free key at https://aistudio.google.com/apikey",
    );
  }

  const model = MODELS[level] ?? MODELS.fast;

  const llm = new ChatGoogleGenerativeAI({
    model,
    temperature,
    apiKey: process.env.GOOGLE_API_KEY,
    // We do our own bounded retry in callLLM. LangChain's default of 6 would
    // stack on top of it and blow past any sane request deadline.
    maxRetries: 0,
  });

  llm._meta = { model, provider: "google", temperature };
  return llm;
}

/**
 * Gemini returns message content either as a plain string or as an array of
 * content blocks. Everything downstream (safeParseJSON, .slice(), the SSE
 * payloads) assumes a string, so every read of `response.content` goes here.
 */
export function normaliseContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string" ? part : (part?.text ?? part?.content ?? ""),
      )
      .join("");
  }
  return content == null ? "" : String(content);
}

/** 429s and 5xx are the free tier's normal weather; timeouts are ours. */
function isRetryable(err) {
  const status = err?.status ?? err?.response?.status ?? err?.code;
  if (status === 429 || status === 503) return true;
  if (typeof status === "number" && status >= 500 && status < 600) return true;

  const msg = String(err?.message ?? "").toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("overloaded") ||
    msg.includes("fetch failed")
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Invoke a model with a hard deadline and one bounded retry.
 *
 * Without this a hung provider call holds the SSE response open forever, and a
 * single free-tier 429 kills an otherwise good run. Retries only on transient
 * failures — a malformed request is not worth repeating.
 *
 * @param {import("@langchain/core/language_models/chat_models").BaseChatModel} llm
 * @param {string | import("@langchain/core/messages").BaseMessage[]} input
 * @returns {Promise<import("@langchain/core/messages").AIMessage>}
 */
export async function callLLM(
  llm,
  input,
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, label = "llm" } = {},
) {
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`${label}: timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    try {
      return await llm.invoke(input, { signal: controller.signal });
    } catch (err) {
      // An aborted call surfaces as a generic AbortError; swap in our reason so
      // the audit row and the SSE error say "timed out" rather than "aborted".
      lastErr = controller.signal.aborted
        ? (controller.signal.reason ?? err)
        : err;

      if (attempt === retries || !isRetryable(lastErr)) break;

      const backoff = 600 * 2 ** attempt + Math.floor(Math.random() * 400);
      logger.warn(
        `${label}: ${lastErr.message} — retrying in ${backoff}ms (attempt ${attempt + 2}/${retries + 1})`,
      );
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr;
}
