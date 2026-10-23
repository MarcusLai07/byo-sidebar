// Gemini via the Gemini CLI, using your Google sign-in (run `gemini` once to log in).
// Runs in "plan" (read-only) approval mode in an empty folder.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { exists, runJsonl } = require("./cli");
const { SYSTEM_PROMPT } = require("./prompt");

const BIN = process.env.BYO_GEMINI_BIN || "gemini";

module.exports = {
  id: "gemini-cli",
  label: "Gemini (Google login)",
  login: { name: "Gemini CLI", install: "npm i -g @google/gemini-cli", signIn: "gemini (then choose Login with Google)" },

  isInstalled: () => exists(BIN),

  // The Gemini CLI has no status command; read the files its Google sign-in writes.
  async account() {
    const dir = path.join(os.homedir(), ".gemini");
    try {
      const { active } = JSON.parse(fs.readFileSync(path.join(dir, "google_accounts.json"), "utf8"));
      if (active) return active;
    } catch {}
    return fs.existsSync(path.join(dir, "oauth_creds.json")) ? "Signed in with Google" : null;
  },

  models: async () => [
    { id: "default", label: "Gemini CLI default model" },
    { id: "pro", label: "Gemini Pro" },
    { id: "flash", label: "Gemini Flash" },
  ],

  chat({ model, sessionId, resume, prompt }, callbacks) {
    const args = [
      "--output-format", "stream-json",
      "--approval-mode", "plan",
      "--skip-trust",
      ...(model && model !== "default" ? ["-m", model] : []),
      ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
      // The prompt comes in on stdin; -p "" just switches on headless mode.
      "-p", "",
    ];
    const input = resume ? prompt : `${SYSTEM_PROMPT}\n\n${prompt}`;

    return runJsonl(BIN, args, { stdin: input }, (ev, { delta, done, error }) => {
      if (ev.type === "message" && ev.role === "assistant" && ev.content) delta(ev.content);
      if (ev.type === "result") {
        if (ev.status === "error") error(ev.error?.message || "Gemini returned an error.");
        else done();
      }
    }, callbacks);
  },
};
