// Side panel entry point: the chat, the composer (skills, @tabs, attachments, voice),
// and switching between the chat, history and info views.

import * as host from "./host.js";
import * as db from "./db.js";
import * as ctx from "./context.js";
import * as skills from "./skills.js";
import * as voice from "./voice.js";
import { renderMarkdown } from "./markdown.js";
import { createRunner, urlsIn } from "./tools.js";
import { renderInfo } from "./info.js";
import { renderHistory } from "./history.js";
import { renderMedia } from "./saver.js";

const $ = (id) => document.getElementById(id);
const els = {
  skillsBtn: $("skills-btn"),
  skillsMenu: $("skills-menu"),
  mediaView: $("media-view"),
  model: $("model"),
  newChat: $("new-chat"),
  historyBtn: $("history-btn"),
  infoBtn: $("info-btn"),
  historyView: $("history-view"),
  infoView: $("info-view"),
  messages: $("messages"),
  empty: $("empty"),
  banner: $("banner"),
  toast: $("toast"),
  chips: $("chips"),
  chip: $("context-chip"),
  chipIcon: $("context-icon"),
  chipTitle: $("context-title"),
  popover: $("popover"),
  attachMenu: $("attach-menu"),
  editNote: $("edit-note"),
  cancelEdit: $("cancel-edit"),
  composer: $("composer"),
  attach: $("attach"),
  input: $("input"),
  mic: $("mic"),
  send: $("send"),
  fileInput: $("file-input"),
};

const state = {
  providers: [],
  keys: {},
  logins: [],
  chat: null, // the open chat (see db.js for its shape)
  includePage: true,
  skill: null, // skill picked with "/"
  mentions: [], // [{ type: "tab", tab } | { type: "group", group }]
  attachments: [], // for the next message
  quote: null, // text from right-click "Ask about selection"
  editIndex: null, // index of the user message being edited
  pending: null, // { cancel, msg, el }
  view: null, // null (chat) | "history" | "info"
  menu: null, // open "/" or "@" menu: { kind, items, index, start }
};

// ---------- router ----------

host.on("hello", (msg) => {
  hideBanner();
  state.providers = msg.providers;
  state.keys = msg.keys || {};
  state.logins = msg.logins || [];
  fillModels();
  if (state.view === "info") showInfo();
  if (!state.providers.length) showBanner("No models connected yet. Open ⓘ to connect a login or add an API key.");
});

host.on("down", ({ error }) => {
  showBanner(`Can't reach the local router: ${error}\n\nRun host/install.sh from the repo, then reopen this panel.`);
});

// ---------- models ----------

function fillModels() {
  const wanted = state.chat?.providerId ? `${state.chat.providerId}::${state.chat.modelId}` : localStorage.getItem("model");
  els.model.innerHTML = "";
  for (const provider of state.providers) {
    const group = document.createElement("optgroup");
    group.label = provider.label;
    for (const m of provider.models) group.append(new Option(m.label, `${provider.id}::${m.id}`));
    if (provider.error) {
      const opt = new Option(`⚠ ${provider.error.slice(0, 80)}`, "");
      opt.disabled = true;
      group.append(opt);
    }
    els.model.append(group);
  }
  if (wanted && [...els.model.options].some((o) => o.value === wanted)) els.model.value = wanted;
}

function currentModel() {
  const [providerId, modelId] = (els.model.value || "").split("::");
  const label = els.model.selectedOptions[0]?.textContent || "";
  return { providerId, modelId, label };
}

const isLogin = (providerId) => state.logins.some((l) => l.id === providerId);

els.model.addEventListener("change", () => localStorage.setItem("model", els.model.value));

// ---------- views ----------

function showView(view) {
  state.view = state.view === view ? null : view;
  els.historyView.hidden = state.view !== "history";
  els.infoView.hidden = state.view !== "info";
  els.mediaView.hidden = state.view !== "media";
  els.messages.hidden = state.view !== null;
  els.historyBtn.classList.toggle("on", state.view === "history");
  els.infoBtn.classList.toggle("on", state.view === "info");
  if (state.view === "history") renderHistory({ onOpen: openChat, currentId: state.chat?.id });
  if (state.view === "info") showInfo();
  if (state.view === "media") {
    renderMedia({
      attach: addAttachment,
      done: () => showView("media"), // back to the chat with the images attached
      toast,
    });
  }
}

function showInfo() {
  renderInfo(els.infoView, {
    keys: state.keys,
    logins: state.logins,
    post: (m) => host.post(m),
    attach: (a) => {
      addAttachment(a);
      showView(null);
    },
    toast,
  });
}

els.historyBtn.addEventListener("click", () => showView("history"));
els.infoBtn.addEventListener("click", () => showView("info"));

// ---------- chats ----------

function newChatObject() {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: "New chat", createdAt: now, updatedAt: now, messages: [] };
}

function newChat() {
  stop();
  state.chat = null;
  cancelEdit();
  clearComposerContext();
  renderAll();
  if (state.view) showView(state.view); // back to chat
  els.input.focus();
}

async function openChat(id) {
  stop();
  const chat = await db.getChat(id);
  if (!chat) return;
  state.chat = chat;
  cancelEdit();
  fillModels();
  renderAll();
  showView(state.view); // close the history view
}

async function persist() {
  const chat = state.chat;
  if (!chat?.messages.length) return;
  const first = chat.messages.find((m) => m.role === "user");
  if (chat.title === "New chat" && first) chat.title = first.display.replace(/\s+/g, " ").slice(0, 80) || "Chat";
  chat.updatedAt = Date.now();
  await db.saveChat(chat);
}

els.newChat.addEventListener("click", newChat);

// ---------- rendering ----------

function renderAll() {
  els.messages.querySelectorAll(".msg").forEach((m) => m.remove());
  const msgs = state.chat?.messages || [];
  els.empty.hidden = msgs.length > 0;
  msgs.forEach((m, i) => els.messages.append(messageEl(m, i)));
  scrollDown();
}

function messageEl(msg, index) {
  const el = document.createElement("div");
  el.className = `msg ${msg.role}${msg.error ? " error" : ""}`;
  el.dataset.index = index;

  if (msg.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    for (const label of msg.labels || []) {
      const tag = document.createElement("span");
      tag.className = "attached";
      tag.textContent = label;
      bubble.append(tag);
    }
    bubble.append(msg.display);
    el.append(bubble);
    el.append(actions([["Edit", () => startEdit(index)]]));
  } else {
    const tools = document.createElement("div");
    tools.className = "tools";
    fillTools(tools, msg);
    const body = document.createElement("div");
    body.className = "body";
    fillBody(body, msg);
    el.append(tools, body);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = msg.model || "";
    el.append(actions([
      ["Copy", () => navigator.clipboard.writeText(msg.text || "").then(() => toast("Copied"))],
      ["Regenerate", () => regenerate(index)],
    ], meta));
  }
  return el;
}

// What the model did while browsing: "Opening 1001tracklists.com ✓".
function fillTools(box, msg) {
  box.replaceChildren(
    ...(msg.tools || []).map((t) => {
      const row = document.createElement("div");
      row.className = `tool ${t.status}`;
      const mark = { running: "…", done: "✓", failed: "✕", asking: "?" }[t.status] || "";
      row.textContent = `${t.label}${t.note ? ` · ${t.note}` : ""} ${mark}`;
      if (t.status === "asking" && t.answer) {
        const allow = document.createElement("button");
        allow.textContent = "Allow";
        allow.className = "primary";
        allow.addEventListener("click", () => t.answer(true));
        const deny = document.createElement("button");
        deny.textContent = "Don't open";
        deny.addEventListener("click", () => t.answer(false));
        row.append(allow, deny);
      }
      return row;
    })
  );
  box.hidden = !msg.tools?.length;
}

function fillBody(body, msg) {
  if (msg.error && !msg.text) body.textContent = `⚠ ${msg.error}`;
  else {
    body.innerHTML = renderMarkdown(msg.text || "", { timestamps: !!msg.sourceTabId });
    if (msg.error) {
      const err = document.createElement("p");
      err.className = "err";
      err.textContent = `⚠ ${msg.error}`;
      body.append(err);
    }
  }
}

function actions(list, lead) {
  const bar = document.createElement("div");
  bar.className = "actions";
  if (lead) bar.append(lead);
  for (const [label, fn] of list) {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", fn);
    bar.append(b);
  }
  return bar;
}

// Timestamp links jump the video in the tab the question was about.
els.messages.addEventListener("click", async (e) => {
  const a = e.target.closest("a.ts");
  if (!a) return;
  e.preventDefault();
  const msg = state.chat?.messages[a.closest(".msg")?.dataset.index];
  if (!msg?.sourceTabId) return;
  const ok = await ctx.seekTab(msg.sourceTabId, msg.sourceUrl, Number(a.dataset.t));
  if (!ok) toast("No video or audio found in that tab.");
});

// ---------- skills dropdown (⚡ next to the model) ----------

async function openSkillsMenu() {
  const list = await skills.allSkills();
  const item = (s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "item";
    b.setAttribute("role", "menuitem");
    const t = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = s.name;
    const sub = document.createElement("small");
    sub.textContent = s.prompt
      .replace(/\{(\w+)\}/g, (_, v) => ({ tab: "this page", tabs: "your tabs", selection: "the selection", input: "…" })[v] ?? "")
      .replace(/…\./g, "…")
      .replace(/\s+([.,:])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    t.append(name, sub);
    // Click runs it now; the pencil adds it to the box so you can add details first.
    const edit = document.createElement("span");
    edit.className = "add";
    edit.title = "Add details before sending";
    edit.textContent = "✎";
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSkillsMenu();
      state.skill = s;
      renderChips();
      els.input.focus();
    });
    b.append(t, edit);
    b.addEventListener("click", () => {
      closeSkillsMenu();
      if (state.view) showView(state.view);
      state.skill = s;
      send(els.input.value.trim());
      els.input.value = "";
      autosize();
    });
    return b;
  };
  const manage = document.createElement("button");
  manage.type = "button";
  manage.className = "item manage";
  manage.textContent = "Manage skills…";
  manage.addEventListener("click", () => {
    closeSkillsMenu();
    localStorage.setItem("infoOpen", JSON.stringify([...new Set([...JSON.parse(localStorage.getItem("infoOpen") || "[]"), "skills"])]));
    if (state.view !== "info") showView("info");
  });
  els.skillsMenu.replaceChildren(...list.map(item), manage);
  els.skillsMenu.classList.add("open");
  els.skillsBtn.classList.add("on");
  els.skillsBtn.setAttribute("aria-expanded", "true");
}

function closeSkillsMenu() {
  els.skillsMenu.classList.remove("open");
  els.skillsBtn.classList.remove("on");
  els.skillsBtn.setAttribute("aria-expanded", "false");
}

els.skillsBtn.addEventListener("click", () => (els.skillsMenu.classList.contains("open") ? closeSkillsMenu() : openSkillsMenu()));
document.addEventListener("click", (e) => {
  if (!e.target.closest(".skills-wrap")) closeSkillsMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSkillsMenu();
});

// ---------- sending ----------

async function buildMessage(text) {
  const chat = state.chat;
  let skill = state.skill;
  let input = text;
  // "/name rest" typed out in full, without picking from the menu.
  const typed = !skill && text.match(/^\/([\w-]+)\s*([\s\S]*)$/);
  if (typed) {
    const found = (await skills.allSkills()).find((s) => s.id === typed[1] || skills.slug(s.name) === typed[1].toLowerCase());
    if (found) [skill, input] = [found, typed[2]];
  }
  const need = skills.needs(skill);

  const blocks = [];
  const labels = [];
  const attachments = state.attachments.filter((a) => a.kind !== "text");
  const pages = []; // pages whose full text this message carries
  let hasSelection = false;
  let sourceTab = null;

  const tab = await ctx.activeTab();
  if (tab && (state.includePage || need.tab || need.selection)) {
    const info = await ctx.readTab(tab);
    if (!sentPages(chat).includes(tab.url) || need.tab) {
      blocks.push(ctx.block(info, "page"));
      if (info.pdf) attachments.push(info.pdf);
      if (!info.unreadable) pages.push(tab.url);
    }
    labels.push(`📎 ${tab.title}`);
    if (info.selection) {
      blocks.push(`<selection>\n${info.selection}\n</selection>`);
      hasSelection = true;
    }
    if (info.duration || /youtube\.com\/watch/.test(tab.url)) sourceTab = tab;
  }

  if (state.quote) {
    blocks.push(`<selection>\n${state.quote}\n</selection>`);
    hasSelection = true;
  }

  let mentioned = [];
  for (const m of state.mentions) {
    if (m.type === "tab") mentioned.push(m.tab);
    else mentioned.push(...m.group.tabs);
    labels.push(m.type === "tab" ? `@ ${m.tab.title}` : `@ ${m.group.title || "Tab group"}`);
  }
  if (need.tabs && !mentioned.length) {
    mentioned = (await ctx.windowTabs()).filter((t) => t.id !== tab?.id).slice(0, 8);
    if (mentioned.length) labels.push(`@ ${mentioned.length} tabs in this window`);
  }
  for (const t of dedupe(mentioned, tab?.id)) {
    const info = await ctx.readMentionedTab(t);
    blocks.push(ctx.block(info, "tab"));
    if (info.pdf) attachments.push(info.pdf);
  }

  for (const a of state.attachments) {
    labels.push(`${a.kind === "image" ? "🖼" : "📄"} ${a.name}`);
    if (a.kind === "text") blocks.push(`<file name="${a.name.replace(/"/g, "'")}">\n${a.text}\n</file>`);
  }

  const instruction = skill ? skills.expand(skill, input, { hasSelection }) : input;
  return {
    display: skill ? `/${skill.name}${input ? ` ${input}` : ""}` : text,
    prompt: [...blocks, instruction].filter(Boolean).join("\n\n"),
    labels,
    attachments,
    pages,
    sourceTab,
  };
}

// Pages already sent earlier in the chat aren't sent again. Derived from the messages,
// so an edit that removes the message carrying a page sends it again.
const sentPages = (chat) => chat.messages.flatMap((m) => m.pages || []);

function dedupe(tabs, skipId) {
  const seen = new Set([skipId]);
  return tabs.filter((t) => !seen.has(t.id) && seen.add(t.id));
}

async function send(text) {
  if (state.pending) return;
  const { providerId } = currentModel();
  if (!providerId) return showBanner("Pick a model first: open ⓘ to connect a login or add an API key.");
  if (!text && !state.skill && !state.attachments.length) return;

  state.chat ??= newChatObject();
  const chat = state.chat;
  if (state.editIndex != null) {
    chat.messages = chat.messages.slice(0, state.editIndex);
    chat.needsReplay = true; // the CLI session still holds the old turns
    if (state.editIndex === 0) chat.title = "New chat"; // retitle from the edited question
    cancelEdit();
  }

  const built = await buildMessage(text);
  const userMsg = { role: "user", display: built.display, prompt: built.prompt, labels: built.labels, attachments: built.attachments, pages: built.pages };
  chat.messages.push(userMsg);
  clearComposerContext();
  renderAll();
  await respond(userMsg, built.sourceTab);
}

// History for API models (and for replaying into a fresh CLI session): the text of
// every earlier turn, merged so roles alternate.
function historyBefore(index) {
  const out = [];
  for (const m of state.chat.messages.slice(0, index)) {
    const content = m.role === "user" ? m.prompt : m.text;
    if (!content) continue;
    const last = out[out.length - 1];
    if (last?.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  return out;
}

async function respond(userMsg, sourceTab, { retried = false } = {}) {
  const chat = state.chat;
  const { providerId, modelId, label } = currentModel();
  const index = chat.messages.indexOf(userMsg);

  let resume = false;
  if (isLogin(providerId)) {
    const sameSession = chat.sessionId && chat.sessionProvider === providerId && !chat.needsReplay;
    resume = sameSession && (providerId !== "codex-cli" || !!chat.cliSession);
    if (!resume) Object.assign(chat, { sessionId: crypto.randomUUID(), sessionProvider: providerId, cliSession: null });
  }

  const msg = { role: "assistant", text: "", model: label, sourceTabId: sourceTab?.id, sourceUrl: sourceTab?.url };
  chat.messages.splice(index + 1, 0, msg);
  Object.assign(chat, { providerId, modelId });
  const el = messageEl(msg, index + 1);
  el.classList.add("streaming");
  els.messages.append(el);
  els.empty.hidden = true;
  scrollDown();
  const body = el.querySelector(".body");
  const toolBox = el.querySelector(".tools");

  // Read-only browsing: links already in the chat can be opened; others need approval.
  const browse = localStorage.getItem("browse") !== "off";
  const seen = new Set(chat.messages.flatMap((m) => urlsIn(m.role === "user" ? m.prompt : m.text)));
  const showTools = () => {
    fillTools(toolBox, msg);
    scrollDown();
  };
  const routerRows = new Map(); // activityId -> row, for tools the router runs
  const runTool = createRunner({
    seen,
    activity(label) {
      const t = { label, status: "running" };
      (msg.tools ??= []).push(t);
      showTools();
      return {
        done: (note) => (Object.assign(t, { status: "done", note }), showTools()),
        fail: (note) => (Object.assign(t, { status: "failed", note }), showTools()),
      };
    },
    approve(url) {
      return new Promise((resolve) => {
        const t = { label: `Open ${url}?`, status: "asking" };
        t.answer = (ok) => {
          Object.assign(t, { status: ok ? "done" : "failed", note: ok ? "allowed" : "not opened", answer: null });
          showTools();
          resolve(ok);
        };
        (msg.tools ??= []).push(t);
        showTools();
      });
    },
  });

  let frame = 0;
  const paint = () => {
    frame = 0;
    fillBody(body, msg);
    scrollDown();
  };

  setBusy(true);
  let stopped = false;
  const finish = async (error) => {
    if (state.pending?.msg !== msg) return; // already finished (e.g. stopped)
    state.pending = null;
    setBusy(false);
    // A CLI session that can't be resumed (deleted, expired): replay the chat once.
    if (error && resume && !retried && !stopped && !msg.text) {
      chat.messages.splice(chat.messages.indexOf(msg), 1);
      el.remove();
      chat.needsReplay = true;
      return respond(userMsg, sourceTab, { retried: true });
    }
    if (error) msg.error = error;
    else chat.needsReplay = false;
    el.replaceWith(messageEl(msg, chat.messages.indexOf(msg)));
    await persist();
  };

  // Registered before the request goes out: if the router is down, the error arrives synchronously.
  state.pending = { msg, finish, cancel: () => {}, stop: () => (stopped = true) };
  state.pending.cancel = host.chat(
    {
      provider: providerId,
      model: modelId,
      sessionId: chat.sessionId,
      cliSession: chat.cliSession,
      resume,
      browse,
      prompt: userMsg.prompt,
      history: resume ? [] : historyBefore(index),
      attachments: (userMsg.attachments || []).filter((a) => a.kind === "image" || a.kind === "pdf"),
    },
    {
      delta: (t) => {
        msg.text += t;
        frame ||= requestAnimationFrame(paint);
      },
      session: (value) => (chat.cliSession = value),
      tool: browse ? runTool : null,
      activity: ({ activityId, label, note, status }) => {
        let t = routerRows.get(activityId);
        if (!t) {
          t = { label, status: "running" };
          routerRows.set(activityId, t);
          (msg.tools ??= []).push(t);
        }
        if (label) t.label = label;
        t.note = note;
        t.status = status;
        showTools();
      },
      done: () => finish(),
      error: (e) => finish(e),
    }
  );
}

function stop() {
  const p = state.pending;
  if (!p) return;
  p.stop();
  p.cancel();
  p.finish("Stopped.");
}

function regenerate(index) {
  if (state.pending) return;
  const chat = state.chat;
  const userIndex = index - 1;
  const userMsg = chat.messages[userIndex];
  if (userMsg?.role !== "user") return;
  const old = chat.messages[index];
  chat.messages = chat.messages.slice(0, index);
  chat.needsReplay = true;
  renderAll();
  respond(userMsg, old?.sourceTabId ? { id: old.sourceTabId, url: old.sourceUrl } : null);
}

function startEdit(index) {
  if (state.pending) return;
  const msg = state.chat.messages[index];
  state.editIndex = index;
  els.input.value = msg.display;
  autosize();
  els.editNote.hidden = false;
  els.composer.classList.add("editing");
  els.input.focus();
}

function cancelEdit() {
  state.editIndex = null;
  els.editNote.hidden = true;
  els.composer.classList.remove("editing");
}

els.cancelEdit.addEventListener("click", () => {
  cancelEdit();
  els.input.value = "";
  autosize();
});

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

let toastTimer = 0;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
}

// ---------- composer: context chips ----------

async function refreshPageChip() {
  const tab = await ctx.activeTab();
  els.chipTitle.textContent = tab?.title || "No tab";
  if (tab?.favIconUrl) els.chipIcon.src = tab.favIconUrl;
  else els.chipIcon.removeAttribute("src");
  els.chip.classList.toggle("off", !state.includePage);
}

els.chip.addEventListener("click", () => {
  state.includePage = !state.includePage;
  refreshPageChip();
});
chrome.tabs.onActivated.addListener(refreshPageChip);
chrome.tabs.onUpdated.addListener((_, info) => {
  if (info.title || info.status === "complete") refreshPageChip();
});

function renderChips() {
  els.chips.querySelectorAll(".chip.extra").forEach((c) => c.remove());
  const add = (text, title, onRemove) => {
    const c = document.createElement("span");
    c.className = "chip extra";
    c.title = title;
    const label = document.createElement("span");
    label.textContent = text;
    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.title = "Remove";
    x.addEventListener("click", onRemove);
    c.append(label, x);
    els.chips.append(c);
  };
  if (state.skill) add(`/${state.skill.name}`, state.skill.prompt, () => ((state.skill = null), renderChips()));
  if (state.quote) add(`“${state.quote.slice(0, 40)}${state.quote.length > 40 ? "…" : ""}”`, state.quote, () => ((state.quote = null), renderChips()));
  state.mentions.forEach((m, i) => {
    const name = m.type === "tab" ? m.tab.title : `${m.group.title || "Tab group"} (${m.group.tabs.length})`;
    add(`@ ${name}`, name, () => (state.mentions.splice(i, 1), renderChips()));
  });
  state.attachments.forEach((a, i) => {
    add(`${a.kind === "image" ? "🖼" : "📄"} ${a.name}`, a.name, () => (state.attachments.splice(i, 1), renderChips()));
  });
}

function clearComposerContext() {
  state.skill = null;
  state.quote = null;
  state.mentions = [];
  state.attachments = [];
  renderChips();
}

function addAttachment(a) {
  state.attachments.push(a);
  renderChips();
  els.input.focus();
}

// ---------- composer: "/" and "@" menus ----------

async function updateMenu() {
  const before = els.input.value.slice(0, els.input.selectionStart);
  const skillMatch = before.match(/(?:^|\s)\/([\w-]*)$/);
  const tabMatch = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (skillMatch) {
    const q = skillMatch[1].toLowerCase();
    const items = (await skills.allSkills())
      .filter((s) => !q || skills.slug(s.name).includes(q) || s.id.includes(q))
      .map((s) => ({ kind: "skill", skill: s, title: s.name, sub: s.prompt }));
    openMenu("skill", items, before.length - q.length - 1);
  } else if (tabMatch) {
    const q = tabMatch[1].toLowerCase();
    const [tabs, groups] = await Promise.all([ctx.windowTabs(), ctx.tabGroups()]);
    const items = [
      ...groups.map((g) => ({ kind: "group", group: g, title: `${g.title || "Untitled group"} · ${g.tabs.length} tabs`, sub: "Tab group" })),
      ...tabs.map((t) => ({ kind: "tab", tab: t, title: t.title || t.url, sub: new URL(t.url).hostname, icon: t.favIconUrl })),
    ].filter((i) => !q || i.title.toLowerCase().includes(q) || (i.sub || "").toLowerCase().includes(q));
    openMenu("tab", items, before.length - q.length - 1);
  } else closeMenu();
}

function openMenu(kind, items, start) {
  if (!items.length) return closeMenu();
  state.menu = { kind, items: items.slice(0, 30), index: 0, start };
  drawMenu();
}

function drawMenu() {
  const m = state.menu;
  els.popover.replaceChildren(
    ...m.items.map((item, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `item${i === m.index ? " active" : ""}`;
      row.setAttribute("role", "option");
      if (item.icon) {
        const img = document.createElement("img");
        img.src = item.icon;
        img.alt = "";
        row.append(img);
      }
      const text = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = item.title;
      const sub = document.createElement("small");
      sub.textContent = item.sub || "";
      text.append(title, sub);
      row.append(text);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(i);
      });
      return row;
    })
  );
  els.popover.hidden = false;
  els.popover.querySelector(".active")?.scrollIntoView({ block: "nearest" });
}

function closeMenu() {
  state.menu = null;
  els.popover.hidden = true;
}

function pick(i) {
  const m = state.menu;
  const item = m.items[i];
  const caret = els.input.selectionStart;
  els.input.value = els.input.value.slice(0, m.start) + els.input.value.slice(caret);
  els.input.selectionStart = els.input.selectionEnd = m.start;
  if (item.kind === "skill") state.skill = item.skill;
  else state.mentions.push(item.kind === "tab" ? { type: "tab", tab: item.tab } : { type: "group", group: item.group });
  closeMenu();
  renderChips();
  autosize();
  els.input.focus();
}

els.input.addEventListener("input", () => {
  autosize();
  updateMenu();
});
els.input.addEventListener("blur", () => setTimeout(closeMenu, 150));

els.input.addEventListener("keydown", (e) => {
  const m = state.menu;
  if (m) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      m.index = (m.index + (e.key === "ArrowDown" ? 1 : -1) + m.items.length) % m.items.length;
      return drawMenu();
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      return pick(m.index);
    }
    if (e.key === "Escape") return closeMenu();
  }
  if (e.key === "Backspace" && !els.input.value && els.input.selectionStart === 0) {
    // Backspace in an empty box removes the last chip.
    if (state.attachments.length) state.attachments.pop();
    else if (state.mentions.length) state.mentions.pop();
    else if (state.quote) state.quote = null;
    else if (state.skill) state.skill = null;
    renderChips();
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.pending) return stop();
  const q = els.input.value.trim();
  els.input.value = "";
  autosize();
  send(q);
});

function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = `${els.input.scrollHeight}px`;
}

// ---------- composer: attachments ----------

async function readFile(file) {
  const mime = file.type || ctx.guessMime(file.name);
  return ctx.fromBytes(await file.arrayBuffer(), mime, file.name);
}

async function attachFiles(files) {
  for (const f of files) {
    try {
      addAttachment(await readFile(f));
    } catch (e) {
      toast(e.message);
    }
  }
}

els.fileInput.addEventListener("change", () => {
  attachFiles([...els.fileInput.files]);
  els.fileInput.value = "";
});

els.input.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    attachFiles(files);
  }
});

async function openAttachMenu() {
  if (!els.attachMenu.hidden) return (els.attachMenu.hidden = true);
  const tab = await ctx.activeTab();
  const rows = [
    ["Upload a file…", "Images, PDFs or text", () => els.fileInput.click()],
    ["Screenshot this tab", "What's visible right now", async () => addAttachment(await ctx.screenshot())],
    ["Images & videos on this page…", "Download them, or attach images", () => showView("media")],
  ];
  if (tab && /\.pdf($|[?#])/i.test(tab.url)) {
    rows.push(["Attach this PDF", tab.title, async () => addAttachment(await ctx.fetchAttachment(tab.url, tab.title))]);
  }
  const downloads = await ctx.recentDownloads(5).catch(() => []);
  const items = rows.map(([title, sub, fn]) => menuButton(title, sub, fn));
  if (downloads.length) {
    const h = document.createElement("div");
    h.className = "menu-heading";
    h.textContent = "Recent downloads";
    items.push(h, ...downloads.map((d) => menuButton(d.name, formatSize(d.size), async () => addAttachment(await ctx.fetchAttachment(d.url, d.name)))));
  }
  els.attachMenu.replaceChildren(...items);
  els.attachMenu.hidden = false;
}

function menuButton(title, sub, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "item";
  const t = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = sub || "";
  t.append(strong, small);
  b.append(t);
  b.addEventListener("click", async () => {
    els.attachMenu.hidden = true;
    try {
      await fn();
    } catch (e) {
      toast(e.message);
    }
  });
  return b;
}

export function formatSize(bytes) {
  if (!bytes) return "";
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

els.attach.addEventListener("click", openAttachMenu);
document.addEventListener("click", (e) => {
  if (!els.attachMenu.hidden && !els.attachMenu.contains(e.target) && !els.attach.contains(e.target)) els.attachMenu.hidden = true;
});

// ---------- composer: voice ----------

els.mic.hidden = !voice.supported;
els.mic.addEventListener("click", () => {
  if (voice.listening()) return voice.stop();
  const base = els.input.value ? `${els.input.value.trimEnd()} ` : "";
  els.mic.classList.add("on");
  voice.start({
    onText: (t) => {
      els.input.value = base + t;
      autosize();
    },
    onEnd: (err) => {
      els.mic.classList.remove("on");
      if (err) toast(err);
      els.input.focus();
    },
  });
});

// ---------- actions from the right-click menu and the address bar ----------

async function runPendingAction() {
  const { pendingAction: a } = await chrome.storage.session.get("pendingAction");
  if (!a || Date.now() - a.at > 60000) return;
  await chrome.storage.session.remove("pendingAction");
  if (state.view) showView(state.view);
  if (a.selection) state.quote = a.selection;
  if (a.kind === "image" && a.srcUrl) {
    try {
      addAttachment(await ctx.fetchAttachment(a.srcUrl, "image"));
    } catch (e) {
      toast(e.message);
    }
  }
  if (a.skillId) {
    state.skill = (await skills.allSkills()).find((s) => s.id === a.skillId) || null;
    renderChips();
    return send(a.text || "");
  }
  if (a.kind === "ask" && a.text) return send(a.text);
  renderChips();
  els.input.focus();
}

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pendingAction?.newValue) runPendingAction();
});

// ---------- start ----------

host.connect();
refreshPageChip();
renderAll();
runPendingAction();
