#!/usr/bin/env node
// Talks to the router exactly like the browser does, so you can test without loading the extension.
// Usage: node host/test-host.js "your question" [provider] [model]
// Asks the question, then a follow-up, to check the conversation carries over.

const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");

const question = process.argv[2] || "Remember the number 42. Reply with just OK.";
const provider = process.argv[3] || "claude-cli";
const model = process.argv[4] || "haiku";
const sessionId = crypto.randomUUID();
let turn = 0;
const host = spawn(path.join(__dirname, "byo-sidebar-host"), [], { stdio: ["pipe", "pipe", "inherit"] });

function post(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  host.stdin.write(Buffer.concat([header, body]));
}

let buf = Buffer.alloc(0);
host.stdout.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
    const len = buf.readUInt32LE(0);
    const msg = JSON.parse(buf.subarray(4, 4 + len));
    buf = buf.subarray(4 + len);
    if (msg.type === "hello") {
      for (const p of msg.providers) {
        console.log(`provider ${p.id}: ${p.error ? "ERROR " + p.error : p.models.map((m) => m.id).slice(0, 8).join(", ")}`);
      }
      console.log("keys:", JSON.stringify(msg.keys));
      console.log(`\n> ${question}`);
      post({ type: "chat", id: "t1", provider, model, sessionId, resume: false, prompt: question });
    } else if (msg.type === "delta") {
      process.stdout.write(msg.text);
    } else {
      console.log(`\n[${msg.type}]${msg.message ? " " + msg.message : ""}`);
      if (msg.type === "done" && turn++ === 0) {
        const followUp = "What number did I ask you to remember? Reply with just the number.";
        console.log(`\n> ${followUp}`);
        post({ type: "chat", id: "t2", provider, model, sessionId, resume: true, prompt: followUp });
      } else {
        host.stdin.end();
      }
    }
  }
});

post({ type: "hello" });
