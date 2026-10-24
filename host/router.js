#!/usr/bin/env node
// Native messaging host: the extension talks to this over stdin/stdout,
// and this routes each chat to a provider (an API, or a signed-in CLI).
//
// Wire format (Chrome native messaging): 4-byte little-endian length + UTF-8 JSON.

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const providers = require("./providers");
const config = require("./config");
const video = require("./video");
const { TOOLS, isLocal } = require("./providers/tools");

const running = new Map(); // request id -> cancel()
const toolRunners = new Map(); // request id -> (name, input) => Promise<{ content, isError }>
const pendingTools = new Map(); // call id -> resolve
const TOOL_TIMEOUT_MS = 5 * 60 * 1000; // opening an unseen link waits for the user's approval

// stdout carries the protocol, so diagnostics go to stderr (the launcher appends it to a log file).
const log = (...args) => console.error(new Date().toISOString(), ...args);
log(`router started (pid ${process.pid}, node ${process.version})`);
process.on("uncaughtException", (e) => {
  log("crash:", e.stack || e);
  process.exit(1);
});

function send(msg, then) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]), then);
}

// Video tools run here; everything else is relayed to the panel. Local tools report
// progress as activity rows in the reply.
async function runLocalTool(requestId, name, input) {
  const activityId = Math.random().toString(36).slice(2);
  const progress = (label, note) => send({ type: "tool_activity", id: requestId, activityId, label, note, status: "running" });
  try {
    const content = name === "video_transcript" ? await video.transcript(input.url, progress, input.offset) : await video.geminiWatch(input.url, input.question, progress);
    send({ type: "tool_activity", id: requestId, activityId, status: "done" });
    return { content, isError: false };
  } catch (e) {
    send({ type: "tool_activity", id: requestId, activityId, status: "failed", note: e.message.slice(0, 120) });
    return { content: e.message, isError: true };
  }
}

// Which tools this chat gets: browser tools always, video tools when they can work.
async function toolNamesFor() {
  const v = await video.available();
  return TOOLS.filter((t) => !t.local || (t.name === "video_transcript" ? v.ytdlp : v.gemini)).map((t) => t.name);
}

// Ask the panel to run a browsing tool; resolves with its result.
function runTool(requestId, name, input) {
  if (isLocal(name)) return runLocalTool(requestId, name, input);
  const callId = `${requestId}:${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingTools.delete(callId);
      resolve({ content: "The browser didn't answer in time.", isError: true });
    }, TOOL_TIMEOUT_MS);
    pendingTools.set(callId, (result) => {
      clearTimeout(timer);
      pendingTools.delete(callId);
      resolve(result);
    });
    send({ type: "tool_call", id: requestId, callId, name, input });
  });
}

// CLIs reach the tools through a small MCP server (providers/mcp-browse.js) that they
// spawn; it connects back here over a Unix socket, one JSON object per line.
const BRIDGE = path.join(os.tmpdir(), `lumen-${process.pid}.sock`);
try {
  fs.rmSync(BRIDGE, { force: true });
} catch {}
net
  .createServer((sock) => {
    let buf = "";
    sock.on("data", async (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let req;
        try {
          req = JSON.parse(line);
        } catch {
          continue;
        }
        const run = toolRunners.get(req.request);
        const result = run ? await run(req.name, req.input || {}) : { content: "This chat has ended.", isError: true };
        sock.write(JSON.stringify({ callId: req.callId, ...result }) + "\n");
      }
    });
    sock.on("error", () => {});
  })
  .listen(BRIDGE, () => fs.chmodSync(BRIDGE, 0o600));
process.env.LUMEN_BRIDGE = BRIDGE;
process.on("exit", () => fs.rmSync(BRIDGE, { force: true }));

async function handle(msg) {
  if (msg.type === "hello") {
    send({
      type: "hello",
      providers: await providers.available(),
      keys: config.keyStatus(providers.keyNames()),
      logins: await providers.logins(),
    });
    return;
  }

  if (msg.type === "connect") {
    if (!providers.isLogin(msg.provider)) return;
    config.setConnected(msg.provider, !!msg.on);
    log(`${msg.on ? "connected" : "disconnected"} ${msg.provider}`);
    send({ type: "connected", provider: msg.provider, on: !!msg.on }, () => process.exit(0));
    return;
  }

  if (msg.type === "setKey") {
    if (!providers.keyNames().includes(msg.name)) return;
    config.setKey(msg.name, msg.value?.trim());
    // Model lists are cached per process; a key change needs a fresh router.
    send({ type: "keySaved", name: msg.name }, () => process.exit(0));
    return;
  }

  if (msg.type === "cancel") {
    running.get(msg.id)?.();
    running.delete(msg.id);
    toolRunners.delete(msg.id);
    return;
  }

  if (msg.type === "tool_result") {
    pendingTools.get(msg.callId)?.({ content: String(msg.content ?? ""), isError: !!msg.isError });
    return;
  }

  if (msg.type === "chat") {
    const provider = providers.get(msg.provider);
    if (!provider) {
      send({ type: "error", id: msg.id, message: `Unknown provider: ${msg.provider}` });
      return;
    }
    if (provider.login && !config.isConnected(provider.id)) {
      send({ type: "error", id: msg.id, message: `${provider.login.name} isn't connected. Connect it from Keys.` });
      return;
    }
    const tool = msg.browse ? (name, input) => runTool(msg.id, name, input) : null;
    if (tool) toolRunners.set(msg.id, tool);
    const toolNames = tool ? await toolNamesFor() : null;
    const cancel = provider.chat(msg, {
      tool,
      toolNames,
      delta: (text) => send({ type: "delta", id: msg.id, text }),
      // Providers that pick their own session id (Codex) report it so the panel can store it.
      session: (value) => send({ type: "session", id: msg.id, value }),
      done: () => {
        running.delete(msg.id);
        toolRunners.delete(msg.id);
        send({ type: "done", id: msg.id });
      },
      error: (message) => {
        running.delete(msg.id);
        toolRunners.delete(msg.id);
        send({ type: "error", id: msg.id, message });
      },
    });
    running.set(msg.id, cancel);
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const msg = JSON.parse(buffer.subarray(4, 4 + len).toString("utf8"));
    buffer = buffer.subarray(4 + len);
    handle(msg).catch((e) => send({ type: "error", id: msg.id, message: e.message }));
  }
});

// The browser closes stdin when the panel goes away; stop any in-flight replies.
process.stdin.on("end", () => {
  for (const cancel of running.values()) cancel();
  process.exit(0);
});
