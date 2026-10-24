// Connection to the local router (native messaging host).

const HOST = "com.lumen.router";

const listeners = {}; // message type -> [fn]
const requests = new Map(); // chat request id -> handlers
let port = null;
let reconnecting = false; // the router restarts itself after a settings change

export function on(type, fn) {
  (listeners[type] ??= []).push(fn);
}

function emit(type, msg) {
  for (const fn of listeners[type] || []) fn(msg);
}

export function connected() {
  return !!port;
}

export function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    emit("down", { error: e.message });
    return;
  }
  port.onMessage.addListener((msg) => {
    if (msg.type === "keySaved" || msg.type === "connected") {
      reconnecting = true; // the router exits next; reconnect quietly
      return;
    }
    const r = msg.id && requests.get(msg.id);
    if (r) {
      if (msg.type === "tool_call") {
        // The model wants to browse: run the tool here and send the result back.
        Promise.resolve(r.tool ? r.tool(msg.name, msg.input) : { content: "Browsing is off.", isError: true })
          .then((res) => port?.postMessage({ type: "tool_result", id: msg.id, callId: msg.callId, ...res }));
        return;
      }
      if (msg.type === "tool_activity") {
        r.activity?.(msg); // progress from tools the router runs itself (video transcripts)
        return;
      }
      if (msg.type === "delta") r.delta(msg.text);
      else if (msg.type === "session") r.session?.(msg.value);
      else if (msg.type === "done" || msg.type === "error") {
        requests.delete(msg.id);
        msg.type === "done" ? r.done() : r.error(msg.message);
      }
      return;
    }
    emit(msg.type, msg);
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "Host disconnected.";
    port = null;
    for (const r of requests.values()) r.error(error);
    requests.clear();
    if (reconnecting) {
      reconnecting = false;
      connect();
      return;
    }
    emit("down", { error });
  });
  port.postMessage({ type: "hello" });
}

export function post(msg) {
  if (!port) connect();
  port?.postMessage(msg);
  return !!port;
}

// Start a chat request; returns a cancel function.
export function chat(request, handlers) {
  const id = crypto.randomUUID();
  requests.set(id, handlers);
  if (!post({ type: "chat", id, ...request })) {
    requests.delete(id);
    handlers.error("The local router isn't running.");
  }
  return () => {
    if (!requests.delete(id)) return;
    port?.postMessage({ type: "cancel", id });
  };
}
