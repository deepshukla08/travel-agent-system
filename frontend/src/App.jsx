import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ChatMessage from "./components/ChatMessage";
import TypingIndicator from "./components/TypingIndicator";
import {
  startPlan,
  sendFollowUp,
  sendClarification,
  getSessions,
  getSessionMessages,
} from "./api";
import "./App.css";

/**
 * Parse the clarification message (produced by clarificationChecker.js) into
 * an array of { label, placeholder } objects — one per question line.
 * Falls back to a single free-text entry if the format doesn't match.
 */
function parseQuestions(message) {
  // Each question line starts with an emoji + bold label, e.g.:
  // "🗺️  **Where** would you like to travel? ..."
  const lines = message
    .split("\n")
    .filter((l) => l.trim().startsWith("**") || /^\p{Emoji}/u.test(l.trim()));
  if (!lines.length)
    return [{ label: "Your answer", placeholder: "Type your answer here..." }];

  return lines.map((line) => {
    // Strip markdown bold markers for a clean label
    const clean = line
      .replace(/\*\*/g, "")
      .replace(/^\p{Emoji}+\s*/u, "")
      .trim();
    const [label, ...rest] = clean.split("?");
    return {
      label: (label + "?").trim(),
      placeholder:
        rest
          .join("?")
          .replace(/^\s*\(/, "")
          .replace(/\)\s*$/, "")
          .trim() || "Your answer",
    };
  });
}

/** Inline clarification form — one labelled input per question */
function ClarificationForm({ questions, onSubmit, loading }) {
  const [answers, setAnswers] = useState(() => questions.map(() => ""));

  function setAnswer(i, val) {
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? val : a)));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const combined = questions
      .map((q, i) => `${q.label} ${answers[i].trim()}`)
      .filter((_, i) => answers[i].trim())
      .join(" | ");
    if (!combined) return;
    onSubmit(combined);
  }

  const allFilled = answers.some((a) => a.trim());

  return (
    <form className="clarification-form" onSubmit={handleSubmit}>
      <p className="clarification-form__title">
        Please fill in the details below:
      </p>
      {questions.map((q, i) => (
        <div className="clarification-form__field" key={i}>
          <label className="clarification-form__label">{q.label}</label>
          <input
            className="clarification-form__input"
            type="text"
            placeholder={q.placeholder}
            value={answers[i]}
            onChange={(e) => setAnswer(i, e.target.value)}
            disabled={loading}
            autoFocus={i === 0}
          />
        </div>
      ))}
      <button
        className="btn btn--primary clarification-form__btn"
        type="submit"
        disabled={loading || !allFilled}
      >
        {loading ? "Planning your trip..." : "Build My Travel Plan 🚀"}
      </button>
    </form>
  );
}

const AGENT_META = {
  "Preference Agent": {
    icon: "🧠",
    action: "Extracting your travel preferences...",
  },
  "Destination Research Agent": {
    icon: "🌍",
    action: "Researching destinations & local insights...",
  },
  "Budget Agent": {
    icon: "💰",
    action: "Calculating budget breakdown & costs...",
  },
  "Itinerary Agent": {
    icon: "🗓️",
    action: "Building your day-by-day itinerary...",
  },
  "Logistics Agent": {
    icon: "✈️",
    action: "Planning flights, hotels & transport...",
  },
  "Final Planner Agent": {
    icon: "📝",
    action: "Writing your complete travel plan...",
  },
};

/** Compact summary of tool arguments for display */
function formatArgs(args) {
  if (!args || typeof args !== "object") return "";
  const vals = Object.values(args);
  if (!vals.length) return "";
  return (
    String(vals[0]).slice(0, 90) +
    (vals.length > 1 || String(vals[0]).length > 90 ? "…" : "")
  );
}

const TOOL_ICONS = {
  web_search: "🔍",
  get_exchange_rate: "💱",
  get_current_date: "📅",
  get_trip_dates: "🗓️",
};

/**
 * Live activity feed shown while the graph is running.
 * Each agent gets its own row: icon + name + action description + status.
 */
function AgentActivityFeed({ steps, statusMessage }) {
  if (!steps.length && !statusMessage) return null;
  const total = 6;
  const doneCount = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="agent-feed">
      <div className="agent-feed__bar">
        <div className="agent-feed__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {statusMessage && (
        <div className="agent-feed__status-msg">{statusMessage}</div>
      )}
      <div className="agent-feed__rows">
        {steps.map((s, idx) => {
          const meta = AGENT_META[s.agent] ?? { icon: "⚙️", action: s.agent };
          const modelTag =
            !s.done && s.model ? `${s.model} · ${s.provider}` : null;
          return (
            <div key={idx}>
              <div className={`agent-feed__row ${s.done ? "done" : "active"}`}>
                <span className="agent-feed__icon">{meta.icon}</span>
                <div className="agent-feed__info">
                  <span className="agent-feed__name">{s.agent}</span>
                  <span className="agent-feed__action">
                    {s.done
                      ? `Done in ${(s.elapsed / 1000).toFixed(1)}s`
                      : meta.action}
                  </span>
                  {modelTag && (
                    <span className="agent-feed__model">{modelTag}</span>
                  )}
                </div>
                <span className="agent-feed__status">
                  {s.done ? (
                    <span className="agent-feed__check">✓</span>
                  ) : (
                    <span className="agent-feed__spinner" />
                  )}
                </span>
              </div>
              {(s.toolCalls ?? []).map((tc, ti) => (
                <div
                  key={ti}
                  className={`agent-feed__tool-row ${tc.done ? "done" : "active"}`}
                >
                  <span className="agent-feed__tool-icon">
                    {TOOL_ICONS[tc.tool] ?? "🔧"}
                  </span>
                  <div className="agent-feed__tool-info">
                    <span className="agent-feed__tool-name">{tc.tool}</span>
                    <span className="agent-feed__tool-detail">
                      {tc.done
                        ? String(tc.result ?? "").slice(0, 120) +
                          (String(tc.result ?? "").length > 120 ? "…" : "")
                        : formatArgs(tc.args)}
                    </span>
                  </div>
                  <span className="agent-feed__status">
                    {tc.done ? (
                      <span className="agent-feed__check">✓</span>
                    ) : (
                      <span className="agent-feed__spinner" />
                    )}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sidebar({ sessions, activeId, onNew, loading }) {
  const navigate = useNavigate();
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__logo">✈️</span>
        <span className="sidebar__brand">Travel AI</span>
      </div>
      <button className="sidebar__new-btn" onClick={onNew} disabled={loading}>
        + New Trip
      </button>
      <nav className="sidebar__list">
        {sessions.length === 0 && (
          <p className="sidebar__empty">No saved trips yet.</p>
        )}
        {sessions.map((s) => (
          <button
            key={s._id}
            className={`sidebar__item ${s._id === activeId ? "active" : ""}`}
            onClick={() => navigate(`/chat/${s._id}`)}
          >
            <span className="sidebar__item-title">{s.title}</span>
            <span className="sidebar__item-date">
              {(() => {
                const d = new Date(s.updatedAt ?? s.createdAt);
                return isNaN(d) ? "" : d.toLocaleDateString();
              })()}
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export default function App() {
  const { sessionId: urlSessionId } = useParams();
  const navigate = useNavigate();

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hi! I'm your AI Travel Agent. Tell me where you'd like to go and I'll build a full travel plan for you.\n\nExample: *\"Plan a 5-day budget trip to Dubai for a couple.\"*",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [awaitingClarification, setAwaitingClarification] = useState(false);
  const [clarificationQuestions, setClarificationQuestions] = useState([]);
  const [error, setError] = useState(null);
  const [agentSteps, setAgentSteps] = useState([]);
  const [statusMessage, setStatusMessage] = useState(null);
  const [sessions, setSessions] = useState([]);
  const bottomRef = useRef(null);

  // Load sidebar session list
  const refreshSessions = useCallback(async () => {
    try {
      const list = await getSessions();
      setSessions(list);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // When URL changes to a known session, load its messages
  useEffect(() => {
    if (!urlSessionId) {
      setSessionId(null);
      setMessages([
        {
          role: "assistant",
          content:
            "Hi! I'm your AI Travel Agent. Tell me where you'd like to go and I'll build a full travel plan for you.\n\nExample: *\"Plan a 5-day budget trip to Dubai for a couple.\"*",
        },
      ]);
      setAwaitingClarification(false);
      setClarificationQuestions([]);
      setAgentSteps([]);
      setStatusMessage(null);
      return;
    }
    if (urlSessionId === sessionId) return; // already loaded

    setSessionId(urlSessionId);
    setLoading(true);
    getSessionMessages(urlSessionId)
      .then((msgs) => {
        if (!msgs?.length) {
          setMessages([
            {
              role: "assistant",
              content: "Session loaded. Ask a follow-up to continue.",
            },
          ]);
        } else {
          setMessages(msgs);
        }
        setAwaitingClarification(false);
        setClarificationQuestions([]);
        setAgentSteps([]);
        setStatusMessage(null);
      })
      .catch(() => {
        setMessages([
          {
            role: "assistant",
            content: "Could not load this session.",
          },
        ]);
      })
      .finally(() => setLoading(false));
  }, [urlSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleProgress({ type, data }) {
    if (type === "start") {
      setStatusMessage(data.message ?? null);
    } else if (type === "agent_start") {
      setAgentSteps((prev) => {
        // If this agent is already in the list (e.g. Preference Agent re-runs
        // after HITL resume), reset it in-place instead of adding a duplicate.
        const exists = prev.some((s) => s.agent === data.agent);
        if (exists) {
          return prev.map((s) =>
            s.agent === data.agent
              ? {
                  ...s,
                  done: false,
                  startedAt: Date.now(),
                  elapsed: 0,
                  model: data.model ?? s.model,
                  provider: data.provider ?? s.provider,
                  toolCalls: [],
                }
              : s,
          );
        }
        return [
          ...prev,
          {
            agent: data.agent,
            step: data.step,
            total: data.total,
            done: false,
            startedAt: Date.now(),
            elapsed: 0,
            model: data.model ?? null,
            provider: data.provider ?? null,
            toolCalls: [],
          },
        ];
      });
    } else if (type === "agent_done") {
      setAgentSteps((prev) =>
        prev.map((s) =>
          s.agent === data.agent
            ? { ...s, done: true, elapsed: Date.now() - s.startedAt }
            : s,
        ),
      );
    } else if (type === "tool_start") {
      setAgentSteps((prev) =>
        prev.map((s) =>
          s.agent === data.agent
            ? {
                ...s,
                toolCalls: [
                  ...(s.toolCalls ?? []),
                  {
                    tool: data.tool,
                    args: data.args,
                    result: null,
                    done: false,
                    startedAt: Date.now(),
                    elapsed: 0,
                  },
                ],
              }
            : s,
        ),
      );
    } else if (type === "tool_result") {
      setAgentSteps((prev) =>
        prev.map((s) => {
          if (s.agent !== data.agent) return s;
          // Mark the last matching pending tool call as done
          let marked = false;
          const toolCalls = [...(s.toolCalls ?? [])]
            .reverse()
            .map((tc) => {
              if (!marked && tc.tool === data.tool && !tc.done) {
                marked = true;
                return {
                  ...tc,
                  done: true,
                  result: data.result,
                  elapsed: Date.now() - tc.startedAt,
                };
              }
              return tc;
            })
            .reverse();
          return { ...s, toolCalls };
        }),
      );
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    setAgentSteps([]);
    setStatusMessage(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      let result;
      if (!sessionId) {
        result = await startPlan(text, handleProgress);
        const newId = result.sessionId;
        setSessionId(newId);
        navigate(`/chat/${newId}`, { replace: true });
        refreshSessions();
      } else {
        result = await sendFollowUp(sessionId, text, handleProgress);
        refreshSessions();
      }

      // The backend needs more info — show the per-question clarification form
      if (result.needsClarification) {
        const newId = result.sessionId ?? sessionId;
        setSessionId(newId);
        if (newId && newId !== urlSessionId)
          navigate(`/chat/${newId}`, { replace: true });
        setAwaitingClarification(true);
        setClarificationQuestions(parseQuestions(result.message));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.message },
        ]);
        setLoading(false);
        setAgentSteps([]);
        setStatusMessage(null);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.finalPlan },
      ]);
    } catch (err) {
      const msg = err.message || "Something went wrong.";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I ran into an error: **${msg}**`,
        },
      ]);
    } finally {
      setLoading(false);
      setAgentSteps([]);
      setStatusMessage(null);
    }
  }

  async function handleClarificationSubmit(combinedAnswer) {
    setError(null);
    setAgentSteps([]);
    setStatusMessage(null);
    setMessages((prev) => [...prev, { role: "user", content: combinedAnswer }]);
    setAwaitingClarification(false);
    setClarificationQuestions([]);
    setLoading(true);

    try {
      const result = await sendClarification(
        sessionId,
        combinedAnswer,
        handleProgress,
      );

      if (result.needsClarification) {
        setAwaitingClarification(true);
        setClarificationQuestions(parseQuestions(result.message));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.message },
        ]);
        setLoading(false);
        setAgentSteps([]);
        setStatusMessage(null);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.finalPlan },
      ]);
    } catch (err) {
      const msg = err.message || "Something went wrong.";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I ran into an error: **${msg}**`,
        },
      ]);
    } finally {
      setLoading(false);
      setAgentSteps([]);
      setStatusMessage(null);
    }
  }

  function handleNewChat() {
    navigate("/");
  }

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        activeId={urlSessionId ?? null}
        onNew={handleNewChat}
        loading={loading}
      />

      <div className="app__main">
        <header className="header">
          <div className="header__left">
            <div>
              <h1 className="header__title">Travel Agent AI</h1>
              <p className="header__subtitle">
                Powered by LangGraph multi-agent system
              </p>
            </div>
          </div>
        </header>

        <main className="chat">
          <div className="chat__messages">
            {messages.map((msg, i) => (
              <ChatMessage key={i} role={msg.role} content={msg.content} />
            ))}
            <div ref={bottomRef} />
          </div>

          {loading && (agentSteps.length > 0 || statusMessage) && (
            <AgentActivityFeed
              steps={agentSteps}
              statusMessage={statusMessage}
            />
          )}
          {loading && agentSteps.length === 0 && !statusMessage && (
            <TypingIndicator />
          )}

          {awaitingClarification && clarificationQuestions.length > 0 ? (
            <ClarificationForm
              questions={clarificationQuestions}
              onSubmit={handleClarificationSubmit}
              loading={loading}
            />
          ) : (
            <form className="chat__form" onSubmit={handleSubmit}>
              <input
                className="chat__input"
                type="text"
                placeholder={
                  sessionId
                    ? "Ask a follow-up, e.g. 'Make it luxury instead'..."
                    : "E.g. Plan a 5-day budget trip to Tokyo for 2 people..."
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
              />
              <button
                className="btn btn--primary"
                type="submit"
                disabled={loading || !input.trim()}
              >
                {loading ? "Planning..." : "Send"}
              </button>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
