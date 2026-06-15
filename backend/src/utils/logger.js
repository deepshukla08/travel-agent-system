const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
};

function ts() {
  return new Date().toISOString().substring(11, 19);
}

function divider(char = "─", width = 70) {
  return char.repeat(width);
}

function prettyJSON(obj, indent = 2) {
  return JSON.stringify(obj, null, indent);
}

function truncate(str, max = 800) {
  if (!str) return "(empty)";
  const s = typeof str === "string" ? str : JSON.stringify(str);
  if (s.length <= max) return s;
  return (
    s.slice(0, max) +
    `\n  ${C.dim}... (${s.length - max} more chars truncated)${C.reset}`
  );
}

export const logger = {
  // ── Basic ──────────────────────────────────────────────────────────
  info(msg) {
    console.log(`${C.cyan}[${ts()}] INFO${C.reset}  ${msg}`);
  },
  success(msg) {
    console.log(`${C.green}[${ts()}] OK${C.reset}    ${msg}`);
  },
  warn(msg) {
    console.warn(`${C.yellow}[${ts()}] WARN${C.reset}  ${msg}`);
  },
  error(msg) {
    console.error(`${C.red}[${ts()}] ERROR${C.reset} ${msg}`);
  },
  debug(msg) {
    if (process.env.DEBUG === "true") {
      console.log(`${C.gray}[${ts()}] DEBUG${C.reset} ${msg}`);
    }
  },

  // ── Graph ──────────────────────────────────────────────────────────
  graphStart(userRequest) {
    console.log(
      `\n${C.bold}${C.bgBlue}${C.white}  TRAVEL AGENT GRAPH STARTED  ${C.reset}`,
    );
    console.log(`${C.blue}${divider()}${C.reset}`);
    console.log(`${C.bold}${C.blue}  User Request:${C.reset} ${userRequest}`);
    console.log(`${C.blue}${divider()}${C.reset}\n`);
  },

  graphEnd(durationMs) {
    console.log(`\n${C.blue}${divider()}${C.reset}`);
    console.log(
      `${C.bold}${C.green}  GRAPH COMPLETE${C.reset}  ${C.dim}(${(durationMs / 1000).toFixed(1)}s total)${C.reset}`,
    );
    console.log(`${C.blue}${divider()}${C.reset}\n`);
  },

  // ── Agent banner ───────────────────────────────────────────────────
  agentStart(name, model, provider, temperature) {
    const num =
      {
        "Preference Agent": "1/6",
        "Destination Research Agent": "2/6",
        "Budget Agent": "3/6",
        "Itinerary Agent": "4/6",
        "Logistics Agent": "5/6",
        "Final Planner Agent": "6/6",
      }[name] || "?/6";
    console.log(
      `\n${C.bold}${C.bgMagenta}${C.white}  [${num}] ${name.toUpperCase()}  ${C.reset}`,
    );
    console.log(`${C.magenta}${divider()}${C.reset}`);
    console.log(
      `${C.bold}${C.magenta}  Model:${C.reset} ${C.yellow}${model}${C.reset}  ${C.dim}(${provider}, temp=${temperature})${C.reset}`,
    );
  },

  agentEnd(name, durationMs) {
    console.log(
      `${C.green}  ✓ ${name} finished${C.reset} ${C.dim}(${(durationMs / 1000).toFixed(1)}s)${C.reset}`,
    );
    console.log(`${C.magenta}${divider()}${C.reset}\n`);
  },

  // ── Context passed into agent ───────────────────────────────────────
  context(_label, _data) {},

  // ── Prompt sent to LLM ─────────────────────────────────────────────
  prompt(_text) {},

  // ── LLM call ───────────────────────────────────────────────────────
  llmCall(_model, _provider) {},

  // ── LLM raw response ───────────────────────────────────────────────
  llmResponse(_text) {},

  // ── State update / output ──────────────────────────────────────────
  stateUpdate(stateKey, data) {
    console.log(
      `${C.bold}${C.green}  ▶ STATE UPDATE → ${C.reset}${C.bold}"${stateKey}"${C.reset}`,
    );
    console.log(`${C.green}  ${divider("·", 66)}${C.reset}`);
    const lines = truncate(prettyJSON(data), 600).split("\n");
    lines.forEach((l) => console.log(`  ${C.green}${l}${C.reset}`));
    console.log();
  },

  // ── Tool call ──────────────────────────────────────────────────────
  toolCall(_toolName, _input) {},

  toolResult(_toolName, _result) {},
};
