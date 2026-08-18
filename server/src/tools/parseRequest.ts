import type {
  Answers,
  Constraints,
  HardConstraint,
} from "../schemas/index.js";

/**
 * Pulls constraints out of a plain-language request. Deterministic: a regex and
 * a lookup, never a model call.
 *
 * Keeping this out of the agent layer is what makes routing testable — you can
 * assert that "roughly what does a week in Rome cost?" routes to Budget alone,
 * which you could never do if a model decided it.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  "£": "GBP",
  $: "USD",
  "€": "EUR",
  "₹": "INR",
  "¥": "JPY",
};

const CURRENCY_WORDS: Record<string, string> = {
  pound: "GBP", pounds: "GBP", gbp: "GBP", quid: "GBP", sterling: "GBP",
  dollar: "USD", dollars: "USD", usd: "USD",
  euro: "EUR", euros: "EUR", eur: "EUR",
  rupee: "INR", rupees: "INR", inr: "INR",
  yen: "JPY", jpy: "JPY",
};

// "1 lakh" is 100,000 — a naive parser reads it as 1.
const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, million: 1e6,
  lakh: 1e5, lakhs: 1e5, lac: 1e5,
  crore: 1e7, crores: 1e7,
};

const CLIMATE_WORDS: Record<string, string> = {
  warm: "warm", hot: "warm", sunny: "warm", tropical: "warm", beach: "warm",
  cold: "cold", snow: "cold", snowy: "cold", ski: "cold", skiing: "cold",
  mild: "mild", temperate: "mild",
};

const REGIONS = [
  "europe", "asia", "south east asia", "southeast asia", "africa",
  "south america", "north america", "central america", "middle east",
  "caribbean", "scandinavia", "mediterranean", "balkans", "oceania",
];

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const INTEREST_WORDS = [
  "food", "foodie", "markets", "museums", "art", "history", "hiking",
  "nightlife", "walkable", "walking", "diving", "surfing", "wine",
  "architecture", "shopping", "wildlife", "photography", "culture",
];

const MULTIPLIER_RE = Object.keys(MULTIPLIERS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Commas group digits; spaces do not, or "2 people 1500" parses as 2. */
const AMOUNT_RE = new RegExp(
  `(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${MULTIPLIER_RE})?\\b`,
  "i",
);

function findCurrency(text: string): string | null {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  for (const [word, code] of Object.entries(CURRENCY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) return code;
  }
  return null;
}

function parseAmount(text: string): number | null {
  const match = AMOUNT_RE.exec(text);
  if (!match?.[1]) return null;

  const base = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base) || base <= 0) return null;

  const multiplier = match[2] ? (MULTIPLIERS[match[2].toLowerCase()] ?? 1) : 1;
  return Math.round(base * multiplier);
}

/**
 * Budget phrasing is "under £1500", "below 1500 pounds", "max £1500", "£1500
 * budget". Anchoring on those words avoids reading "5 days" or "2 people" as an
 * amount — the mistake that would silently make every trip over budget.
 */
/**
 * A clause fragment: any run of characters up to a clause boundary, except that
 * a comma is allowed when it sits inside a number.
 *
 * Without the lookahead, "max $4,000" captures "$4" and parses as 4 — while a
 * plain `[^,.;]*` would run "under £1500, for 2 people" together and could read
 * the party size as the budget.
 */
const CLAUSE = String.raw`(?:[^,.;]|,(?=\d)){1,30}`;

function parseBudget(
  text: string,
): { currency: string | null; max: number } | null {
  const patterns = [
    new RegExp(
      `(?:under|below|less than|up to|max(?:imum)?|no more than|within)\\s+(${CLAUSE})`,
      "i",
    ),
    /([£$€₹¥]\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m)?)\s*(?:budget|total|max)?/i,
    /\b(\d[\d,]*\s*(?:k|lakh|lakhs|crore|crores)?\s*(?:pounds?|dollars?|euros?|rupees?|gbp|usd|eur|inr))\b/i,
    new RegExp(`budget\\s+(?:of\\s+)?(${CLAUSE})`, "i"),
  ];

  for (const pattern of patterns) {
    const fragment = pattern.exec(text)?.[1];
    if (!fragment) continue;

    const max = parseAmount(fragment);
    if (max == null) continue;

    // Fall back to the whole request for the currency: "under 1500" often has
    // its symbol outside the matched fragment. Null if it truly is not there —
    // sterling is not a safe default for a request that never mentioned it.
    return { currency: findCurrency(fragment) ?? findCurrency(text), max };
  }

  return null;
}

function parseDays(text: string): number | null {
  const direct = /(\d+)[\s-]*(?:day|days|night|nights)\b/i.exec(text);
  if (direct?.[1]) return Number.parseInt(direct[1], 10);

  if (/\b(?:a |one )?week(?:end)?\b/i.test(text)) {
    return /weekend/i.test(text) ? 3 : 7;
  }
  if (/\bfortnight|two weeks\b/i.test(text)) return 14;

  const words: Record<string, number> = {
    three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  for (const [word, n] of Object.entries(words)) {
    if (new RegExp(`\\b${word}[\\s-]*(?:day|night)`, "i").test(text)) return n;
  }
  return null;
}

function parseTravellers(text: string): number | null {
  const explicit = /(\d+)\s*(?:people|persons|adults|travellers|travelers|of us)\b/i.exec(text);
  if (explicit?.[1]) return Number.parseInt(explicit[1], 10);

  if (/\bsolo\b|\bby myself\b|\balone\b|\bjust me\b/i.test(text)) return 1;
  if (/\bcouple\b|\bmy (?:wife|husband|partner|girlfriend|boyfriend)\b/i.test(text)) return 2;

  const family = /family of (\d+)/i.exec(text);
  if (family?.[1]) return Number.parseInt(family[1], 10);

  return null;
}

/**
 * Where the trip starts. "from Delhi to Goa" gives both, since origin and
 * destination use different prepositions and cannot collide.
 */
function parseOrigin(text: string): string | null {
  // Same shape as parseDestination, and lowercase for the same reason — "from
  // ahmedabad" is how people actually type it.
  const re =
    /\b(?:from|out of)\s+((?:(?:the|a|an)\s+)*)([A-Z][a-zA-Z]+(?:[\s-][A-Z][a-zA-Z]+)?|[a-z][a-z]+)/g;

  for (const match of text.matchAll(re)) {
    const candidate = match[2]?.trim();
    if (!candidate) continue;

    const lower = candidate.toLowerCase();
    if (REGIONS.includes(lower)) continue;
    if (lower.split(/[\s-]/).some((word) => NOT_PLACES.has(word))) continue;

    return candidate;
  }

  return null;
}

/**
 * Words that follow "in"/"to" without being a place. Without this list, "in
 * February" reads as a trip to February, and "to go somewhere" as a trip to "go".
 */
const NOT_PLACES = new Set([
  // filler and verbs
  "go", "going", "see", "seeing", "visit", "travel", "travelling", "traveling",
  "explore", "find", "stay", "eat", "relax", "do", "spend", "get", "have",
  "escape", "book", "plan", "the", "a", "an", "my", "our", "some", "any",
  "to", "in", "for", "and", "or",
  // vague place words — these are constraints, not destinations
  "somewhere", "anywhere", "nowhere", "abroad", "overseas", "home", "there",
  ...MONTHS,
  ...Object.keys(CLIMATE_WORDS),
]);

/**
 * Destination is only taken from an explicit "in/to <place>", never from a bare
 * capitalised word — "Plan A Trip" would otherwise become a destination.
 *
 * Lowercase is accepted because people type "i wanna go to udaipur", but only as
 * a single word: capitalisation is the only reliable signal for a two-word name
 * like "New York", and without it "to udaipur for" would swallow the "for".
 * Filler is skipped so "to visit Kyoto" and "to the Algarve" both land.
 */
function parseDestination(text: string): string | null {
  const re =
    /\b(?:in|to|visit(?:ing)?)\s+((?:(?:the|a|an|to|go|see|visit|explore)\s+)*)([A-Z][a-zA-Z]+(?:[\s-][A-Z][a-zA-Z]+)?|[a-z][a-z]+)/g;

  for (const match of text.matchAll(re)) {
    const candidate = match[2]?.trim();
    if (!candidate) continue;

    const lower = candidate.toLowerCase();

    // Regions are constraints, not destinations: "in Europe" means choose one.
    if (REGIONS.includes(lower)) continue;
    if (lower.split(/[\s-]/).some((word) => NOT_PLACES.has(word))) continue;

    return candidate;
  }

  return null;
}

/**
 * Fold form answers over what the free-text parse found.
 *
 * Each answer is parsed in the context of its own field, which is the whole point
 * of keeping them separate: "Lisbon" in the where box is a destination, and "5"
 * in the days box is five days — neither reads that way in a sentence.
 *
 * An unparseable answer ("whatever you suggest") is left as nothing rather than
 * forced, so the agent assumes a value and discloses it.
 */
export function applyAnswers(
  constraints: Constraints,
  answers: Answers,
): Constraints {
  const merged: Constraints = {
    ...constraints,
    hard: [...constraints.hard],
    interests: [...constraints.interests],
  };

  if (answers.from) {
    // The origin box holds a place, so it is taken as one — no need to recognise
    // a preposition that the form has already made explicit.
    const parsed = parseRequest(answers.from);
    merged.origin = parsed.origin ?? parsed.destination ?? answers.from;
  }

  // Asked and left blank. That is an answer: choose one for me. Without this the
  // form's origin ("Chandigarh") was the only place in the composed sentence, so
  // the destination was read from it and the Destination Agent never ran.
  if (answers.where !== undefined && answers.where.trim() === "") {
    merged.destination = null;
  }

  if (answers.where) {
    const fromWhere = parseRequest(answers.where);

    if (fromWhere.destination) {
      merged.destination = fromWhere.destination;
    } else if (fromWhere.hard.length > 0) {
      // A description, not a place — "somewhere warm in Europe".
      for (const h of fromWhere.hard) {
        if (!merged.hard.some((existing) => existing.kind === h.kind)) {
          merged.hard.push(h);
        }
      }
    } else if (answers.where.split(/\s+/).length <= 4) {
      // Short, and nothing recognisable in it: take it as a place name. The
      // Destination Agent copes with "Portugal or Spain" better than we would.
      merged.destination = answers.where;
    }
    merged.interests.push(...fromWhere.interests);
  }

  // An answer the traveller typed into a box wins outright. Falling back to what
  // prose found would let a number from an earlier turn override what they just
  // said: "7 daays" failed to parse and silently kept the "4 days" from a previous
  // message. Unparseable now means unset, and the agent discloses its assumption.
  if (answers.days) {
    merged.days = parseDaysField(answers.days);
  }

  if (answers.budget !== undefined) {
    // In a box labelled "what would you like to spend", any amount is the budget —
    // so this uses the unanchored parser rather than the prose one, which needs a
    // currency or a word like "under" nearby and so read "5k" as nothing at all.
    const amount = parseAmount(answers.budget);

    // Currency stays null when unstated rather than defaulting: guessing GBP for
    // someone typing "5k" on a trip within India is a silent wrong answer, and the
    // Budget Agent can pick the local currency and say that it did. Null amount
    // clears any earlier figure, for the same reason as days above.
    merged.budget = amount
      ? { currency: findCurrency(answers.budget), max: amount }
      : null;
  }

  // Keep the hard constraints consistent with the budget that won.
  merged.hard = merged.hard.filter((h) => h.kind !== "maxBudget");
  if (merged.budget) {
    merged.hard.push({
      kind: "maxBudget",
      value: String(merged.budget.max),
      raw: `${merged.budget.currency} ${merged.budget.max}`,
    });
  }

  return merged;
}

/**
 * Trip length from the "how long for?" box.
 *
 * Lenient on purpose: the box asks one question, so any number in it is the day
 * count. The prose parser insists on the word "days" nearby, which meant a typo
 * like "7 daays" parsed to nothing at all.
 *
 * Falls back to the prose parser for worded answers — "a week", "long weekend".
 */
function parseDaysField(answer: string): number | null {
  const digits = /(\d{1,3})/.exec(answer);
  if (digits?.[1]) {
    const value = Number.parseInt(digits[1], 10);
    // A sane trip, not a typo'd year or a phone number.
    if (value > 0 && value <= 90) return value;
  }

  return parseRequest(answer).days;
}

export function parseRequest(text: string): Constraints {
  const hard: HardConstraint[] = [];

  const budget = parseBudget(text);
  if (budget) {
    hard.push({
      kind: "maxBudget",
      value: String(budget.max),
      raw: `${budget.currency} ${budget.max}`,
    });
  }

  for (const [word, climate] of Object.entries(CLIMATE_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
      if (!hard.some((h) => h.kind === "climate")) {
        hard.push({ kind: "climate", value: climate, raw: word });
      }
      break;
    }
  }

  // Longest first, so "south east asia" wins over "asia".
  for (const region of [...REGIONS].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${region}\\b`, "i").test(text)) {
      hard.push({ kind: "region", value: region, raw: region });
      break;
    }
  }

  const flightHours = /(?:no|nothing|not?)\s+(?:flights?\s+)?(?:over|more than|longer than|above)\s+(\d+)\s*(?:hours?|hrs?)/i.exec(text)
    ?? /(?:flights?|flying)\s+under\s+(\d+)\s*(?:hours?|hrs?)/i.exec(text);
  if (flightHours?.[1]) {
    hard.push({
      kind: "maxFlightHours",
      value: flightHours[1],
      raw: flightHours[0],
    });
  }

  for (const month of MONTHS) {
    if (new RegExp(`\\b${month}\\b`, "i").test(text)) {
      hard.push({ kind: "month", value: month, raw: month });
      break;
    }
  }

  const avoid = /(?:avoid|not|no|don't want|dont want)\s+([a-z\s]{3,25}?)(?:[,.]|$)/i.exec(text);
  if (avoid?.[1] && !/flights?\s+over/i.test(avoid[0])) {
    hard.push({ kind: "avoid", value: avoid[1].trim(), raw: avoid[0].trim() });
  }

  const interests = INTEREST_WORDS.filter((w) =>
    new RegExp(`\\b${w}\\b`, "i").test(text),
  );

  return {
    origin: parseOrigin(text),
    destination: parseDestination(text),
    days: parseDays(text),
    travellers: parseTravellers(text),
    budget,
    hard,
    interests,
  };
}
