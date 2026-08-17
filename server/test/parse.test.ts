import test from "node:test";
import assert from "node:assert/strict";
import { parseRequest } from "../src/tools/parseRequest.js";

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
});

test("collects stated interests", () => {
  const parsed = parseRequest("somewhere warm with food markets and museums");
  assert.ok(parsed.interests.includes("food"));
  assert.ok(parsed.interests.includes("markets"));
  assert.ok(parsed.interests.includes("museums"));
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
