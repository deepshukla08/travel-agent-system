import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prompts live in prompts/*.md and are read once at module load.
 *
 * Wording gets iterated on far more than code does, so keeping it out of
 * template literals means editing a prompt never touches TypeScript. Read
 * eagerly so a missing or renamed file fails at boot, not mid-request.
 */
const here = dirname(fileURLToPath(import.meta.url));

function load(name: string): string {
  return readFileSync(join(here, "prompts", `${name}.md`), "utf8");
}

const TEMPLATES = {
  destination: load("destination"),
  itinerary: load("itinerary"),
  budget: load("budget"),
  synthesize: load("synthesize"),
} as const;

export type PromptName = keyof typeof TEMPLATES;

/** Replaces every {{placeholder}}; an unfilled one is a bug, so it throws. */
export function prompt(
  name: PromptName,
  values: Record<string, string>,
): string {
  return TEMPLATES[name].replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Prompt "${name}" has no value for {{${key}}}`);
    }
    return value;
  });
}
