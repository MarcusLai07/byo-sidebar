// OpenAI via the Codex CLI, using your ChatGPT sign-in (`codex login`).
// Runs in a read-only sandbox in an empty folder, without your Codex config or MCP servers.
// Codex's JSON output delivers each reply whole, so it appears at once rather than streaming.

const fs = require("fs");
const path = require("path");
const { CWD, exists, output, runJsonl } = require("./cli");
const { withTranscript } = require("./http");
const { SYSTEM_PROMPT } = require("./prompt");

const BIN = process.env.LUMEN_CODEX_BIN || "codex";

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

  // Codex picks its own thread id; it comes back via callbacks.session() and the panel
  // stores it with the chat, so a later turn (even after a restart) can resume it.
  chat(req, callbacks) {
    const { model, resume, cliSession, attachments = [] } = req;
    if (attachments.some((a) => a.kind !== "image")) {
      callbacks.error("Codex login can only take images. Use an OpenAI API key for PDFs.");
      return () => {};
    }
    const images = attachments.map((a, i) => {
      const file = path.join(CWD, `codex-${Date.now()}-${i}.${(a.mime.split("/")[1] || "png").replace("jpeg", "jpg")}`);
      fs.writeFileSync(file, Buffer.from(a.data, "base64"));
      return file;
    });

    const thread = resume && cliSession;
    const common = [
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      ...(model && model !== "default" ? ["-m", model] : []),
      ...images.flatMap((f) => ["-i", f]),
    ];
    // `codex exec resume` doesn't take --sandbox; the resumed thread keeps its original policy.
    const args = thread ? ["exec", "resume", ...common, thread, "-"] : ["exec", ...common, "-s", "read-only", "-"];
    const input = thread ? req.prompt : `${SYSTEM_PROMPT}\n\n${withTranscript(req)}`;
    const cleanup = () => images.forEach((f) => fs.rm(f, () => {}));

    const cancel = runJsonl(BIN, args, { stdin: input }, (ev, { delta, error }) => {
      if (ev.type === "thread.started") callbacks.session?.(ev.thread_id);
      if (ev.type === "item.completed" && ev.item?.type === "agent_message") delta(ev.item.text);
      if (ev.type === "turn.failed") error(ev.error?.message || "Codex turn failed.");
    }, { ...callbacks, done: () => (cleanup(), callbacks.done()), error: (m) => (cleanup(), callbacks.error(m)) });
    return () => (cleanup(), cancel());
  },
};
