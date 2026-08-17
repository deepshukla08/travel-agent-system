/**
 * Normalise a budget into { amount, currency }.
 *
 * The Preference step asks the model for a plain number and an ISO code, but
 * people write "1 lakh INR", "£1,500", "under 1500 pounds", "25k". Budget is
 * the one field the "never silently exceed" guarantee is computed from, so it
 * gets parsed defensively here instead of being trusted from the model.
 *
 * Returns { amount: null, currency: null } when there is no usable number —
 * callers treat that as "no budget stated", never as zero.
 */

const SYMBOLS = {
  "£": "GBP",
  $: "USD",
  "€": "EUR",
  "₹": "INR",
  "¥": "JPY",
};

const WORDS = {
  pound: "GBP", pounds: "GBP", gbp: "GBP", quid: "GBP", sterling: "GBP",
  dollar: "USD", dollars: "USD", usd: "USD", buck: "USD", bucks: "USD",
  euro: "EUR", euros: "EUR", eur: "EUR",
  rupee: "INR", rupees: "INR", inr: "INR", rs: "INR",
  yen: "JPY", jpy: "JPY",
  aud: "AUD", cad: "CAD", chf: "CHF", cny: "CNY", sgd: "SGD",
  aed: "AED", dirham: "AED", dirhams: "AED",
  thb: "THB", baht: "THB", nzd: "NZD", zar: "ZAR",
};

// Indian units matter here: "1 lakh" is 100,000 and a naive parser reads it as 1.
const MULTIPLIERS = {
  k: 1e3, thousand: 1e3, thousands: 1e3,
  m: 1e6, mn: 1e6, million: 1e6, millions: 1e6,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5,
  crore: 1e7, crores: 1e7,
};

const MULTIPLIER_ALTERNATION = Object.keys(MULTIPLIERS)
  .sort((a, b) => b.length - a.length) // longest first so "lakhs" beats "lakh"
  .join("|");

// Commas group digits ("1,500", "1,00,000"); spaces do not, or "2 people 1500"
// would parse as 2. One optional space is allowed before a multiplier word.
const AMOUNT_RE = new RegExp(
  `(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${MULTIPLIER_ALTERNATION})?\\b`,
  "i",
);

export function parseBudget(input) {
  const empty = { amount: null, currency: null };

  if (input == null) return empty;

  if (typeof input === "number") {
    return Number.isFinite(input) && input > 0
      ? { amount: input, currency: null }
      : empty;
  }

  if (typeof input !== "string") return empty;

  const text = input.trim();
  if (!text) return empty;

  // ── Currency ───────────────────────────────────────────────────────────────
  let currency = null;

  for (const [symbol, code] of Object.entries(SYMBOLS)) {
    if (text.includes(symbol)) {
      currency = code;
      break;
    }
  }

  if (!currency) {
    // Word or ISO code, whichever appears. \b keeps "rs" out of "rupees-ish"
    // prose and stops "m" in "mid-range" reading as a currency.
    for (const [word, code] of Object.entries(WORDS)) {
      if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
        currency = code;
        break;
      }
    }
  }

  // ── Amount ─────────────────────────────────────────────────────────────────
  const match = text.match(AMOUNT_RE);
  if (!match) return { amount: null, currency };

  const digits = match[1].replace(/[,\s]/g, "");
  const base = Number.parseFloat(digits);
  if (!Number.isFinite(base) || base <= 0) return { amount: null, currency };

  const multiplier = match[2] ? MULTIPLIERS[match[2].toLowerCase()] : 1;
  const amount = Math.round(base * multiplier);

  return { amount, currency };
}
