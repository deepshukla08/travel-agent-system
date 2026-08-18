import { GoogleGenAI } from "@google/genai";
import type { z } from "zod/v4";
import { config } from "../config.js";
import { toGeminiSchema } from "../schemas/index.js";

/**
 * The only place a model is called.
 *
 * Free Gemini allows roughly 20 requests per day per model, so a single model
 * runs dry mid-session. This walks config.modelChain:
 *   429 → daily quota gone. Retrying the same model in two seconds cannot help,
 *         so it is struck off for the rest of the process.
 *   503 → model contended right now. Move to the next one.
 * Any other error is a real fault and throws immediately.
 */

export interface ModelCall<T> {
  data: T;
  /** Which model actually served the call — recorded on the audit row. */
  model: string;
  ms: number;
}

export type Generate = <T>(
  schema: z.ZodType<T>,
  prompt: string,
  /** Given, the call is streamed and each new piece of prose is handed over. */
  onToken?: (delta: string) => void,
) => Promise<ModelCall<T>>;

/** Models whose daily quota is spent. Process-lifetime only, by design. */
const exhausted = new Set<string>();

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!config.geminiApiKey) {
    throw new Error(
      "Missing GOOGLE_API_KEY — get a free key at https://aistudio.google.com/apikey",
    );
  }
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

/**
 * Google returns its errors as a JSON blob in `message`. Dumping that into the
 * UI is useless to a reader, so pull out the human sentence and add an
 * actionable hint for the one failure that is always a setup mistake.
 */
function readable(err: unknown): string {
  const raw = String((err as Error)?.message ?? err);

  let message = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (typeof parsed.error?.message === "string") message = parsed.error.message;
  } catch {
    // Not JSON — the message is already plain text.
  }

  if (/api key not valid|api_key_invalid/i.test(message)) {
    return "Invalid GOOGLE_API_KEY — check server/.env against a key from https://aistudio.google.com/apikey";
  }
  // The SDK reports a blown httpOptions.timeout as "This operation was aborted",
  // which tells the reader nothing about the cause.
  if (isTimeout(message)) {
    return `Model call exceeded the ${config.modelTimeoutMs}ms deadline (LLM_TIMEOUT_MS)`;
  }
  return message;
}

function isTimeout(message: string): boolean {
  return /operation was aborted|aborted|timed? ?out|deadline/i.test(message);
}

function statusOf(err: unknown): number | null {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status;

  // Fall back to the message: not every transport surfaces a typed status.
  const match = /\b(429|503|500|502|504)\b/.exec(String((err as Error)?.message ?? ""));
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * A retired or inaccessible model. Comes back as a 400/404, not a 5xx, so
 * without this check the chain would throw on its first entry instead of moving
 * to the next — which is the whole reason the chain exists. Google retires Flash
 * models on a few months' notice, and models.list() still returns some that a
 * newer key cannot call.
 */
function isUnavailableModel(err: unknown): boolean {
  const message = String((err as Error)?.message ?? "");
  return (
    /no longer available|is not found|not supported|does not exist|NOT_FOUND/i.test(
      message,
    ) && /model/i.test(message)
  );
}

/**
 * The prose written so far, pulled out of a half-arrived JSON response.
 *
 * A streamed structured answer turns up as `{"markdown":"# Lis`, so the value is
 * unescaped by hand. Whatever this gets slightly wrong is corrected the moment
 * the finished response is parsed — the stream exists only to be looked at.
 */
export function streamedText(partial: string): string {
  const colon = partial.indexOf(":");
  const open = colon === -1 ? -1 : partial.indexOf('"', colon + 1);
  if (open === -1) return "";

  let out = "";
  for (let i = open + 1; i < partial.length; i++) {
    const ch = partial[i]!;
    if (ch === '"') break;
    if (ch !== "\\") {
      out += ch;
      continue;
    }

    const esc = partial[++i];
    if (esc === undefined) break; // escape split across chunks — it lands next read
    // ponytail: \uXXXX is dropped mid-flight; the `done` payload carries the real text.
    if (esc === "u") {
      i += 4;
      continue;
    }
    out += esc === "n" ? "\n" : esc === "t" ? "\t" : esc === "r" ? "\r" : esc;
  }
  return out;
}

/** One attempt against one model. Streamed only when someone is listening. */
async function callModel<T>(
  model: string,
  schema: z.ZodType<T>,
  prompt: string,
  onToken?: (delta: string) => void,
): Promise<string> {
  const request = {
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: toGeminiSchema(schema),
      httpOptions: { timeout: config.modelTimeoutMs },
    },
  };

  if (!onToken) {
    const response = await getClient().models.generateContent(request);
    return response.text ?? "";
  }

  let raw = "";
  let sent = 0;

  for await (const chunk of await getClient().models.generateContentStream(
    request,
  )) {
    raw += chunk.text ?? "";
    const text = streamedText(raw);
    if (text.length > sent) {
      onToken(text.slice(sent));
      sent = text.length;
    }
  }

  return raw;
}

const realGenerate: Generate = async <T>(
  schema: z.ZodType<T>,
  prompt: string,
  onToken?: (delta: string) => void,
): Promise<ModelCall<T>> => {
  const candidates = config.modelChain.filter((m) => !exhausted.has(m));
  if (candidates.length === 0) {
    throw new Error(
      `Every model in the chain is out of daily quota (${config.modelChain.join(", ")}). Free Gemini resets at midnight Pacific.`,
    );
  }

  let lastErr: unknown;

  for (const model of candidates) {
    const started = Date.now();

    try {
      const text = await callModel(model, schema, prompt, onToken);
      if (!text) throw new Error(`${model} returned an empty response`);

      // Validate at the boundary: malformed output fails here, not three nodes
      // downstream where the cause is unrecoverable.
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(
          `${model} output failed schema: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
        );
      }

      console.log(`[model] ${model} served in ${Date.now() - started}ms`);
      return { data: parsed.data, model, ms: Date.now() - started };
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);

      if (status === 429) {
        exhausted.add(model);
        console.warn(`[model] ${model} out of daily quota — struck off`);
        continue;
      }
      if (status === 503 || status === 500 || status === 502 || status === 504) {
        console.warn(`[model] ${model} unavailable (${status}) — next in chain`);
        continue;
      }
      if (isUnavailableModel(err)) {
        // Retired for good, not just today — strike it off like an exhausted quota.
        exhausted.add(model);
        console.warn(`[model] ${model} is retired or inaccessible — struck off`);
        continue;
      }
      if (isTimeout(String((err as Error)?.message ?? ""))) {
        // Not struck off — the model is fine, this prompt was just slow on it.
        // The next entry is a lighter model, which often lands inside the
        // deadline where the heavier one did not.
        console.warn(`[model] ${model} exceeded the deadline — next in chain`);
        continue;
      }
      // Not transient — no point trying the rest of the chain.
      throw new Error(readable(err));
    }
  }

  throw new Error(readable(lastErr));
};

// ── Injection point for tests ────────────────────────────────────────────────
// Every check runs with the model stubbed, so the whole graph is verifiable
// without spending a single free-tier request.
let active: Generate = realGenerate;

export const generate: Generate = (schema, prompt, onToken) =>
  active(schema, prompt, onToken);

export function setGenerate(fn: Generate): void {
  active = fn;
}

export function resetGenerate(): void {
  active = realGenerate;
}
