import test from "node:test";
import assert from "node:assert/strict";
import { isSchema } from "./support.js";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/index.js";
import { setGenerate, resetGenerate, type Generate } from "../src/agents/model.js";
import {
  BudgetResultSchema,
  DestinationResultSchema,
  ItineraryResultSchema,
} from "../src/schemas/index.js";

/**
 * Verifies the HTTP layer: SSE framing, event order, and that a run lands in
 * storage with its per-agent audit rows. Model stubbed, so it costs nothing.
 */

const ANSWER = "# Lisbon\n\nFive days.";

const stub: Generate = (async (
  schema: unknown,
  _prompt: string,
  onToken?: (delta: string) => void,
) => {
  const call = (data: unknown) => ({ data, model: "stub", ms: 1 });


  if (isSchema(schema, DestinationResultSchema)) {
    return call({
      suggestions: [
        {
          name: "Lisbon",
          country: "Portugal",
          legs: [{ place: "Lisbon", nights: 5, note: "one base" }],
          suggestedDays: 5,
          justification:
            "Warm in May, inside Europe, walkable, with the food markets they asked for and inside budget.",
          constraintChecks: [{ kind: "climate", passes: true, reason: "22C" }],
          estimatedTotalCost: 1200,
        },
      ],
    });
  }
  if (isSchema(schema, ItineraryResultSchema)) {
    return call({
      destination: "Lisbon",
      days: Array.from({ length: 5 }, (_, i) => ({
        day: i + 1,
        title: `Day ${i + 1}`,
        morning: "walk",
        afternoon: "tram",
        evening: "dinner",
        travelNotes: "all on foot",
        estimatedSpend: 40,
        uncertain: false,
        uncertaintyReason: null,
      })),
    });
  }
  if (isSchema(schema, BudgetResultSchema)) {
    return call({
      currency: "GBP",
      items: [{ label: "everything", cost: 1200 }],
      total: 1200,
      alternative: null,
      assumptions: [],
    });
  }
  // Synthesis is the streamed call: hand the answer over in pieces the way the
  // real model does, so the SSE token frames are exercised.
  for (const piece of ANSWER.match(/\S+\s*/g) ?? []) onToken?.(piece);
  return call({ markdown: ANSWER });
}) as Generate;

/** Boot on an ephemeral port so the checks never collide with a dev server. */
async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Minimal SSE reader: split on blank lines, keep event name and payload. */
async function readSSE(response: Response) {
  const text = await response.text();

  return text
    .split("\n\n")
    .filter((frame) => frame.trim())
    .map((frame) => {
      const name = /^event: (.+)$/m.exec(frame)?.[1] ?? "";
      const data = /^data: (.+)$/m.exec(frame)?.[1] ?? "{}";
      return { name, data: JSON.parse(data) as Record<string, unknown> };
    });
}

test.beforeEach(() => setGenerate(stub));
test.afterEach(() => resetGenerate());

test("POST /api/plan streams plan, agent and done events in order", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: "plan 5 days somewhere warm in Europe under £1500",
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

    const events = await readSSE(response);
    const names = events.map((e) => e.name);

    // The routing decision must arrive before any agent, so the UI can show it.
    assert.ok(
      names.indexOf("plan") < names.indexOf("agent"),
      "the route is published before any agent starts",
    );
    assert.equal(names.at(-1), "done");
    assert.deepEqual(
      names.filter((n) => n === "agent").length,
      3,
      "one event per agent that ran",
    );

    const plan = events.find((e) => e.name === "plan")!.data as { route: string[] };
    assert.deepEqual(plan.route, ["destination", "itinerary", "budget"]);

    const done = events.at(-1)!.data as { runId: string; answer: string };
    assert.ok(done.runId);
    assert.match(done.answer, /Lisbon/);
  });
});

test("the answer arrives as token events before done, and matches it", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "roughly what does a week in Rome cost?" }),
    });

    const events = await readSSE(response);
    const names = events.map((e) => e.name);
    const tokens = events.filter((e) => e.name === "token");

    assert.ok(tokens.length > 1, "the answer must arrive in pieces, not one lump");
    assert.ok(
      names.indexOf("token") < names.indexOf("done"),
      "prose must reach the client before the run finishes",
    );

    // What was streamed has to be the answer itself — a stream that drifts from
    // the stored answer would show the reader something that was never saved.
    const streamed = tokens.map((e) => String(e.data.text)).join("");
    const { answer } = events.at(-1)!.data as { answer: string };
    assert.equal(streamed, answer);
  });
});

test("a cost-only request streams exactly one agent event", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "roughly what does a week in Rome cost?" }),
    });

    const events = await readSSE(response);
    assert.equal(events.filter((e) => e.name === "agent").length, 1);
  });
});

test("the run and its agent rows are persisted and readable", async () => {
  await withServer(async (base) => {
    const planResponse = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: "plan 5 days somewhere warm in Europe under £1500",
      }),
    });

    const events = await readSSE(planResponse);
    const { runId } = events.at(-1)!.data as { runId: string };

    const stored = await fetch(`${base}/api/plan/${runId}`);
    assert.equal(stored.status, 200);

    const run = (await stored.json()) as {
      request: string;
      route: string;
      agents: {
        agent: string;
        model: string;
        ok: number;
        output: string | null;
      }[];
    };

    assert.match(run.request, /somewhere warm/);
    assert.deepEqual(JSON.parse(run.route), [
      "destination",
      "itinerary",
      "budget",
    ]);
    const specialists = run.agents;

    // One audit row per agent, recording which model served it.
    assert.equal(specialists.length, 3);
    assert.ok(specialists.every((a) => a.model === "stub" && a.ok === 1));

    // Each agent's own output is stored, not just the final prose — otherwise a
    // run cannot be inspected after the fact.
    assert.ok(
      specialists.every((a) => a.output && a.output !== "null"),
      "every agent row must carry its output",
    );

    const budgetRow = run.agents.find((a) => a.agent === "budget");
    const budget = JSON.parse(budgetRow!.output!) as { total: number };
    assert.equal(budget.total, 1200);
  });
});

test("an unknown run id is a 404, not a 500", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/plan/does-not-exist`);
    assert.equal(response.status, 404);
  });
});

test("an empty request is rejected with 400", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "   " }),
    });

    assert.equal(response.status, 400);
  });
});

test("a short or nonsense message gets the form, not a validation error", async () => {
  await withServer(async (base) => {
    // Typing "?" used to surface a raw zod message in the chat. There is nothing
    // to plan from, so the right reply is the same one any vague request gets.
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "?" }),
    });

    assert.equal(response.status, 200);

    const events = await readSSE(response);
    const done = events.at(-1)!.data as { needs: { id: string }[] };

    assert.ok(done.needs.length > 0, "it should ask rather than fail");
    assert.equal(
      events.filter((e) => e.name === "agent").length,
      0,
      "and spend no model calls doing it",
    );
  });
});

test("the admin role sees guard counts and the user role does not", async () => {
  await withServer(async (base) => {
    const asUser = await (await fetch(`${base}/api/runs`)).json() as {
      role: string;
      runs: Record<string, unknown>[];
    };
    const asAdmin = await (
      await fetch(`${base}/api/runs`, { headers: { "x-user-role": "admin" } })
    ).json() as { role: string; runs: Record<string, unknown>[] };

    assert.equal(asUser.role, "user");
    assert.equal(asAdmin.role, "admin");

    if (asAdmin.runs[0]) {
      assert.ok("guards_fired" in asAdmin.runs[0]);
      assert.ok(!("guards_fired" in (asUser.runs[0] ?? {})));
    }
  });
});
