import { useEffect, useRef, useState } from "react";
import { fetchRun, streamPlan } from "./lib/api.js";
import type { AgentName, Constraints, PlanResult, Trace } from "./lib/types.js";
import { AgentActivity } from "./components/AgentActivity.js";
import { Answer } from "./components/Answer.js";
import { Sidebar } from "./components/Sidebar.js";

const EXAMPLES = [
  "A five day trip somewhere warm in Europe for under £1500",
  "Plan 4 days in Lisbon for 2 people",
  "Roughly what does a week in Rome cost?",
  "Where should I go for a warm February break?",
];

const FOLLOW_UPS = [
  "Make it cheaper",
  "Add a day trip",
  "Swap a day for something quieter",
];

/** How many earlier messages a follow-up carries. Enough context, bounded cost. */
const CONTEXT_TURNS = 6;

/** One exchange: what was asked, and everything the run streamed back for it. */
interface Turn {
  id: string;
  question: string;
  constraints: Constraints | null;
  route: AgentName[];
  trace: Trace[];
  /** The answer as it arrives, before `done` delivers the authoritative copy. */
  streamed: string;
  result: PlanResult | null;
  error: string | null;
  running: boolean;
}

export default function App() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [menu, setMenu] = useState(false);

  // index.html stamps the starting choice before first paint — read it rather
  // than guess, or a dark-mode reader gets a white flash on every load.
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme ?? "light",
  );

  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  // Minted by the server on the first turn and echoed back after, so every run
  // in this chat is stored against one conversation instead of standing alone.
  const conversation = useRef<string | undefined>(undefined);

  // Every token is a new render, so this keeps the newest prose in view as it is
  // written — the same reason a chat scrolls itself.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  async function submit(text: string) {
    const question = text.trim();
    if (!question || running) return;

    const id = crypto.randomUUID();
    const history = turns.map((t) => t.question).slice(-CONTEXT_TURNS);

    setDraft("");
    setMenu(false);
    setRunning(true);
    setTurns((prev) => [
      ...prev,
      {
        id,
        question,
        constraints: null,
        route: [],
        trace: [],
        streamed: "",
        result: null,
        error: null,
        running: true,
      },
    ]);

    const patch = (change: (turn: Turn) => Partial<Turn>) =>
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...change(t) } : t)),
      );

    const controller = new AbortController();
    abort.current = controller;

    try {
      for await (const event of streamPlan(
        question,
        history,
        conversation.current,
        controller.signal,
      )) {
        switch (event.type) {
          case "plan":
            patch(() => ({
              constraints: event.constraints,
              route: event.route,
            }));
            break;
          case "agent":
            patch((t) => ({ trace: [...t.trace, event.trace] }));
            break;
          case "token":
            patch((t) => ({ streamed: t.streamed + event.text }));
            break;
          case "done":
            conversation.current = event.result.conversationId;
            patch(() => ({ result: event.result }));
            break;
          case "error":
            patch(() => ({ error: event.message }));
            break;
        }
      }
    } catch (err) {
      // An abort is the user's own doing — whatever streamed already stands.
      if (!controller.signal.aborted) {
        patch(() => ({
          error: err instanceof Error ? err.message : "Something went wrong.",
        }));
      }
    } finally {
      patch(() => ({ running: false }));
      setRunning(false);
      abort.current = null;
    }
  }

  /** Opening a past trip replaces the thread, the way switching chats does. */
  async function openRun(runId: string) {
    if (running) return;
    setMenu(false);

    try {
      const { question, constraints, result } = await fetchRun(runId);
      setTurns([
        {
          id: result.runId,
          question,
          constraints,
          route: result.route,
          trace: result.trace,
          streamed: "",
          result,
          error: null,
          running: false,
        },
      ]);
    } catch (err) {
      setTurns([
        {
          id: runId,
          question: "that trip",
          constraints: null,
          route: [],
          trace: [],
          streamed: "",
          result: null,
          error: err instanceof Error ? err.message : "Could not open that trip.",
          running: false,
        },
      ]);
    }
  }

  const last = turns.at(-1);
  const canFollowUp = Boolean(last && !last.running && !last.error);
  const finished = turns.filter((t) => t.result).length;

  return (
    <div className={`shell${menu ? " shell--menu" : ""}`}>
      <Sidebar
        activeId={last?.result?.runId}
        reload={finished}
        onOpen={(id) => void openRun(id)}
        onNew={() => {
          setTurns([]);
          setMenu(false);
        }}
      />

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="ghost menu"
            onClick={() => setMenu(!menu)}
            aria-label="Past trips"
          >
            ☰
          </button>

          <div className="topbar__title">
            <strong>{last ? last.question : "New trip"}</strong>
            <span className="muted tiny">
              Three specialised agents. An orchestrator picks the ones your request
              needs.
            </span>
          </div>

          <button
            type="button"
            className="ghost themetoggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
            aria-label="Toggle dark mode"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>

          <span className={`status${running ? " status--busy" : ""}`}>
            <i aria-hidden="true" />
            {running ? "planning" : "online"}
          </span>
        </header>

        <main className="thread">
          {turns.length === 0 && (
            <section className="hero">
              <h1>Where are we going?</h1>
              <p className="muted">
                Tell me how long, who is coming and what you want to spend. I will
                put the agents to work and show their thinking as it happens.
              </p>
              <div className="suggestions">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="chip"
                    onClick={() => void submit(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </section>
          )}

          {turns.map((turn) => (
            <div key={turn.id} className="exchange">
              <article className="msg msg--me">
                <div className="bubble">{turn.question}</div>
              </article>

              <article className="msg msg--bot">
                <span className="avatar" aria-hidden="true">
                  ✈
                </span>
                <div className="bubble">
                  <AgentActivity
                    constraints={turn.constraints}
                    route={turn.route}
                    trace={turn.trace}
                    running={turn.running}
                  />

                  {turn.error && <p className="error">{turn.error}</p>}

                  {(turn.result ?? turn.streamed) && (
                    <Answer
                      result={turn.result}
                      markdown={turn.result?.answer ?? turn.streamed}
                      streaming={turn.running}
                    />
                  )}

                  {turn.running && !turn.streamed && !turn.error && (
                    <span className="dots" aria-label="working">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </div>
              </article>
            </div>
          ))}

          {canFollowUp && (
            <div className="suggestions suggestions--inline">
              {FOLLOW_UPS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="chip"
                  onClick={() => void submit(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          )}

          <div ref={end} />
        </main>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(draft);
          }}
        >
          <div className="composer__box">
            <textarea
              value={draft}
              rows={1}
              placeholder="Ask for a trip, or change the one above…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter is a new line — chat convention.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit(draft);
                }
              }}
            />

            {running ? (
              <button
                type="button"
                className="round"
                onClick={() => abort.current?.abort()}
                title="Stop"
              >
                ■
              </button>
            ) : (
              <button
                type="submit"
                className="round"
                disabled={!draft.trim()}
                title="Send"
              >
                ↑
              </button>
            )}
          </div>
          <p className="muted tiny composer__note">
            Enter to send · Shift+Enter for a new line
          </p>
        </form>
      </div>
    </div>
  );
}
