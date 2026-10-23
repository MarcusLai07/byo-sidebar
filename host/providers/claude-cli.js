// Claude via the Claude Code CLI, using whatever account `claude` is signed in with.
// No API key needed. Runs with every tool disabled, so it can only chat.

const { exists, output, runJsonl } = require("./cli");
const { SYSTEM_PROMPT } = require("./prompt");
const { anthropicContent, withTranscript } = require("./http");

const BIN = process.env.BYO_CLAUDE_BIN || "claude";

module.exports = {
  id: "claude-cli",
  label: "Claude (Claude Code login)",
  login: { name: "Claude Code", install: "Install Claude Code from claude.com/claude-code", signIn: "claude auth login" },

  isInstalled: () => exists(BIN),

  async account() {
    const { ok, stdout } = await output(BIN, ["auth", "status"]);
    if (!ok) return null;
    try {
      const s = JSON.parse(stdout);
      if (!s.loggedIn) return null;
      return [s.email, s.subscriptionType && `Claude ${s.subscriptionType}`].filter(Boolean).join(" · ") || "Signed in";
    } catch {
      return null;
    }
  },

  models: async () => [
    { id: "opus", label: "Claude Opus" },
    { id: "sonnet", label: "Claude Sonnet" },
    { id: "haiku", label: "Claude Haiku" },
  ],

  chat(req, callbacks) {
    const { model, sessionId, resume } = req;
    const args = [
      "-p",
      // stream-json input lets us send images and PDFs as content blocks.
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--tools", "",
      "--setting-sources", "",
      "--strict-mcp-config",
      "--system-prompt", SYSTEM_PROMPT,
      "--model", model,
      ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
    ];
    const content = anthropicContent({ ...req, prompt: withTranscript(req) });
    const stdin = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";

    return runJsonl(BIN, args, { stdin }, (ev, { delta, done, error }) => {
      const d = ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta;
      if (d?.type === "text_delta") delta(d.text);
      if (ev.type === "result") {
        if (ev.is_error) error(ev.result || "Claude returned an error.");
        else done();
      }
    }, callbacks);
  },
};
