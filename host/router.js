#!/usr/bin/env node
// Native messaging host: the extension talks to this over stdin/stdout,
// and this routes each chat to a provider (an API, or a signed-in CLI).
//
// Wire format (Chrome native messaging): 4-byte little-endian length + UTF-8 JSON.

const providers = require("./providers");
const config = require("./config");

const running = new Map(); // request id -> cancel()

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
    const cancel = provider.chat(msg, {
      delta: (text) => send({ type: "delta", id: msg.id, text }),
      done: () => {
        running.delete(msg.id);
        send({ type: "done", id: msg.id });
      },
      error: (message) => {
        running.delete(msg.id);
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
