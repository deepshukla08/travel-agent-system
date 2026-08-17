import test from "node:test";
import assert from "node:assert/strict";
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

  if (schema === DestinationResultSchema) {
    return call({
      suggestions: [
        {
          name: "Lisbon",
          country: "Portugal",
          justification:
            "Warm in May, inside Europe, walkable, with the food markets they asked for and inside budget.",
          constraintChecks: [{ kind: "climate", passes: true, reason: "22C" }],
          estimatedTotalCost: 1200,
        },
      ],
    });
  }
  if (schema === ItineraryResultSchema) {
    return call({
      destination: "Lisbon",
      days: Array.from({ length: 5 }, (_, i) => ({
        day: i + 1,
        title: `Day ${i + 1}`,
        morning: "walk",
        afternoon: "tram",
        evening: "dinner",
        travelNotes: "all on foot",
        uncertain: false,
        uncertaintyReason: null,
      })),
    });
  }
  if (schema === BudgetResultSchema) {
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
    assert.equal(names[0], "plan");
    assert.equal(names.at(-1), "done");
    assert.deepEqual(
      names.filter((n) => n === "agent").length,
      3,
      "one event per agent that ran",
    );

    const plan = events[0]!.data as { route: string[] };
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

test("a follow-up carries the earlier turns into the routing decision", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: "make it cheaper",
        history: ["plan 5 days in Lisbon for 2 people"],
      }),
    });

    const events = await readSSE(response);
    const plan = events[0]!.data as {
      route: string[];
      constraints: { days: number; destination: string; travellers: number };
    };

    // "make it cheaper" on its own parses to nothing and would route to all three.
    // With the thread it is a cost question about a trip whose shape is known.
    assert.ok(plan.route.includes("budget"));
    assert.ok(!plan.route.includes("destination"), "the destination is settled");
    assert.equal(plan.constraints.destination, "Lisbon");
    assert.equal(plan.constraints.days, 5);
    assert.equal(plan.constraints.travellers, 2);
  });
});

test("every turn of a chat is stored against one conversation", async () => {
  await withServer(async (base) => {
    const ask = (body: Record<string, unknown>) =>
      fetch(`${base}/api/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    const first = await readSSE(await ask({ request: "plan 4 days in Lisbon" }));
    const one = first.at(-1)!.data as { runId: string; conversationId: string };
    assert.ok(one.conversationId, "the server mints an id on the first turn");

    const second = await readSSE(
      await ask({
        request: "make it cheaper",
        history: ["plan 4 days in Lisbon"],
        conversationId: one.conversationId,
      }),
    );
    const two = second.at(-1)!.data as { runId: string; conversationId: string };

    // Separate runs — each is independently auditable — but one conversation.
    assert.notEqual(two.runId, one.runId);
    assert.equal(two.conversationId, one.conversationId);

    const chat = (await (
      await fetch(`${base}/api/plan/conversation/${one.conversationId}`)
    ).json()) as { turns: { id: string; request: string }[] };

    assert.equal(chat.turns.length, 2, "both turns belong to the chat");
    // Oldest first, so the thread reads in the order it was run.
    assert.equal(chat.turns[0]!.request, "plan 4 days in Lisbon");
    assert.equal(chat.turns[1]!.request, "make it cheaper");
  });
});

test("an unknown conversation is a 404", async () => {
  await withServer(async (base) => {
    const response = await fetch(
      `${base}/api/plan/conversation/11111111-1111-1111-1111-111111111111`,
    );
    assert.equal(response.status, 404);
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
    // One audit row per agent, recording which model served it.
    assert.equal(run.agents.length, 3);
    assert.ok(run.agents.every((a) => a.model === "stub" && a.ok === 1));

    // Each agent's own output is stored, not just the final prose — otherwise a
    // run cannot be inspected after the fact.
    assert.ok(
      run.agents.every((a) => a.output && a.output !== "null"),
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

test("a too-short request is rejected with 400", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "hi" }),
    });

    assert.equal(response.status, 400);
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
