import "dotenv/config";

/**
 * Every env var and model name, in one place.
 *
 * Nothing throws at import time — the tests stub the model and must run with no
 * API key at all. The key is validated on first real model call instead.
 */
function list(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),

  allowedOrigins: list(
    process.env.ALLOWED_ORIGINS,
    "http://localhost:5173,http://127.0.0.1:5173",
  ),

  geminiApiKey: process.env.GOOGLE_API_KEY ?? "",

  dbPath: process.env.DB_PATH ?? "data/runs.db",

  /**
   * Free Gemini allows roughly 20 requests per day per model, so a single model
   * runs dry mid-afternoon. The client walks this chain in order:
   *   429 → that model's daily quota is gone, move on and do not come back
   *   503 → that model is contended right now, move on
   * Ordered cheapest-capable first; lite models are last because they hold the
   * numeric reasoning worst.
   */
  modelChain: list(
    process.env.GEMINI_MODELS,
    "gemini-2.0-flash,gemini-2.5-flash,gemini-2.0-flash-lite,gemini-2.5-flash-lite",
  ),

  modelTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 45_000),
} as const;
