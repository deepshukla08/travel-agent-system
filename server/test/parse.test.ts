import test from "node:test";
import assert from "node:assert/strict";
import { applyAnswers, parseRequest } from "../src/tools/parseRequest.js";
import { missingEssentials } from "../src/tools/route.js";

/** The parser is deterministic, so this is where the cheap confidence lives. */

test("pulls a budget out of the phrasings people actually use", () => {
  const cases: [string, number, string][] = [
    ["5 days somewhere warm in Europe for under £1500", 1500, "GBP"],
    ["a week in Rome, budget of 900 euros", 900, "EUR"],
    ["trip to Goa under 1 lakh INR", 100_000, "INR"],
    ["10 days in Japan, max $4,000", 4000, "USD"],
    ["no more than 25k rupees for a weekend", 25_000, "INR"],
    ["somewhere hot, less than 800 pounds", 800, "GBP"],
  ];

  for (const [text, max, currency] of cases) {
    const parsed = parseRequest(text);
    assert.ok(parsed.budget, `no budget parsed from: ${text}`);
    assert.equal(parsed.budget.max, max, text);
    assert.equal(parsed.budget.currency, currency, text);
  }
});

test("does not mistake trip length or party size for a budget", () => {
  // The bug that would make every trip look over budget.
  for (const text of [
    "plan 5 days in Lisbon for 2 people",
    "a week in Rome for a family of 4",
  ]) {
    assert.equal(parseRequest(text).budget, null, text);
  }
});

test("extracts trip length from digits, words and 'a week'", () => {
  assert.equal(parseRequest("5 days in Lisbon").days, 5);
  assert.equal(parseRequest("a week in Rome").days, 7);
  assert.equal(parseRequest("long weekend in Porto").days, 3);
  assert.equal(parseRequest("five days somewhere warm").days, 5);
  assert.equal(parseRequest("two weeks in Vietnam").days, 14);
  assert.equal(parseRequest("somewhere nice").days, null);
});

test("extracts party size", () => {
  assert.equal(parseRequest("5 days in Lisbon for 2 people").travellers, 2);
  assert.equal(parseRequest("solo trip to Hanoi").travellers, 1);
  assert.equal(parseRequest("a week in Rome with my partner").travellers, 2);
  assert.equal(parseRequest("family of 4 to Orlando").travellers, 4);
});

test("reads climate as a hard constraint", () => {
  const warm = parseRequest("somewhere warm in February");
  assert.deepEqual(
    warm.hard.find((h) => h.kind === "climate")?.value,
    "warm",
  );

  const cold = parseRequest("a skiing trip in January");
  assert.equal(cold.hard.find((h) => h.kind === "climate")?.value, "cold");
});

test("reads a flight-time limit", () => {
  for (const text of [
    "somewhere warm, no flights over 4 hours",
    "nothing more than 4 hours flying",
  ]) {
    const limit = parseRequest(text).hard.find(
      (h) => h.kind === "maxFlightHours",
    );
    assert.ok(limit, text);
    assert.equal(limit.value, "4", text);
  }
});

test("treats a region as a constraint, not a destination", () => {
  const parsed = parseRequest("5 days somewhere warm in Europe under £1500");

  // "in Europe" means "choose somewhere in Europe", so the Destination Agent
  // must still run — reading it as the destination would skip that agent.
  assert.equal(parsed.destination, null);
  assert.equal(parsed.hard.find((h) => h.kind === "region")?.value, "europe");
});

test("picks the longer region name when both match", () => {
  assert.equal(
    parseRequest("2 weeks in south east asia").hard.find(
      (h) => h.kind === "region",
    )?.value,
    "south east asia",
  );
});

test("extracts a named destination", () => {
  assert.equal(parseRequest("plan 4 days in Lisbon").destination, "Lisbon");
  assert.equal(parseRequest("a week in New York").destination, "New York");
  assert.equal(parseRequest("I want to visit Kyoto").destination, "Kyoto");
  assert.equal(parseRequest("trip to the Algarve").destination, "Algarve");
});

test("a lowercase destination is still a destination", () => {
  // "i wanna go to udaipur" used to parse to nothing, so the form asked where
  // they wanted to go immediately after they had said.
  assert.equal(parseRequest("i wanna go to udaipur").destination, "udaipur");
  assert.equal(parseRequest("lets go to bali").destination, "bali");
  assert.equal(
    parseRequest("trip from ahmedabad to udaipur").origin,
    "ahmedabad",
  );
});

test("a month or a filler word is never mistaken for a place", () => {
  // "in February" read as a trip TO February, which skipped the Destination Agent
  // and planned a holiday to a month.
  assert.equal(parseRequest("somewhere warm in February").destination, null);
  assert.equal(parseRequest("I want to go somewhere warm").destination, null);
  assert.equal(parseRequest("looking to escape the cold").destination, null);
  assert.equal(parseRequest("somewhere warm in Europe").destination, null);
});

test("collects stated interests", () => {
  const parsed = parseRequest("somewhere warm with food markets and museums");
  assert.ok(parsed.interests.includes("food"));
  assert.ok(parsed.interests.includes("markets"));
  assert.ok(parsed.interests.includes("museums"));
});

test("form answers are trusted over what prose alone would find", () => {
  // The exact loop this fixes: a bare "Lisbon" in the where box means Lisbon, but
  // in a sentence it matches nothing, so the form used to re-ask what was answered.
  const merged = applyAnswers(parseRequest("Plan a trip — Lisbon, 5, 1200"), {
    where: "Lisbon",
    days: "5",
    budget: "1200",
  });

  assert.equal(merged.destination, "Lisbon");
  assert.equal(merged.days, 5);
  // Currency stays null: nobody said pounds, and assuming them is a wrong answer
  // for a traveller who typed a bare number.
  assert.deepEqual(merged.budget, { currency: null, max: 1200 });
  assert.equal(missingEssentials(merged).length, 0, "must not ask again");
});

test("shorthand amounts in the budget box are understood", () => {
  // "5k" produced no budget at all: the prose parser wants a currency or a word
  // like "under" nearby, and neither is present in a field that only holds money.
  const cases: [string, number, string | null][] = [
    ["5k", 5000, null],
    ["10k inr", 10_000, "INR"],
    ["1 lakh", 100_000, null],
    ["1 lakh INR", 100_000, "INR"],
    ["£1,200", 1200, "GBP"],
    ["2.5k", 2500, null],
  ];

  for (const [typed, max, currency] of cases) {
    const merged = applyAnswers(parseRequest("Plan a trip"), {
      where: "Udaipur",
      budget: typed,
    });
    assert.deepEqual(merged.budget, { currency, max }, `budget box: ${typed}`);
  }
});

test("a typo in the days box is still understood", () => {
  // "7 daays" parsed to nothing, because the prose parser wants the word "days".
  for (const [typed, want] of [
    ["7 daays", 7],
    ["7", 7],
    ["7 dyas", 7],
    ["a week", 7],
    ["long weekend", 3],
    ["five days", 5],
  ] as [string, number][]) {
    const merged = applyAnswers(parseRequest("Plan a trip"), {
      where: "Udaipur",
      days: typed,
    });
    assert.equal(merged.days, want, `days box: ${typed}`);
  }
});

test("an unpriceable budget answer leaves no budget at all", () => {
  const merged = applyAnswers(parseRequest("Plan a trip"), {
    where: "Udaipur",
    budget: "not sure yet",
  });
  assert.equal(merged.budget, null);
});

test("a descriptive where answer becomes constraints, not a place name", () => {
  const merged = applyAnswers(parseRequest("Plan a trip"), {
    where: "somewhere warm in Europe",
  });

  assert.equal(merged.destination, null, "that is not a destination");
  assert.equal(merged.hard.find((h) => h.kind === "climate")?.value, "warm");
  assert.equal(merged.hard.find((h) => h.kind === "region")?.value, "europe");
  assert.equal(missingEssentials(merged).length, 0);
});

test("a vague answer is left unset so the agent discloses its assumption", () => {
  const merged = applyAnswers(parseRequest("Plan a trip"), {
    where: "Lisbon",
    days: "whatever you suggest",
    budget: "leave it to you",
  });

  assert.equal(merged.destination, "Lisbon");
  // Neither is forced into a number — the Itinerary Agent assumes a length and
  // says so, which is the honest path.
  assert.equal(merged.days, null);
  assert.equal(merged.budget, null);
});

test("form answers with currency and units still parse", () => {
  const merged = applyAnswers(parseRequest("Plan a trip"), {
    where: "Goa",
    days: "a long weekend",
    budget: "1 lakh INR",
  });

  assert.equal(merged.days, 3);
  assert.deepEqual(merged.budget, { currency: "INR", max: 100_000 });
});

test("the brief's own example parses completely", () => {
  const parsed = parseRequest(
    "a five day trip somewhere warm in Europe for under 1500 pounds",
  );

  assert.equal(parsed.days, 5);
  assert.equal(parsed.destination, null);
  assert.deepEqual(parsed.budget, { currency: "GBP", max: 1500 });
  assert.equal(parsed.hard.find((h) => h.kind === "climate")?.value, "warm");
  assert.equal(parsed.hard.find((h) => h.kind === "region")?.value, "europe");
});
