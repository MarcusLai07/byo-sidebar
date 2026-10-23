// Claude via the Claude Code CLI, using whatever account `claude` is signed in with.
// No API key needed. Runs with every tool disabled, so it can only chat.

const { exists, runJsonl } = require("./cli");
const { SYSTEM_PROMPT } = require("./prompt");

const BIN = process.env.BYO_CLAUDE_BIN || "claude";

module.exports = {
  id: "claude-cli",
  label: "Claude (Claude Code login)",

  isAvailable: () => exists(BIN),

  models: async () => [
    { id: "opus", label: "Claude Opus" },
    { id: "sonnet", label: "Claude Sonnet" },
    { id: "haiku", label: "Claude Haiku" },
  ],

  chat({ model, sessionId, resume, prompt }, callbacks) {
    const args = [
      "-p",
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

    return runJsonl(BIN, args, { stdin: prompt }, (ev, { delta, done, error }) => {
      const d = ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta;
      if (d?.type === "text_delta") delta(d.text);
      if (ev.type === "result") {
        if (ev.is_error) error(ev.result || "Claude returned an error.");
        else done();
      }
    }, callbacks);
  },
};
