// OpenAI via the Codex CLI, using your ChatGPT sign-in (`codex login`).
// Runs in a read-only sandbox in an empty folder, without your Codex config or MCP servers.
// Codex's JSON output delivers each reply whole, so it appears at once rather than streaming.

const { exists, output, runJsonl } = require("./cli");
const { SYSTEM_PROMPT } = require("./prompt");

const BIN = process.env.BYO_CODEX_BIN || "codex";

// Codex picks its own thread id, so map the panel's session id to it.
const threads = new Map();

module.exports = {
  id: "codex-cli",
  label: "OpenAI (Codex / ChatGPT login)",
  login: { name: "Codex (ChatGPT)", install: "npm i -g @openai/codex", signIn: "codex login" },

  isInstalled: () => exists(BIN),

  async account() {
    const { ok, stdout, stderr } = await output(BIN, ["login", "status"]);
    return ok ? (stdout || stderr || "Signed in").split("\n")[0] : null;
  },

  // Codex accepts any model your plan allows via -m; "default" leaves it to Codex.
  models: async () => [{ id: "default", label: "Codex default model" }],

  chat({ model, sessionId, resume, prompt }, callbacks) {
    const thread = resume && threads.get(sessionId);
    const common = [
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      ...(model && model !== "default" ? ["-m", model] : []),
    ];
    // `codex exec resume` doesn't take --sandbox; the resumed thread keeps its original policy.
    const args = thread
      ? ["exec", "resume", ...common, thread, "-"]
      : ["exec", ...common, "-s", "read-only", "-"];
    const input = thread ? prompt : `${SYSTEM_PROMPT}\n\n${prompt}`;

    return runJsonl(BIN, args, { stdin: input }, (ev, { delta, error }) => {
      if (ev.type === "thread.started") threads.set(sessionId, ev.thread_id);
      if (ev.type === "item.completed" && ev.item?.type === "agent_message") delta(ev.item.text);
      if (ev.type === "turn.failed") error(ev.error?.message || "Codex turn failed.");
    }, callbacks);
  },
};
