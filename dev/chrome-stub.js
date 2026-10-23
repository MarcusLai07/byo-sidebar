// Stand-in for the extension APIs so the real side panel runs in a normal page.
// Loaded by dev/serve.js into /extension/sidepanel.html?harness. Records what the
// panel sends to the "router" in window.__sent, and streams canned replies.
(() => {
  const listeners = () => {
    const fns = [];
    return {
      addListener: (f) => fns.push(f),
      removeListener: (f) => fns.splice(fns.indexOf(f) >>> 0, 1),
      fire: (...a) => [...fns].forEach((f) => f(...a)),
    };
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

  let pendingTool = null;
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
        } else if (msg.type === "tool_result") {
          window.__toolResults = (window.__toolResults || []).concat(msg);
          pendingTool?.(msg);
        } else if (msg.type === "chat" && msg.browse && /tracklist/i.test(msg.prompt)) {
          // Fake a browsing round: list tabs, then open an unseen link (needs approval), then answer.
          (async () => {
            const call = (name, input) => new Promise((res) => {
              pendingTool = res;
              send({ type: "tool_call", id: msg.id, callId: Math.random().toString(36).slice(2), name, input });
            });
            await call("list_tabs", {});
            const opened = await call("open_url", { url: "https://www.1001tracklists.com/tracklist/abc" });
            const text = `Found it (${opened.isError ? "not opened" : "opened"}). 0:11 Voodoo, 3:55 Under Control.`;
            send({ type: "delta", id: msg.id, text });
            send({ type: "done", id: msg.id });
          })();
        } else if (msg.type === "chat" && msg.browse && /transcribe/i.test(msg.prompt)) {
          // Fake router-side tool progress (video_transcript).
          const act = (status, label, note, delay) => setTimeout(() => onMessage.fire({ type: "tool_activity", id: msg.id, activityId: "a1", status, label, note }), delay);
          act("running", "Downloading the audio", "40%", 10);
          act("running", "Transcribing with whisper.cpp", "75%", 60);
          act("done", undefined, undefined, 110);
          setTimeout(() => onMessage.fire({ type: "delta", id: msg.id, text: "0:14 the elephants." }), 140);
          setTimeout(() => onMessage.fire({ type: "done", id: msg.id }), 160);
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
      create: async (o) => {
        window.__created = o;
        const tab = { id: 50, windowId: 1, active: false, title: "Tracklist – 1001Tracklists", url: o.url, favIconUrl: "" };
        tabs.push(tab);
        setTimeout(() => chrome.tabs.onUpdated.fire(tab.id, { status: "complete" }, tab), 30);
        return tab;
      },
      remove: async (id) => {
        const i = tabs.findIndex((t) => t.id === id);
        if (i >= 0) tabs.splice(i, 1);
        window.__removed = id;
      },
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
          if (target.tabId === 50) return Promise.resolve([{ frameId: 0, result: { selection: "", text: "1001Tracklists: 0:11 Voodoo; 3:55 Under Control", duration: null } }]);
          const text = target.tabId === 1 ? "Martin Garrix B2B Alesso live at Ultra. Comments: 0:11 Voodoo, 3:55 Under Control" : "Release notes: version 2 ships Friday.";
          return Promise.resolve([{ frameId: 0, result: { selection: window.__selection || "", text, duration: target.tabId === 1 ? 4445 : null } }]);
        }
        if (func.name === "mediaScript") {
          const icon = `${location.origin}/extension/icons/icon-128.png`;
          return Promise.resolve([
            { frameId: 0, result: { streamed: true, items: [
              { type: "image", url: icon, w: 128, h: 128, alt: "Logo" },
              { type: "image", url: `${icon}?big`, w: 1920, h: 1080, alt: "Hero" },
              { type: "video", url: "https://example.com/clip.mp4", w: 1280, h: 720, poster: icon, duration: 42 },
              { type: "image", url: "https://blocked.example/x.jpg", w: 800, h: 600, alt: "Blocked" },
            ] } },
          ]);
        }
        if (func.name === "linksScript") return Promise.resolve([{ frameId: 0, result: [["Full tracklist", "https://1001.tl/xyz"]] }]);
        if (func.name === "seekScript") {
          window.__seek = { tabId: target.tabId, seconds: args[0] };
          return Promise.resolve([{ frameId: 0, result: true }]);
        }
        return Promise.resolve([{ frameId: 0, result: null }]);
      },
    },
    downloads: {
      download: async (o) => (window.__downloads = (window.__downloads || []).concat(o)),
      search: async () => [{ id: 7, filename: "/Users/me/Downloads/logo.png", finalUrl: `${location.origin}/extension/icons/icon-128.png`, mime: "image/png", fileSize: 4200, startTime: new Date().toISOString(), exists: true }],
      open: () => {},
    },
  };
})();
