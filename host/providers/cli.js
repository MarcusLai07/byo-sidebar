// Shared runner for login-mode providers: spawn a CLI that prints JSONL events,
// hand each event to the provider, and turn exits and crashes into errors.

const { spawn, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// An empty working directory, so no project instructions or settings get picked up.
const CWD = path.join(os.tmpdir(), "byo-sidebar");
fs.mkdirSync(CWD, { recursive: true });

function exists(bin, args = ["--version"]) {
  return new Promise((resolve) => execFile(bin, args, { cwd: CWD }, (err) => resolve(!err)));
}

// onEvent(ev, { delta, done, error }) handles one parsed JSONL line.
function runJsonl(bin, args, { stdin, env }, onEvent, { delta, done, error }) {
  const child = spawn(bin, args, { cwd: CWD, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let finished = false;
  let stderr = "";
  let lineBuf = "";

  const cb = {
    delta: (t) => !finished && delta(t),
    done: () => !finished && ((finished = true), done()),
    error: (m) => !finished && ((finished = true), error(m)),
  };

  child.stdout.on("data", (chunk) => {
    lineBuf += chunk;
    let nl;
    while ((nl = lineBuf.indexOf("\n")) >= 0) {
      const line = lineBuf.slice(0, nl).trim();
      lineBuf = lineBuf.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      try {
        onEvent(JSON.parse(line), cb);
      } catch {
        // not JSON (log noise); skip
      }
    }
  });

  child.stderr.on("data", (c) => (stderr += c));
  child.on("error", (e) => cb.error(`Couldn't start ${path.basename(bin)}: ${e.message}`));
  child.on("close", (code) => {
    if (code === 0) cb.done();
    else cb.error(stderr.trim().split("\n").filter(Boolean).pop() || `${path.basename(bin)} exited with code ${code}`);
  });

  child.stdin.end(stdin ?? "");

  return () => {
    finished = true;
    child.kill("SIGTERM");
  };
}

module.exports = { CWD, exists, runJsonl };
