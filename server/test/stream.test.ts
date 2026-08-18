import test from "node:test";
import assert from "node:assert/strict";
import { streamedText } from "../src/agents/model.js";

/**
 * The streamed answer is read out of JSON that has not finished arriving, so the
 * half-way states are what matter: a cut-off string, an escape split across two
 * chunks, nothing usable yet.
 */

test("streamedText decodes the prose that has arrived so far", () => {
  assert.equal(streamedText('{"markdown":"# Lis'), "# Lis");
  assert.equal(
    streamedText('{"markdown":"# Lisbon\\n\\n**5** days, \\"warm\\"'),
    '# Lisbon\n\n**5** days, "warm"',
  );
  assert.equal(streamedText('{"markdown":"All done."}'), "All done.");
});

test("streamedText yields nothing until there is a string to read", () => {
  assert.equal(streamedText(""), "");
  assert.equal(streamedText('{"markd'), "");
  assert.equal(streamedText('{"markdown":'), "");
});

test("streamedText never goes backwards as chunks land", () => {
  const chunks = ['{"markdown":"a', "\\", 'nb', '"}'];
  let raw = "";
  let last = "";

  for (const chunk of chunks) {
    raw += chunk;
    const text = streamedText(raw);
    // A split escape may reveal no new characters, but it must not lose any.
    assert.ok(text.startsWith(last), `${JSON.stringify(text)} dropped prose`);
    last = text;
  }

  assert.equal(last, "a\nb");
});
