const HOST = "com.byo_sidebar.router";
const PAGE_TEXT_LIMIT = 40000;

const $ = (id) => document.getElementById(id);
const els = {
  model: $("model"),
  newChat: $("new-chat"),
  keysToggle: $("keys-toggle"),
  settings: $("settings"),
  loginStatus: $("login-status"),
  messages: $("messages"),
  empty: $("empty"),
  banner: $("banner"),
  chip: $("context-chip"),
  chipIcon: $("context-icon"),
  chipTitle: $("context-title"),
  composer: $("composer"),
  input: $("input"),
  send: $("send"),
};

const state = {
  port: null,
  providers: [],
  keys: {}, // { anthropic: true, ... } which API keys are saved
  logins: [], // login providers: installed, signed-in account, connected
  reconnecting: false, // the router restarts itself after a key change
  sessionId: null, // null until the first message of a chat
  sentPageUrl: null, // page already sent in this chat, so it isn't re-sent every turn
  includePage: true,
  pending: null, // { id, el, text }
};

// ---------- native host ----------

function connect() {
  try {
    state.port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    showBanner(setupHelp(e.message));
    return;
  }
  state.port.onMessage.addListener(onHostMessage);
  state.port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || "Host disconnected.";
    state.port = null;
    if (state.reconnecting) {
      state.reconnecting = false;
      connect();
      return;
    }
    if (state.pending) finish(state.pending, { error: err });
    showBanner(setupHelp(err));
  });
  state.port.postMessage({ type: "hello" });
}

function setupHelp(err) {
  return `Can't reach the local router: ${err}\n\nRun host/install.sh from the repo, then reload this panel.`;
}

function onHostMessage(msg) {
  if (msg.type === "hello") {
    hideBanner();
    state.providers = msg.providers;
    state.keys = msg.keys || {};
    state.logins = msg.logins || [];
    fillModels();
    renderSettings();
    if (!state.providers.length) showBanner("No models connected yet. Open Keys to connect a login or add an API key.");
    return;
  }
  if (msg.type === "keySaved" || msg.type === "connected") {
    state.reconnecting = true; // the router exits next; onDisconnect reconnects
    return;
  }
  const p = state.pending;
  if (!p || msg.id !== p.id) return;
  if (msg.type === "delta") {
    p.text += msg.text;
    p.body.innerHTML = renderMarkdown(p.text);
    scrollDown();
  } else if (msg.type === "done") {
    finish(p, {});
  } else if (msg.type === "error") {
    finish(p, { error: msg.message });
  }
}

// ---------- models ----------

function fillModels() {
  const saved = localStorage.getItem("model");
  els.model.innerHTML = "";
  for (const provider of state.providers) {
    const group = document.createElement("optgroup");
    group.label = provider.label;
    for (const m of provider.models) {
      const opt = new Option(m.label, `${provider.id}::${m.id}`);
      group.append(opt);
    }
    if (provider.error) {
      const opt = new Option(`⚠ ${provider.error.slice(0, 80)}`, "");
      opt.disabled = true;
      group.append(opt);
    }
    els.model.append(group);
  }
  if (saved && [...els.model.options].some((o) => o.value === saved)) els.model.value = saved;
}

// ---------- keys & login status ----------

function renderSettings() {
  for (const row of els.settings.querySelectorAll(".key-row")) {
    const input = row.querySelector("input");
    input.value = "";
    input.placeholder = state.keys[row.dataset.name] ? "•••••• saved" : input.dataset.placeholder;
  }

  els.loginStatus.replaceChildren(
    ...state.logins.map((l) => {
      const row = document.createElement("div");
      const live = l.connected && l.account;
      row.className = `login-row${live ? " connected" : ""}`;

      const name = document.createElement("div");
      name.className = "name";
      name.innerHTML = `<span class="dot">●</span>`;
      name.append(l.name);

      // Text built with textContent/code nodes only: account names come from local CLIs.
      const detail = document.createElement("div");
      detail.className = "detail";
      const code = (t) => Object.assign(document.createElement("code"), { textContent: t });
      if (!l.installed) detail.append("Not installed: ", code(l.install));
      else if (!l.account) detail.append("Not signed in. In Terminal run ", code(l.signIn), ", then reopen this panel.");
      else detail.append(l.connected ? `Using ${l.account}` : `Signed in as ${l.account}`);

      row.append(name, detail);

      if (l.installed && l.account) {
        const btn = document.createElement("button");
        btn.textContent = l.connected ? "Disconnect" : "Connect";
        if (!l.connected) btn.className = "primary";
        btn.addEventListener("click", () => {
          if (!state.port) return showBanner("The local router isn't connected.");
          btn.disabled = true;
          state.port.postMessage({ type: "connect", provider: l.id, on: !l.connected });
        });
        row.append(btn);
      } else if (l.connected) {
        // Connected earlier but the CLI was signed out or removed since: allow turning it off.
        const btn = document.createElement("button");
        btn.textContent = "Disconnect";
        btn.addEventListener("click", () => state.port?.postMessage({ type: "connect", provider: l.id, on: false }));
        row.append(btn);
      }
      return row;
    })
  );
}

for (const row of els.settings.querySelectorAll(".key-row")) {
  const input = row.querySelector("input");
  input.dataset.placeholder = input.placeholder;
  row.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state.port) return showBanner("The local router isn't connected.");
    state.port.postMessage({ type: "setKey", name: row.dataset.name, value: input.value });
    input.value = "";
    input.placeholder = "saving…";
  });
}

els.keysToggle.addEventListener("click", () => {
  const open = els.settings.hidden;
  els.settings.hidden = !open;
  els.messages.hidden = open;
  els.keysToggle.classList.toggle("on", open);
});

els.model.addEventListener("change", () => {
  localStorage.setItem("model", els.model.value);
  // Sessions belong to one provider, so switching models starts a fresh chat.
  if (state.sessionId) newChat();
});

// ---------- page context ----------

async function activeTab() {
  // In window mode the panel's own window is focused, so look at normal windows only.
  const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

async function refreshChip() {
  const tab = await activeTab();
  els.chipTitle.textContent = tab?.title || "No tab";
  if (tab?.favIconUrl) els.chipIcon.src = tab.favIconUrl;
  else els.chipIcon.removeAttribute("src");
  els.chip.classList.toggle("off", !state.includePage);
}

els.chip.addEventListener("click", () => {
  state.includePage = !state.includePage;
  refreshChip();
});

chrome.tabs.onActivated.addListener(refreshChip);
chrome.tabs.onUpdated.addListener((_, info) => {
  if (info.title || info.status === "complete") refreshChip();
});

async function readPage(tab) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (limit) => ({
        selection: String(getSelection() || "").trim(),
        text: (document.body?.innerText || "").slice(0, limit),
      }),
      args: [PAGE_TEXT_LIMIT],
    });
    return result;
  } catch {
    return null; // chrome:// pages, the Web Store, PDFs, etc.
  }
}

async function buildPrompt(question) {
  if (!state.includePage) return { prompt: question, tab: null };
  const tab = await activeTab();
  if (!tab) return { prompt: question, tab: null };

  const page = await readPage(tab);
  const parts = [];
  if (page && tab.url !== state.sentPageUrl) {
    parts.push(
      `<page url="${tab.url}" title="${(tab.title || "").replace(/"/g, "'")}">\n${page.text}\n</page>`
    );
    state.sentPageUrl = tab.url;
  } else if (!page) {
    parts.push(`(The user is on ${tab.url}, which can't be read by extensions.)`);
  }
  if (page?.selection) parts.push(`<selection>\n${page.selection}\n</selection>`);
  parts.push(question);
  return { prompt: parts.join("\n\n"), tab };
}

// ---------- chat ----------

function addMessage(role, html) {
  els.empty.hidden = true;
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.innerHTML = role === "user" ? `<div class="bubble"></div>` : `<div class="body"></div>`;
  els.messages.append(el);
  if (html != null) el.firstChild.innerHTML = html;
  scrollDown();
  return el;
}

async function send(question) {
  if (!state.port) {
    connect();
    if (!state.port) return;
  }
  const [providerId, modelId] = els.model.value.split("::");
  if (!providerId) return;

  const { prompt, tab } = await buildPrompt(question);

  const user = addMessage("user");
  const bubble = user.firstChild;
  if (tab) {
    const tag = document.createElement("span");
    tag.className = "attached";
    tag.textContent = `📎 ${tab.title}`;
    bubble.append(tag);
  }
  bubble.append(question);

  const resume = !!state.sessionId;
  if (!resume) state.sessionId = crypto.randomUUID();

  const el = addMessage("assistant");
  el.classList.add("streaming");
  const id = crypto.randomUUID();
  state.pending = { id, el, body: el.firstChild, text: "" };
  setBusy(true);

  state.port.postMessage({
    type: "chat",
    id,
    provider: providerId,
    model: modelId,
    sessionId: state.sessionId,
    resume,
    prompt,
  });
}

function finish(p, { error }) {
  p.el.classList.remove("streaming");
  if (error) {
    p.el.classList.add("error");
    p.body.textContent = p.text ? `${p.text}\n\n⚠ ${error}` : `⚠ ${error}`;
  } else if (!p.text) {
    p.body.textContent = "(empty reply)";
  }
  state.pending = null;
  setBusy(false);
}

function stop() {
  if (!state.pending) return;
  state.port?.postMessage({ type: "cancel", id: state.pending.id });
  finish(state.pending, { error: "Stopped." });
}

function newChat() {
  stop();
  state.sessionId = null;
  state.sentPageUrl = null;
  els.messages.querySelectorAll(".msg").forEach((m) => m.remove());
  els.empty.hidden = false;
  els.input.focus();
}

function setBusy(busy) {
  els.send.classList.toggle("stop", busy);
  els.send.textContent = busy ? "■" : "↑";
  els.send.title = busy ? "Stop" : "Send";
}

function scrollDown() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function showBanner(text) {
  els.banner.textContent = text;
  els.banner.hidden = false;
}

function hideBanner() {
  els.banner.hidden = true;
}

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.pending) return stop();
  const q = els.input.value.trim();
  if (!q) return;
  els.input.value = "";
  autosize();
  send(q);
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = `${els.input.scrollHeight}px`;
}
els.input.addEventListener("input", autosize);
els.newChat.addEventListener("click", newChat);

connect();
refreshChip();
