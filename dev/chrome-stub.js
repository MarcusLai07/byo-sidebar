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
            providers: DEMO ? [
              { id: "claude-cli", label: "Claude Code login", models: [{ id: "opus", label: "Claude Opus" }, { id: "sonnet", label: "Claude Sonnet" }, { id: "haiku", label: "Claude Haiku" }] },
              { id: "codex-cli", label: "Codex (ChatGPT login)", models: [{ id: "gpt", label: "GPT-5" }] },
              { id: "gemini-api", label: "Gemini (API key)", models: [{ id: "gemini-pro", label: "Gemini 2.5 Pro" }, { id: "gemini-flash", label: "Gemini 2.5 Flash" }] },
              { id: "deepseek-api", label: "DeepSeek (API key)", models: [{ id: "deepseek-chat", label: "DeepSeek V3" }] },
            ] : [
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

  window.__downloadItems = [{ id: 7, state: "complete", filename: "/Users/me/Downloads/logo.png", finalUrl: `${location.origin}/extension/icons/icon-128.png`, mime: "image/png", fileSize: 4200, startTime: new Date().toISOString(), exists: true }];
  // ?harness&demo: two "playing" tabs so the media strip shows up in recordings.
  const DEMO = location.search.includes("demo");
  const art = (a, b) =>
    "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>`);
  const DEMO_PLAYERS = {
    1: { title: "MARTIN GARRIX B2B ALESSO LIVE @ ULTRA 2026", artist: "Martin Garrix", artwork: art("#ff7a45", "#7c3aed"), currentTime: 1532, duration: 4445 },
    2: { title: "Die For You x Is There Someone Else", artist: "AM808", artwork: art("#f43f5e", "#f59e0b"), currentTime: 353, duration: 436 },
  };
  if (DEMO) {
    tabs[0].audible = true;
    tabs[1].audible = true;
    tabs[1].title = "Die For You x Is There Someone Else – YouTube";
    tabs[1].url = "https://www.youtube.com/watch?v=demo2";
  }
  // ?harness&tidy: a messy window for the tidy-tabs actions.
  if (location.search.includes("tidy")) {
    const extra = [
      ["Inbox (3) - Gmail", "https://mail.google.com/mail/u/0/#inbox"],
      ["Tokyo Hotels: Find Cheap Deals - Booking.com", "https://www.booking.com/city/jp/tokyo.html"],
      ["useEffect – React", "https://react.dev/reference/react/useEffect"],
      ["Standing Desks | IKEA", "https://www.ikea.com/my/en/cat/standing-desks"],
      ["Best Things to Do in Tokyo 2026 - Time Out", "https://www.timeout.com/tokyo/things-to-do"],
      ["Quick Start – React", "https://react.dev/learn"],
      ["The 3 Best Standing Desks of 2026 | Wirecutter", "https://www.nytimes.com/wirecutter/reviews/best-standing-desk/"],
      ["Quick Start – React", "https://react.dev/learn#top"],
      ["Release 2026-10-29 · Pull Request #130 · CTG-Business/o2o-platform", "https://github.com/CTG-Business/o2o-platform/pull/130"],
      ["[staging] Release · Pull Request #131 · CTG-Business/o2o-platform", "https://github.com/CTG-Business/o2o-platform/pull/131"],
    ];
    for (const [title, url] of extra) tabs.push({ id: 100 + tabs.length, windowId: 1, active: false, groupId: -1, title, url, favIconUrl: "", mutedInfo: { muted: false } });
    tabs.forEach((t) => t.groupId === 9 && (t.groupId = -1));
  }
  tabs.forEach((t, i) => (t.index = i));
  const groups = location.search.includes("tidy") ? [] : [{ id: 9, title: "Research", windowId: 1 }];
  const reindex = () => tabs.forEach((t, i) => (t.index = i));
  window.__tabs = tabs;
  window.__groups = groups;

  const session = store("session");
  const local = store("local");
  const storageChanged = listeners();
  local.onChanged.addListener((c) => storageChanged.fire(c, "local"));
  session.onChanged.addListener((c) => storageChanged.fire(c, "session"));

  // The PR list: what the background poller would store, refreshed on prs:refresh.
  const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const PRS = {
    accounts: ["marcus-work", "marcus"],
    errors: [],
    items: [
      { url: "https://github.com/acme/shop/pull/412", title: "Checkout: retry card payments once on network errors", repo: "acme/shop", number: 412, author: "jlee", draft: false, updatedAt: hoursAgo(0.3), review: "REVIEW_REQUIRED", ci: "pass", branch: "retry-payments", group: "review", account: "marcus-work" },
      { url: "https://github.com/acme/api/pull/88", title: "Rate-limit the public search endpoint", repo: "acme/api", number: 88, author: "priya", draft: false, updatedAt: hoursAgo(2), review: "REVIEW_REQUIRED", ci: "pending", branch: "search-limits", group: "review", account: "marcus-work" },
      { url: "https://github.com/acme/shop/pull/409", title: "Release 2026-10-29: package edits, stock-take recount", repo: "acme/shop", number: 409, author: "marcus-work", draft: false, updatedAt: hoursAgo(1), review: "CHANGES_REQUESTED", ci: "fail", branch: "release/2026-10-29", group: "mine", account: "marcus-work" },
      { url: "https://github.com/marcus/lumen/pull/12", title: "Media strip: LIVE button for live streams", repo: "marcus/lumen", number: 12, author: "marcus", draft: false, updatedAt: hoursAgo(26), review: "APPROVED", ci: "pass", branch: "live-button", group: "mine", account: "marcus" },
      { url: "https://github.com/marcus/pitwall/pull/5", title: "Race brief: tyre sets per driver", repo: "marcus/pitwall", number: 5, author: "marcus", draft: true, updatedAt: hoursAgo(72), review: null, ci: null, branch: "tyre-sets", group: "mine", account: "marcus" },
    ],
  };
  const DONE = [
    { url: "https://github.com/acme/api/pull/85", title: "Cache product images at the edge", repo: "acme/api", number: 85, author: "marcus-work", group: "mine", account: "marcus-work", state: "MERGED", doneAt: Date.now() - 40 * 60e3 },
    { url: "https://github.com/marcus/lumen/pull/11", title: "Try a separate settings page", repo: "marcus/lumen", number: 11, author: "marcus", group: "mine", account: "marcus", state: "CLOSED", doneAt: Date.now() - 5 * 3600e3 },
  ];
  window.__prOpened = [];
  window.chrome = {
    runtime: {
      connectNative: () => fakePort(),
      getManifest: () => ({ version: "0.2.0-harness" }),
      getURL: (p) => `/extension/${p}`,
      id: "fndhgaclkabpgpmigidbibafjaijeglj",
      lastError: null,
      sendMessage: async (msg) => {
        if (msg.type === "prs:refresh") {
          await new Promise((r) => setTimeout(r, 400));
          await local.set({ prState: { ...PRS, error: null, checkedAt: Date.now() }, ...(!("prDone" in local.data) && { prDone: DONE }) });
        }
        if (msg.type === "prs:open") window.__prOpened.push(msg.url);
        if (msg.type === "prs:read") await local.set({ prDone: msg.urls ? (local.data.prDone || []).filter((d) => !msg.urls.includes(d.url)) : [] });
        return true;
      },
    },
    storage: { local, session, onChanged: storageChanged },
    tabs: {
      query: async (q) => {
        // A PR already open (spelled differently, like a Dia live-folder tab).
        if (q.url === "https://github.com/*") return [{ id: 50, windowId: 1, url: "https://github.com/ACME/Shop/pull/412/files?w=1" }];
        if (q.url) return [];
        if (q.audible) return DEMO ? tabs.filter((t) => t.audible) : [];
        if (q.groupId != null) return tabs.filter((t) => t.groupId === q.groupId);
        if (q.windowId != null) return tabs.map((t) => ({ ...t, groupId: t.groupId ?? -1 }));
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
      remove: async (ids) => {
        for (const id of [].concat(ids)) {
          const i = tabs.findIndex((t) => t.id === id);
          if (i >= 0) tabs.splice(i, 1);
          window.__removed = id;
        }
        reindex();
      },
      // Tab groups, roughly like the browser: grouping moves tabs next to each other.
      group: async ({ tabIds, groupId, createProperties }) => {
        const id = groupId ?? 200 + groups.length;
        if (groupId == null) groups.push({ id, title: "", color: "grey", windowId: createProperties?.windowId ?? 1 });
        const moving = tabIds.map((tid) => tabs.find((t) => t.id === tid));
        for (const t of moving) tabs.splice(tabs.indexOf(t), 1);
        const last = tabs.findLastIndex((t) => t.groupId === id);
        tabs.splice(last >= 0 ? last + 1 : tabs.length, 0, ...moving.map((t) => Object.assign(t, { groupId: id })));
        reindex();
        return id;
      },
      ungroup: async (ids) => {
        for (const id of [].concat(ids)) Object.assign(tabs.find((t) => t.id === id) || {}, { groupId: -1 });
        for (let i = groups.length - 1; i >= 0; i--) if (!tabs.some((t) => t.groupId === groups[i].id)) groups.splice(i, 1);
      },
      move: async (id, { index }) => {
        const t = tabs.find((x) => x.id === id);
        tabs.splice(tabs.indexOf(t), 1);
        tabs.splice(index, 0, t);
        reindex();
      },
      captureVisibleTab: async () => "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
      onActivated: listeners(),
      onUpdated: listeners(),
      onRemoved: listeners(),
    },
    management: (() => {
      const icon = `${location.origin}/extension/icons/icon-48.png`;
      const exts = [
        { id: "fndhgaclkabpgpmigidbibafjaijeglj", name: "Lumen", version: "0.3.0", enabled: true, mayDisable: true, installType: "development", type: "extension", icons: [{ size: 48, url: icon }] },
        { id: "nordpass", name: "NordPass® Password Manager", version: "7.11.9", enabled: true, mayDisable: true, installType: "normal", type: "extension", optionsUrl: "https://example.com/options", icons: [] },
        { id: "ublock", name: "uBlock Origin Lite", version: "2026.1021", enabled: false, mayDisable: true, installType: "normal", type: "extension", icons: [] },
      ];
      return {
        getAll: async () => exts.map((e) => ({ ...e })),
        setEnabled: async (id, on) => {
          exts.find((e) => e.id === id).enabled = on;
          setTimeout(() => window.chrome.management[on ? "onEnabled" : "onDisabled"].fire({ id }), 10);
          window.__enabledCalls = (window.__enabledCalls || []).concat([[id, on]]);
        },
        uninstall: async (id) => (window.__uninstall = id),
        onInstalled: listeners(), onUninstalled: listeners(), onEnabled: listeners(), onDisabled: listeners(),
      };
    })(),
    tabGroups: {
      query: async () => groups.map((g) => ({ ...g })),
      update: async (id, o) => Object.assign(groups.find((g) => g.id === id), o),
    },
    windows: { update: async () => {}, getLastFocused: async () => ({ id: 1 }), WINDOW_ID_CURRENT: -2 },
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
        if (DEMO && func.name === "probe" && DEMO_PLAYERS[target.tabId]) {
          const p = DEMO_PLAYERS[target.tabId];
          if (target.tabId === 1) p.currentTime += 1;
          return Promise.resolve([{ frameId: 0, result: { hasElement: true, paused: target.tabId === 2, canNext: true, canPrev: true, score: 3, ...p } }]);
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
        // Anything else runs against this test page itself (outline, links, contacts…).
        try {
          return Promise.resolve(func(...args)).then((result) => [{ frameId: 0, result: result ?? null }]);
        } catch {
          return Promise.resolve([{ frameId: 0, result: null }]);
        }
      },
    },
    downloads: {
      download: async (o) => (window.__downloads = (window.__downloads || []).concat(o)),
      search: async () => window.__downloadItems,
      open: () => {},
      onCreated: listeners(),
      onChanged: listeners(),
      onErased: listeners(),
    },
  };
})();
