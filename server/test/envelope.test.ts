import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetEnvelope,
  describeEnvelope,
} from "../src/tools/budgetEnvelope.js";
import { parseRequest } from "../src/tools/parseRequest.js";

/**
 * The budget used to reach the Itinerary Agent as inert context — in its
 * constraints block, never mentioned in its prompt, absent from its output. These
 * cover the arithmetic that turns it into a spending limit the plan can be held to.
 */

test("an envelope splits the total and never loses a unit to rounding", () => {
  const envelope = budgetEnvelope(
    parseRequest("5 days in Udaipur from Ahmedabad under 5001 INR"),
    5,
  );

  assert.ok(envelope);
  assert.equal(
    envelope.flights + envelope.accommodation + envelope.activities,
    5001,
    "the parts must sum to the whole, not to 99% of it",
  );
  assert.equal(envelope.currency, "INR");
});

test("the per-day allowance is what is left, divided by the trip", () => {
  const envelope = budgetEnvelope(parseRequest("4 days in Goa under 10000 INR"), 4);

  assert.ok(envelope);
  // 40% of 10000 for food and activities, across 4 days.
  assert.equal(envelope.activities, 4000);
  assert.equal(envelope.perDay, 1000);
});

test("no budget means no envelope, not a zero one", () => {
  // A zero allowance would read as "spend nothing", which is a wrong instruction
  // rather than an absent one.
  assert.equal(budgetEnvelope(parseRequest("4 days in Goa"), 4), null);
});

test("a nonsensical trip length yields no envelope", () => {
  assert.equal(budgetEnvelope(parseRequest("trip under 500 GBP"), 0), null);
});

test("the prompt text tells the model the number, and that it may exceed it", () => {
  const envelope = budgetEnvelope(parseRequest("4 days in Goa under 10000 INR"), 4);
  const text = describeEnvelope(envelope);

  assert.match(text, /1000/, "the per-day figure reaches the prompt");
  assert.match(text, /10000/, "and so does the total");

  // The guide must not become an order to fit: forcing the plan under the number
  // is how the original budget prompt ended up fabricating totals.
  assert.match(text, /guide, not a quote/i);
});

test("with no budget the model is still told to be proportionate", () => {
  const text = describeEnvelope(null);
  assert.match(text, /no budget was stated/i);
  assert.match(text, /do not assume money is no object/i);
});
