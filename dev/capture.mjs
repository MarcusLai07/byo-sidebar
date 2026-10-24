// Records the README screenshots and demo video from the panel harness, in headless Chrome.
//   CHROME=/path/to/chrome-headless-shell node dev/capture.mjs
// (get one with: npx @puppeteer/browsers install chrome-headless-shell@stable)
// Writes docs/media/*.png, docs/media/demo.mp4 and docs/media/demo.gif (needs ffmpeg).
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const root = path.join(import.meta.dirname, "..");
const out = path.join(root, "docs/media");
const frames = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-frames-"));
fs.mkdirSync(out, { recursive: true });
const W = 420, H = 760, PORT = 5318, DBG = 9333;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(root, "dev/serve.js"), String(PORT)], { stdio: "ignore" });
const chrome = spawn(process.env.CHROME, [`--remote-debugging-port=${DBG}`, "--hide-scrollbars", "--force-color-profile=srgb", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
process.on("exit", () => { server.kill(); chrome.kill(); });

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await wait(200);
  targets = await fetch(`http://127.0.0.1:${DBG}/json`).then((r) => r.json()).catch(() => null);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const handlers = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else handlers[m.method]?.(m.params);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.THEME || "dark" }] });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/extension/sidepanel.html?harness&demo` });
await wait(1500);

// Headless has no cursor: draw one so the video shows where clicks land.
const CURSOR = `(() => {
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;z-index:2147483647;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 6px rgba(0,0,0,.5);pointer-events:none;opacity:0;transition:transform .12s,opacity .3s";
  document.documentElement.append(c);
  addEventListener("mousemove", (e) => { c.style.opacity = 1; c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => (c.style.transform = "scale(.7)"), true);
  addEventListener("mouseup", () => (c.style.transform = ""), true);
  window.__cursor = c;
})()`;

let mouse = { x: W / 2, y: H - 120 };
async function moveTo(x, y, ms = 450) {
  const steps = Math.max(8, Math.round(ms / 16));
  const from = { ...mouse };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    mouse = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...mouse });
    await wait(16);
  }
}
async function click(selector, ms) {
  const r = await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!r) throw new Error(`no ${selector}`);
  await moveTo(r.x, r.y, ms);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...mouse, button: "left", clickCount: 1 });
  await wait(70);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse, button: "left", clickCount: 1 });
}
async function type(text, cps = 22) {
  for (const ch of text) {
    await send("Input.insertText", { text: ch });
    await wait(1000 / cps);
  }
}
async function key(k, code = k) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: k === "Enter" ? 13 : 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: k === "Enter" ? 13 : 27 });
}
async function shot(name) {
  const hide = await js(`(window.__cursor.style.visibility = "hidden", true)`);
  await wait(60);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(data, "base64"));
  if (hide) await js(`window.__cursor.style.visibility = ""`);
  console.log("saved", name);
}

// ---------- screencast ----------
const shots = [];
handlers["Page.screencastFrame"] = ({ data, metadata, sessionId }) => {
  const f = path.join(frames, `${String(shots.length).padStart(5, "0")}.jpg`);
  fs.writeFileSync(f, Buffer.from(data, "base64"));
  shots.push({ f, t: metadata.timestamp });
  send("Page.screencastFrameAck", { sessionId });
};
const record = () => send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * 2, maxHeight: H * 2 });
const stop = () => send("Page.stopScreencast");

// Reload so the intro animation is in the recording.
await record();
await send("Page.reload");
await wait(1200);
await js(CURSOR);
await wait(1200);
await shot("home");

// 1. Ask about the page; the reply streams in with clickable timestamps.
await click("#input");
await type("What songs are in this set?");
await wait(300);
await key("Enter");
await wait(2600);
await shot("chat");

// 2. The ⚡ menu: instant actions, tools and AI skills.
await click("#skills-btn");
await wait(900);
await shot("menu");
for (const n of [2, 3]) {
  await click(`.menu-tab:nth-of-type(${n})`, 300);
  await wait(900);
  if (n === 3) await shot("skills");
}
await click(".menu-tab:nth-of-type(1)", 300);
await wait(700);
await key("Escape", "Escape");
await wait(500);

// 3. Pick a model.
await click("#model-btn");
await wait(900);
await shot("models");
await key("Escape", "Escape");
await wait(400);

// 4. Extensions manager.
await click("#ext-btn");
await wait(1200);
await shot("extensions");
await click("#ext-btn");
await wait(800);
await stop();
await wait(200);

// ---------- video ----------
const list = shots.map((s, i) => `file '${s.f}'\nduration ${((shots[i + 1]?.t ?? s.t + 0.1) - s.t).toFixed(3)}`).join("\n") + `\nfile '${shots.at(-1).f}'`;
fs.writeFileSync(path.join(frames, "list.txt"), list);
const ff = (...a) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: "inherit" });
const vf = `scale=${W * 2}:-2:flags=lanczos,fps=30`;
ff("-f", "concat", "-safe", "0", "-i", path.join(frames, "list.txt"), "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-movflags", "+faststart", path.join(out, "demo.mp4"));
ff("-i", path.join(out, "demo.mp4"), "-vf", `fps=15,scale=${W}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, path.join(out, "demo.gif"));
fs.rmSync(frames, { recursive: true, force: true });
console.log("saved demo.mp4, demo.gif");
process.exit(0);
