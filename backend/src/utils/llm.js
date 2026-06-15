import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";

function createOpenAI(model, temperature = 0.3) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in .env");
  }

  return new ChatOpenAI({
    model,
    temperature,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function createAnthropic(model, temperature = 0.3) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in .env");
  }

  return new ChatAnthropic({
    model,
    temperature,
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

export function getLLM({
  provider = process.env.DEFAULT_PROVIDER || "openai",
  level = "fast",
  temperature = 0.3,
} = {}) {
  if (provider === "anthropic") {
    const model =
      level === "smart"
        ? process.env.ANTHROPIC_SMART_MODEL || "claude-3-5-sonnet-latest"
        : process.env.ANTHROPIC_FAST_MODEL || "claude-3-5-haiku-latest";

    const llm = createAnthropic(model, temperature);
    llm._meta = { model, provider: "anthropic", temperature };
    return llm;
  }

  const model =
    level === "smart"
      ? process.env.OPENAI_SMART_MODEL || "gpt-4o"
      : process.env.OPENAI_FAST_MODEL || "gpt-4o-mini";

  const llm = createOpenAI(model, temperature);
  llm._meta = { model, provider: "openai", temperature };
  return llm;
}
