// Stand-in for the extension APIs so the real side panel runs in a normal page.
// Loaded by dev/serve.js into /extension/sidepanel.html?harness. Records what the
// panel sends to the "router" in window.__sent, and streams canned replies.
(() => {
  const listeners = () => {
    const fns = [];
    return { addListener: (f) => fns.push(f), fire: (...a) => fns.forEach((f) => f(...a)) };
  };

  const tabs = [
    { id: 1, windowId: 1, active: true, audible: false, groupId: 9, title: "Martin Garrix B2B Alesso – YouTube", url: "https://www.youtube.com/watch?v=abc", favIconUrl: "", mutedInfo: { muted: false } },
    { id: 2, windowId: 1, active: false, groupId: 9, title: "Release notes – Docs", url: "https://docs.example.com/notes", favIconUrl: "" },
    { id: 3, windowId: 1, active: false, groupId: -1, title: "Q3 report.pdf", url: "http://localhost/report.pdf", favIconUrl: "" },
  ];

  const store = (area) => {
    const data = {};
    const changed = listeners();
    return {
      data,
      onChanged: changed,
      get: async (k) => (typeof k === "string" ? (k in data ? { [k]: data[k] } : {}) : { ...data }),
      set: async (o) => {
        const changes = {};
        for (const [k, v] of Object.entries(o)) {
          changes[k] = { oldValue: data[k], newValue: v };
          data[k] = v;
        }
        changed.fire(changes, area);
      },
      remove: async (k) => {
        delete data[k];
      },
    };
  };

  window.__sent = [];
  let reply = "Here are the songs:\n\n| Time | Track |\n|---|---|\n| 0:11 | Martin Garrix – **Voodoo** |\n| 3:55 | Alesso – Under Control |\n| 1:02:03 | Closing ID |\n\nThe drop at 10:03 is the highlight.";
  window.__setReply = (r) => (reply = r);

  function fakePort() {
    const onMessage = listeners();
    const onDisconnect = listeners();
    const send = (m) => setTimeout(() => onMessage.fire(m), 5);
    return {
      onMessage,
      onDisconnect,
      postMessage(msg) {
        window.__sent.push(JSON.parse(JSON.stringify(msg)));
        if (msg.type === "hello") {
          send({
            type: "hello",
            providers: [
              { id: "claude-cli", label: "Claude (Claude Code login)", models: [{ id: "opus", label: "Claude Opus" }, { id: "haiku", label: "Claude Haiku" }] },
              { id: "anthropic-api", label: "Claude (API key)", models: [{ id: "claude-x", label: "Claude X" }] },
            ],
            keys: { anthropic: true, openai: false, gemini: false, deepseek: false },
            logins: [
              { id: "claude-cli", name: "Claude Code", installed: true, account: "me@example.com · Claude max", connected: true, install: "", signIn: "claude auth login" },
              { id: "codex-cli", name: "Codex (ChatGPT)", installed: false, account: null, connected: false, install: "npm i -g @openai/codex", signIn: "codex login" },
            ],
          });
        } else if (msg.type === "chat") {
          const chunks = reply.match(/[\s\S]{1,12}/g);
          chunks.forEach((c, i) => setTimeout(() => onMessage.fire({ type: "delta", id: msg.id, text: c }), 10 + i * 8));
          setTimeout(() => onMessage.fire({ type: "done", id: msg.id }), 30 + chunks.length * 8);
        }
      },
    };
  }

  const session = store("session");
  window.chrome = {
    runtime: {
      connectNative: () => fakePort(),
      getManifest: () => ({ version: "0.2.0-harness" }),
      getURL: (p) => `/extension/${p}`,
      lastError: null,
    },
    storage: { local: store("local"), session },
    tabs: {
      query: async (q) => {
        if (q.url) return [];
        if (q.audible) return [];
        if (q.groupId != null) return tabs.filter((t) => t.groupId === q.groupId);
        if (q.active) return tabs.filter((t) => t.active);
        return tabs;
      },
      get: async (id) => tabs.find((t) => t.id === id) || Promise.reject(new Error("no tab")),
      update: async (id, u) => Object.assign(tabs.find((t) => t.id === id) || {}, u),
      create: async (o) => (window.__created = o),
      captureVisibleTab: async () => "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
      onActivated: listeners(),
      onUpdated: listeners(),
      onRemoved: listeners(),
    },
    tabGroups: { query: async () => [{ id: 9, title: "Research", windowId: 1 }] },
    windows: { update: async () => {}, WINDOW_ID_CURRENT: -2 },
    scripting: {
      executeScript: ({ target, func, args = [] }) => {
        if (args.some((a) => a === undefined)) throw new TypeError("Error at parameter 'injection': Value is unserializable.");
        window.__injected = (window.__injected || []).concat({ tabId: target.tabId, fn: func.name });
        if (target.tabId === 3) return Promise.reject(new Error("Cannot access contents of the page"));
        if (func.name === "pageScript") {
          const text = target.tabId === 1 ? "Martin Garrix B2B Alesso live at Ultra. Comments: 0:11 Voodoo, 3:55 Under Control" : "Release notes: version 2 ships Friday.";
          return Promise.resolve([{ frameId: 0, result: { selection: window.__selection || "", text, duration: target.tabId === 1 ? 4445 : null } }]);
        }
        if (func.name === "seekScript") {
          window.__seek = { tabId: target.tabId, seconds: args[0] };
          return Promise.resolve([{ frameId: 0, result: true }]);
        }
        return Promise.resolve([{ frameId: 0, result: null }]);
      },
    },
    downloads: {
      search: async () => [{ id: 7, filename: "/Users/me/Downloads/logo.png", finalUrl: `${location.origin}/extension/icons/icon-128.png`, mime: "image/png", fileSize: 4200, startTime: new Date().toISOString(), exists: true }],
      open: () => {},
    },
  };
})();
