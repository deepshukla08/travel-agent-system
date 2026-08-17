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
   * Ordered capable-first; lite models are last because they hold the numeric
   * reasoning worst.
   *
   * These IDs were confirmed by actually calling them. Two traps found doing so:
   * gemini-2.0-flash is retired outright, and gemini-2.5-flash still appears in
   * models.list() but rejects new keys with "no longer available to new users".
   * So the list endpoint is not proof a model is callable — only a call is.
   *
   * The `-latest` aliases sit last so the chain survives the next retirement
   * without a code change.
   */
  modelChain: list(
    process.env.GEMINI_MODELS,
    "gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest,gemini-flash-lite-latest",
  ),

  modelTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90_000),
} as const;
