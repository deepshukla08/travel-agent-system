import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { Trace } from "../graph/state.js";
import type { Constraints } from "../schemas/index.js";

/**
 * The audit trail: one row per run, one row per agent invocation.
 *
 * `guards_fired` is the column that makes this an audit of AI behaviour rather
 * than a log of HTTP requests — it records where the model was overruled.
 *
 * ponytail: SQLite on local disk. On a free host the filesystem is ephemeral, so
 * history resets on redeploy. Upgrade path is Postgres/Azure SQL with the same
 * two tables — the schema does not change, only the driver.
 */
mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id            TEXT PRIMARY KEY,
    request       TEXT NOT NULL,
    constraints   TEXT NOT NULL,   -- parsed constraints, JSON
    route         TEXT NOT NULL,   -- agents chosen, JSON array, in order
    answer        TEXT,
    total_ms      INTEGER NOT NULL,
    guards_fired  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     TEXT NOT NULL REFERENCES runs(id),
    agent      TEXT NOT NULL,
    model      TEXT NOT NULL,      -- which model actually served the call
    ms         INTEGER NOT NULL,
    ok         INTEGER NOT NULL,
    guards     TEXT NOT NULL,      -- JSON array of guard messages
    output     TEXT,               -- this agent's own result, JSON
    error      TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agent_runs_run ON agent_runs(run_id);
  CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
`);

// Forward migration for databases created before `output` existed. Cheaper than
// a migration tool for one column, and CREATE TABLE IF NOT EXISTS won't add it.
const columns = db.prepare(`PRAGMA table_info(agent_runs)`).all() as {
  name: string;
}[];
if (!columns.some((c) => c.name === "output")) {
  db.exec(`ALTER TABLE agent_runs ADD COLUMN output TEXT`);
}

const insertRun = db.prepare(`
  INSERT INTO runs (id, request, constraints, route, answer, total_ms, guards_fired, created_at)
  VALUES (@id, @request, @constraints, @route, @answer, @total_ms, @guards_fired, @created_at)
`);

const insertAgentRun = db.prepare(`
  INSERT INTO agent_runs (run_id, agent, model, ms, ok, guards, output, error, created_at)
  VALUES (@run_id, @agent, @model, @ms, @ok, @guards, @output, @error, @created_at)
`);

export interface SaveRun {
  request: string;
  constraints: Constraints | null;
  route: string[];
  answer: string;
  totalMs: number;
  trace: Trace[];
  /**
   * Each agent's own result, keyed by agent name. Stored per agent row rather
   * than on the run, so a partial run keeps whatever did succeed.
   */
  outputs: Partial<Record<string, unknown>>;
}

/** Written in one transaction so a run and its agents can never disagree. */
export const saveRun = db.transaction((run: SaveRun): string => {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  insertRun.run({
    id,
    request: run.request,
    constraints: JSON.stringify(run.constraints),
    route: JSON.stringify(run.route),
    answer: run.answer,
    total_ms: run.totalMs,
    guards_fired: run.trace.reduce((n, t) => n + t.guards.length, 0),
    created_at: createdAt,
  });

  for (const t of run.trace) {
    const output = run.outputs[t.agent];
    insertAgentRun.run({
      run_id: id,
      agent: t.agent,
      model: t.model,
      ms: t.ms,
      ok: t.ok ? 1 : 0,
      guards: JSON.stringify(t.guards),
      output: output === undefined ? null : JSON.stringify(output),
      error: t.error ?? null,
      created_at: createdAt,
    });
  }

  return id;
});

export function getRun(id: string) {
  const run = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id);
  if (!run) return null;

  const agents = db
    .prepare(`SELECT * FROM agent_runs WHERE run_id = ? ORDER BY id`)
    .all(id);

  return { ...(run as object), agents };
}

export type RunRow = Record<string, unknown>;

export function listRuns(limit = 50): RunRow[] {
  return db
    .prepare(
      `SELECT id, request, route, total_ms, guards_fired, created_at
       FROM runs ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as RunRow[];
}
