#!/usr/bin/env node
// Minimal MCP server (stdio, newline-delimited JSON-RPC) that gives a CLI like
// Claude Code the sidebar's read-only browsing tools. Each call is forwarded over
// the router's Unix socket (BYO_BRIDGE) to the panel, which runs it in the browser.

const net = require("net");
const { pick } = require("./tools");

const TOOLS = pick(process.env.BYO_TOOLS ? process.env.BYO_TOOLS.split(",") : null);

const REQUEST = process.env.BYO_REQUEST;
const sock = net.connect(process.env.BYO_BRIDGE);
const waiting = new Map(); // callId -> resolve

let sockBuf = "";
sock.on("data", (chunk) => {
  sockBuf += chunk;
  let nl;
  while ((nl = sockBuf.indexOf("\n")) >= 0) {
    const msg = JSON.parse(sockBuf.slice(0, nl));
    sockBuf = sockBuf.slice(nl + 1);
    waiting.get(msg.callId)?.(msg);
    waiting.delete(msg.callId);
  }
});
sock.on("error", () => {});

function callTool(name, input) {
  const callId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    waiting.set(callId, resolve);
    sock.write(JSON.stringify({ request: REQUEST, callId, name, input }) + "\n");
  });
}

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const fail = (id, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message } }) + "\n");

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "byo-sidebar-browse", version: "1.0.0" },
    });
  }
  if (method === "tools/list") {
    return reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) });
  }
  if (method === "tools/call") {
    const r = await callTool(params.name, params.arguments || {});
    return reply(id, { content: [{ type: "text", text: r.content }], isError: !!r.isError });
  }
  if (method === "ping") return reply(id, {});
  if (id !== undefined) fail(id, `Unknown method ${method}`); // notifications need no reply
}

let inBuf = "";
process.stdin.on("data", (chunk) => {
  inBuf += chunk;
  let nl;
  while ((nl = inBuf.indexOf("\n")) >= 0) {
    const line = inBuf.slice(0, nl).trim();
    inBuf = inBuf.slice(nl + 1);
    if (line) handle(JSON.parse(line)).catch((e) => console.error(e));
  }
});
process.stdin.on("end", () => process.exit(0));
