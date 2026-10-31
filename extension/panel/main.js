// Side panel entry point: the chat, the composer (skills, @tabs, attachments, voice),
// and switching between the chat, history and info views.

import * as host from "./host.js";
import * as db from "./db.js";
import * as ctx from "./context.js";
import * as skills from "./skills.js";
import * as voice from "./voice.js";
import { renderMarkdown } from "./markdown.js";
import { createRunner, siteOf, sitesIn, urlsIn } from "./tools.js";
import { renderInfo } from "./info.js";
import { renderHistory } from "./history.js";
import { renderMedia } from "./saver.js";
import { renderExtensions } from "./extensions.js";
import { renderPrs, counts as prCounts } from "./prs.js";
import * as motion from "./motion.js";
import * as tidy from "./tidy.js";
import { INSTANT } from "./instant.js";

const $ = (id) => document.getElementById(id);
const els = {
  skillsBtn: $("skills-btn"),
  modelBtn: $("model-btn"),
  modelMenu: $("model-menu"),
  modelLabel: $("model-label"),
  skillsMenu: $("skills-menu"),
  mediaView: $("media-view"),
  extView: $("extensions-view"),
  prsView: $("prs-view"),
  prsBtn: $("prs-btn"),
  prsBadge: $("prs-badge"),
  extBtn: $("ext-btn"),
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
  pending: null, // { cancel, msg, finish, stop } while a reply (or instant action) runs
  sending: false, // true while a message is being put together, before its reply starts
  view: null, // null (chat) | "history" | "info"
  menu: null, // open "/" or "@" menu: { kind, items, index, start }
};

// ---------- router ----------

host.on("hello", (msg) => {
  hideBanner();
  state.providers = msg.providers;
  state.keys = msg.keys || {};
  state.logins = msg.logins || [];
  fillModels(els.model.value);
  if (state.view === "info") showInfo();
  if (!state.providers.length) showBanner("No models connected yet. Open ⓘ to connect a login or add an API key.");
});

host.on("down", ({ error }) => {
  showBanner(`Can't reach the local router: ${error}\n\nRun host/install.sh from the repo, then reopen this panel.`);
});

// ---------- models ----------

// keep: the model to stay on (a router restart shouldn't undo the pick you just made).
function fillModels(keep) {
  const wanted = keep || (state.chat?.providerId ? `${state.chat.providerId}::${state.chat.modelId}` : localStorage.getItem("model"));
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
  updateModelLabel();
}

function updateModelLabel() {
  const opt = els.model.selectedOptions[0];
  els.modelLabel.textContent = opt && !opt.disabled ? opt.textContent : state.providers.length ? "Pick a model" : "No models connected";
  els.modelBtn.title = opt ? `${opt.parentElement?.label || ""} · ${opt.textContent}` : "Model";
}

function currentModel() {
  const [providerId, modelId] = (els.model.value || "").split("::");
  const label = els.model.selectedOptions[0]?.textContent || "";
  return { providerId, modelId, label };
}

const isLogin = (providerId) => state.logins.some((l) => l.id === providerId);

els.model.addEventListener("change", () => {
  localStorage.setItem("model", els.model.value);
  updateModelLabel();
});

// A menu row: <button class="item"><span><strong>title</strong><small>sub</small></span></button>.
function itemButton(title, sub, { className = "", role } = {}) {
  const b = Object.assign(document.createElement("button"), { type: "button", className: `item ${className}`.trim() });
  if (role) b.setAttribute("role", role);
  const t = document.createElement("span");
  if (title != null) t.append(Object.assign(document.createElement("strong"), { textContent: title }));
  if (sub != null) t.append(Object.assign(document.createElement("small"), { textContent: sub }));
  b.append(t);
  return b;
}

// ---------- model menu (Lumen's own, instead of the native select popup) ----------

function openModelMenu() {
  closeSkillsMenu();
  const groups = [...els.model.querySelectorAll("optgroup")];
  const nodes = [];
  for (const g of groups) {
    nodes.push(Object.assign(document.createElement("div"), { className: "menu-heading", textContent: g.label }));
    for (const o of g.querySelectorAll("option")) {
      const b = o.disabled ? itemButton(null, o.textContent, { className: "err", role: "option" }) : itemButton(o.textContent, null, { role: "option" });
      b.setAttribute("aria-selected", String(o.selected && !o.disabled));
      b.dataset.value = o.value;
      b.append(Object.assign(document.createElement("span"), { className: "check", textContent: "✓" }));
      if (!o.disabled) b.addEventListener("click", () => chooseModel(o.value));
      nodes.push(b);
    }
  }
  if (!nodes.length) {
    nodes.push(Object.assign(document.createElement("p"), { className: "hint", textContent: "No models connected yet. Open ⓘ to connect a login or add an API key." }));
  }
  els.modelMenu.replaceChildren(...nodes);
  const r = els.modelBtn.getBoundingClientRect();
  els.modelMenu.style.top = `${r.bottom + 8}px`;
  els.modelMenu.style.left = `${Math.max(8, r.left)}px`;
  els.modelMenu.style.minWidth = `${Math.max(240, r.width)}px`;
  els.modelMenu.classList.add("open");
  els.modelBtn.setAttribute("aria-expanded", "true");
  motion.menuIn(els.modelMenu);
  els.modelMenu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

// Plays a dropdown's exit, then hides it.
async function closeDropdown(menu, btn) {
  if (!menu.classList.contains("open") || menu.dataset.closing) return;
  menu.dataset.closing = "1";
  btn.classList.remove("on");
  btn.setAttribute("aria-expanded", "false");
  await motion.menuOut(menu);
  menu.classList.remove("open");
  menu.querySelectorAll("*").forEach(motion.reset);
  motion.reset(menu);
  delete menu.dataset.closing;
}
const closeModelMenu = () => closeDropdown(els.modelMenu, els.modelBtn);

function chooseModel(value) {
  if (els.model.value !== value) {
    els.model.value = value;
    els.model.dispatchEvent(new Event("change"));
  }
  closeModelMenu();
  els.modelBtn.focus();
}

els.modelBtn.addEventListener("click", () => (els.modelMenu.classList.contains("open") ? closeModelMenu() : openModelMenu()));
els.modelBtn.addEventListener("keydown", (e) => {
  if (["ArrowDown", "ArrowUp"].includes(e.key) && !els.modelMenu.classList.contains("open")) {
    e.preventDefault();
    openModelMenu();
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#model-btn, #model-menu")) closeModelMenu();
});
// Arrow keys move through models, Enter picks, Escape closes.
document.addEventListener("keydown", (e) => {
  if (!els.modelMenu.classList.contains("open")) return;
  const items = [...els.modelMenu.querySelectorAll(".item:not(.err)")];
  if (!items.length) return;
  let i = items.findIndex((b) => b.classList.contains("kbd"));
  if (i < 0) i = items.findIndex((b) => b.getAttribute("aria-selected") === "true");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    i = (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((b, j) => b.classList.toggle("kbd", j === i));
    items[i].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && i >= 0) {
    e.preventDefault();
    chooseModel(items[i].dataset.value);
  } else if (e.key === "Escape") {
    closeModelMenu();
    els.modelBtn.focus();
  }
});

// ---------- views ----------

let switching = Promise.resolve();
function showView(view) {
  // Serialize switches so a quick double-click can't interleave exits and entrances.
  switching = switching.then(() => switchView(view));
  return switching;
}

const viewEl = (v) => ({ history: els.historyView, info: els.infoView, media: els.mediaView, extensions: els.extView, prs: els.prsView })[v] || els.messages;

async function switchView(view) {
  const next = state.view === view ? null : view;
  if (next !== state.view) {
    const leaving = viewEl(state.view);
    await motion.leave(leaving, { y: 10, scale: 0.985, duration: 150 });
    motion.reset(leaving);
  }
  state.view = next;
  els.historyView.hidden = state.view !== "history";
  els.infoView.hidden = state.view !== "info";
  els.mediaView.hidden = state.view !== "media";
  els.extView.hidden = state.view !== "extensions";
  els.extBtn.classList.toggle("on", state.view === "extensions");
  els.prsView.hidden = state.view !== "prs";
  els.prsBtn.classList.toggle("on", state.view === "prs");
  els.messages.hidden = state.view !== null;
  els.historyBtn.classList.toggle("on", state.view === "history");
  els.infoBtn.classList.toggle("on", state.view === "info");
  motion.viewIn(viewEl(state.view));
  if (state.view === "history") {
    renderHistory({ onOpen: openChat, currentId: state.chat?.id }).then(() => motion.cascade(els.historyView.querySelectorAll(".history-item")));
  }
  if (state.view === "info") {
    showInfo();
    motion.cascade(els.infoView.querySelectorAll(".acc"), { gap: 45 });
  }
  if (state.view === "extensions") {
    let first = true;
    renderExtensions({ changed: (list) => first && ((first = false), motion.cascade(list.children, { gap: 22 })) });
  }
  if (state.view === "prs") {
    let first = true;
    renderPrs({ changed: (list) => first && ((first = false), motion.cascade(list.children, { gap: 22 })) });
  }
  if (state.view === "media") {
    // "done" returns to the chat with the images attached
    renderMedia(mediaDeps()).then(() => motion.tilesIn(els.mediaView.querySelectorAll(".media-tile")));
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
els.extBtn.addEventListener("click", () => showView("extensions"));
els.prsBtn.addEventListener("click", () => showView("prs"));

// On the PR button: open PRs plus merged/closed ones you haven't read.
async function updatePrBadge() {
  const { open, done, review } = await prCounts();
  const n = open + done;
  els.prsBadge.hidden = !n;
  els.prsBadge.textContent = n > 99 ? "99+" : String(n);
  els.prsBtn.title = ["Pull requests", open && `${open} open`, review && `${review} waiting for your review`, done && `${done} merged or closed`].filter(Boolean).join(" · ");
}
chrome.storage.onChanged.addListener((changes, area) => area === "local" && (changes.prState || changes.prDone) && updatePrBadge());
updatePrBadge();

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
  motion.cascade(els.messages.querySelectorAll(".msg"), { gap: 35, max: 12 });
  showView(state.view); // close the history view
}

async function persist(chat = state.chat) {
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
      // Local answers (tech stack) came from Lumen itself, not a model: nothing to regenerate.
      ...(msg.local ? [] : [["Regenerate", () => regenerate(index)]]),
    ], meta));
  }
  return el;
}

// What the model did while browsing: "Opening 1001tracklists.com ✓".
function fillTools(box, msg) {
  const before = Number(box.dataset.rows || 0);
  box.dataset.rows = String(msg.tools?.length || 0);
  queueMicrotask(() => [...box.children].slice(before).forEach((r) => motion.popIn(r, { from: 4, scale: 0.98 })));
  box.replaceChildren(
    ...(msg.tools || []).map((t) => {
      const row = document.createElement("div");
      row.className = `tool ${t.status}`;
      const mark = { running: "…", done: "✓", failed: "✕", asking: "?" }[t.status] || "";
      row.textContent = `${t.label}${t.note ? ` · ${t.note}` : ""} ${mark}`;
      if (t.status === "asking" && t.answer) {
        const allow = document.createElement("button");
        allow.textContent = t.site ? `Allow ${t.site}` : "Allow";
        allow.title = "Lets Lumen read any page on this site for the rest of this chat";
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
  // Links to a spot on the page the answer is about (outline headings) jump in that tab.
  const link = e.target.closest("a[href]:not(.ts)");
  const owner = link && state.chat?.messages[link.closest(".msg")?.dataset.index];
  if (link && owner?.sourceTabId && owner.sourceUrl && link.href.startsWith(owner.sourceUrl.split("#")[0] + "#")) {
    e.preventDefault();
    const tab = await chrome.tabs.update(owner.sourceTabId, { url: link.href, active: true }).catch(() => null);
    if (tab) chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  const a = e.target.closest("a.ts");
  if (!a) return;
  e.preventDefault();
  const msg = state.chat?.messages[a.closest(".msg")?.dataset.index];
  if (!msg?.sourceTabId) return;
  const ok = await ctx.seekTab(msg.sourceTabId, msg.sourceUrl, Number(a.dataset.t));
  if (!ok) toast("No video or audio found in that tab.");
});

// Progress rows for tools the router runs (e.g. "Reading YouTube auto captions"),
// one per activityId, updated as its status changes.
function routerActivity(msg, show) {
  const rows = new Map();
  return ({ activityId, label, note, status }) => {
    let t = rows.get(activityId);
    if (!t) rows.set(activityId, (t = { label, status }));
    Object.assign(t, label ? { label } : {}, { note, status });
    (msg.tools ??= []).includes(t) || msg.tools.push(t);
    show();
  };
}

// ---------- local actions (no AI) ----------

// An instant action runs on this device (no model, no tokens) and its answer joins the
// chat as Lumen's own message. The user turn's prompt says so, and the answer's text is
// in the history, so a follow-up question can use it.
async function runInstant(action) {
  if (state.pending || state.sending) return;
  const tab = await ctx.activeTab();
  if (!tab) return toast("No tab to work with.");
  if (state.view) showView(state.view);
  state.chat ??= newChatObject();
  const chat = state.chat;
  const userMsg = { role: "user", display: action.name, prompt: "", labels: [`📎 ${tab.title}`] };
  chat.messages.push(userMsg);
  els.empty.hidden = true;
  const userEl = messageEl(userMsg, chat.messages.length - 1);
  els.messages.append(userEl);
  motion.popIn(userEl, { from: 10, scale: 0.9 });

  const msg = { role: "assistant", text: "", model: "Lumen · instant, no AI", local: true };
  chat.messages.push(msg);
  const el = messageEl(msg, chat.messages.length - 1);
  el.classList.add("streaming");
  els.messages.append(el);
  motion.popIn(el, { from: 6, scale: 0.98 });
  const stopThinking = motion.thinking(el.querySelector(".body"));
  scrollDown();

  // Like a reply: ■, New chat or opening another chat stops it, and it's saved either way.
  let stopped = false;
  const finish = async (error) => {
    if (state.pending?.msg !== msg) return;
    state.pending = null;
    setBusy(false);
    stopThinking();
    if (error) msg.error = error;
    el.replaceWith(messageEl(msg, chat.messages.indexOf(msg)));
    chat.needsReplay = true; // a CLI session never saw these turns
    scrollDown();
    await persist(chat);
  };
  state.pending = { msg, finish, cancel: () => {}, stop: () => (stopped = true) };
  setBusy(true);

  const activity = routerActivity(msg, () => fillTools(el.querySelector(".tools"), msg));
  try {
    const out = await action.run(tab, { localTool: (name, input) => host.localTool(name, input, { activity }), github: host.github });
    msg.text = out.text;
    if (out.sourceTab) Object.assign(msg, { sourceTabId: out.sourceTab.id, sourceUrl: out.sourceTab.url });
    userMsg.prompt = `${action.name} for ${tab.url}. (Lumen did this itself, without a model; its answer follows.)`;
  } catch (e) {
    if (!stopped) msg.error = e.message;
    userMsg.prompt = `${action.name} for ${tab.url}.`;
  }
  if (!stopped) await finish(msg.error);
}

// Tab tidying (tidy.js): the result in a toast, with Undo when something changed.
async function runTidy(fn) {
  const { summary, undo } = await fn().catch((e) => ({ summary: `Couldn't tidy: ${e.message}` }));
  toast(summary, undo && { label: "Undo", run: async () => (await undo(), toast("Undone.")) });
}

// ---------- skills dropdown (⚡ next to the model) ----------

async function openSkillsMenu() {
  closeModelMenu();
  const list = await skills.allSkills();
  const item = (s) => {
    const sub = s.prompt
      .replace(/\{(\w+)\}/g, (_, v) => ({ tab: "this page", tabs: "your tabs", selection: "the selection", input: "…" })[v] ?? "")
      .replace(/…\./g, "…")
      .replace(/\s+([.,:])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
    const b = itemButton(s.name, sub, { role: "menuitem" });
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
    b.append(edit);
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
  const manage = Object.assign(document.createElement("button"), { type: "button", className: "item manage", textContent: "Manage skills…" });
  manage.addEventListener("click", () => {
    closeSkillsMenu();
    localStorage.setItem("infoOpen", JSON.stringify([...new Set([...JSON.parse(localStorage.getItem("infoOpen") || "[]"), "skills"])]));
    if (state.view !== "info") showView("info");
  });
  // Things the sidebar does (not prompts), kept apart from the skills.
  const action = (name, sub, run) => {
    const b = itemButton(name, sub, { className: "action", role: "menuitem" });
    b.addEventListener("click", async () => {
      closeSkillsMenu();
      try {
        await run();
      } catch (e) {
        toast(e.message);
      }
    });
    return b;
  };
  const tab = await ctx.activeTab();
  const instant = INSTANT.filter((a) => a.when(tab)).map((a) => action(a.name, a.sub, () => runInstant(a)));
  instant.forEach((b) => b.classList.add("instant"));
  const tools = [
    action("Save images & videos", "Download what's on this page, or attach images", () => state.view !== "media" && showView("media")),
    action("Screenshot this tab", "Attach what's visible right now", async () => addAttachment(await ctx.screenshot())),
    action("Upload a file", "Images, PDFs or text", () => els.fileInput.click()),
    action("Tidy tabs", "Sort loose tabs into named groups, on this Mac (no AI)", () => runTidy(() => tidy.tidy(localStorage.getItem("tidyLevel") || "balanced"))),
    action("Group by site", "One tab group per website", () => runTidy(tidy.bySite)),
    action("Close duplicate tabs", "Keeps the one you're on or used last", () => runTidy(tidy.closeDuplicates)),
  ];
  // Tabs instead of stacked sections, so each group fits without scrolling.
  const groups = [
    { id: "instant", label: "Instant", note: "No tokens: Lumen does these itself", items: instant },
    { id: "tools", label: "Tools", note: "Attach or save things", items: tools },
    { id: "ai", label: "AI skills", note: "Uses tokens: sent to your model", items: [...list.map(item), manage] },
  ];
  let current = groups.find((g) => g.id === localStorage.getItem("menuTab")) || groups[0];
  const bar = document.createElement("div");
  bar.className = "menu-tabs";
  bar.setAttribute("role", "tablist");
  const pill = Object.assign(document.createElement("span"), { className: "menu-tab-pill" });
  const note = Object.assign(document.createElement("div"), { className: "menu-note" });
  const pane = Object.assign(document.createElement("div"), { className: "menu-pane" });
  const tabs = groups.map((g) => {
    const t = Object.assign(document.createElement("button"), { type: "button", className: "menu-tab", textContent: g.label });
    t.setAttribute("role", "tab");
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      show(g);
    });
    return t;
  });
  bar.append(pill, ...tabs);
  const show = (g, first = false) => {
    const dir = groups.indexOf(g) - groups.indexOf(current);
    current = g;
    localStorage.setItem("menuTab", g.id);
    tabs.forEach((t, i) => t.setAttribute("aria-selected", String(groups[i] === g)));
    note.textContent = g.note;
    pane.replaceChildren(...g.items);
    const t = tabs[groups.indexOf(g)];
    motion.slidePill(pill, t.offsetLeft, t.offsetWidth, first);
    if (!first) motion.paneIn(pane.children, dir);
  };
  els.skillsMenu.replaceChildren(bar, note, pane);
  show(current, true);
  // Left/right arrows switch tabs while the menu is open.
  els.skillsMenu.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = (groups.indexOf(current) + (e.key === "ArrowRight" ? 1 : -1) + groups.length) % groups.length;
    show(groups[i]);
  };
  const r = els.skillsBtn.getBoundingClientRect();
  els.skillsMenu.style.top = `${r.bottom + 8}px`;
  els.skillsMenu.style.left = `${Math.max(8, r.left - 6)}px`;
  els.skillsMenu.classList.add("open");
  motion.menuIn(els.skillsMenu);
  els.skillsBtn.classList.add("on");
  els.skillsBtn.setAttribute("aria-expanded", "true");
}

const closeSkillsMenu = () => closeDropdown(els.skillsMenu, els.skillsBtn);

els.skillsBtn.addEventListener("click", () => (els.skillsMenu.classList.contains("open") ? closeSkillsMenu() : openSkillsMenu()));
document.addEventListener("click", (e) => {
  if (!e.target.closest(".skills-wrap, #skills-menu")) closeSkillsMenu();
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
  if (state.pending || state.sending) return;
  const { providerId } = currentModel();
  if (!providerId) return showBanner("Pick a model first: open ⓘ to connect a login or add an API key.");
  if (!text && !state.skill && !state.attachments.length) return;

  state.chat ??= newChatObject();
  const chat = state.chat;
  const edited = state.editIndex != null;
  if (edited) {
    chat.messages = chat.messages.slice(0, state.editIndex);
    chat.needsReplay = true; // the CLI session still holds the old turns
    if (state.editIndex === 0) chat.title = "New chat"; // retitle from the edited question
    cancelEdit();
  }

  // Reading the tab can take a few seconds: block a second send meanwhile, and drop
  // this one if you switch chats before it's ready.
  state.sending = true;
  let built;
  try {
    built = await buildMessage(text);
  } finally {
    state.sending = false;
  }
  if (state.chat !== chat) return;
  const userMsg = { role: "user", display: built.display, prompt: built.prompt, labels: built.labels, attachments: built.attachments, pages: built.pages };
  chat.messages.push(userMsg);
  clearComposerContext();
  if (edited) renderAll();
  else {
    // Add just the new message (re-rendering everything would replay every animation).
    els.empty.hidden = true;
    const el = messageEl(userMsg, chat.messages.length - 1);
    els.messages.append(el);
    motion.popIn(el, { from: 10, scale: 0.9 });
    scrollDown();
  }
  await respond(chat, userMsg, built.sourceTab);
}

// History for API models (and for replaying into a fresh CLI session): the text of
// every earlier turn, merged so roles alternate.
function historyBefore(chat, index) {
  const out = [];
  for (const m of chat.messages.slice(0, index)) {
    const content = m.role === "user" ? m.prompt : m.text;
    if (!content) continue;
    const last = out[out.length - 1];
    if (last?.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  return out;
}

async function respond(chat, userMsg, sourceTab, { retried = false } = {}) {
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
  motion.popIn(el, { from: 6, scale: 0.98 });
  scrollDown();
  const body = el.querySelector(".body");
  let stopThinking = motion.thinking(body);
  const toolBox = el.querySelector(".tools");

  // Read-only browsing: links already in the chat can be opened; others need approval.
  const browse = localStorage.getItem("browse") !== "off";
  const seen = new Set(chat.messages.flatMap((m) => urlsIn(m.role === "user" ? m.prompt : m.text)));
  // Allowing one link allows its whole site for the rest of the chat, and sites you
  // typed yourself (not page text sent along) never ask.
  const sites = new Set([...(chat.sites || []), ...chat.messages.flatMap((m) => (m.role === "user" ? sitesIn(m.display) : []))]);
  const showTools = () => {
    fillTools(toolBox, msg);
    scrollDown();
  };
  const runTool = createRunner({
    seen,
    sites,
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
        const site = siteOf(url);
        const t = { label: `Open ${url}?`, status: "asking", site };
        t.answer = (ok) => {
          if (ok) sites.add(site), (chat.sites = [...new Set([...(chat.sites || []), site])]);
          Object.assign(t, { status: ok ? "done" : "failed", note: ok ? `${site} allowed for this chat` : "not opened", answer: null });
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
    stopThinking?.();
    stopThinking = null;
    fillBody(body, msg);
    scrollDown();
  };

  setBusy(true);
  let stopped = false;
  const finish = async (error) => {
    if (state.pending?.msg !== msg) return; // already finished (e.g. stopped)
    stopThinking?.();
    state.pending = null;
    setBusy(false);
    // A CLI session that can't be resumed (deleted, expired): replay the chat once.
    if (error && resume && !retried && !stopped && !msg.text) {
      chat.messages.splice(chat.messages.indexOf(msg), 1);
      el.remove();
      chat.needsReplay = true;
      return respond(chat, userMsg, sourceTab, { retried: true });
    }
    if (error) msg.error = error;
    else chat.needsReplay = false;
    el.replaceWith(messageEl(msg, chat.messages.indexOf(msg)));
    await persist(chat);
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
      history: resume ? [] : historyBefore(chat, index),
      attachments: (userMsg.attachments || []).filter((a) => a.kind === "image" || a.kind === "pdf"),
    },
    {
      delta: (t) => {
        msg.text += t;
        frame ||= requestAnimationFrame(paint);
      },
      session: (value) => (chat.cliSession = value),
      tool: browse ? runTool : null,
      activity: routerActivity(msg, showTools),
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
  if (state.pending || state.sending) return;
  const chat = state.chat;
  const userIndex = index - 1;
  const userMsg = chat.messages[userIndex];
  if (userMsg?.role !== "user") return;
  const old = chat.messages[index];
  chat.messages = chat.messages.slice(0, index);
  chat.needsReplay = true;
  renderAll();
  respond(chat, userMsg, old?.sourceTabId ? { id: old.sourceTabId, url: old.sourceUrl } : null);
}

function startEdit(index) {
  if (state.pending || state.sending) return;
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
  motion.busy(els.send, busy);
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
let toastId = 0;
// action: { label, run } adds a button (e.g. Undo); such toasts stay up longer.
function toast(text, action) {
  els.toast.textContent = text;
  if (action) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "toast-action", textContent: action.label });
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await action.run();
      } finally {
        hideToast();
      }
    });
    els.toast.append(b);
  }
  els.toast.hidden = false;
  motion.toastIn(els.toast);
  clearTimeout(toastTimer);
  const shown = ++toastId;
  toastTimer = setTimeout(hideToast, action ? 8000 : 2600);
  async function hideToast() {
    clearTimeout(toastTimer);
    await motion.leave(els.toast, { y: 14, scale: 0.92, duration: 200 });
    if (shown !== toastId) return; // a newer toast came up while this one left
    els.toast.hidden = true;
    motion.reset(els.toast);
  }
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
const mediaDeps = () => ({ attach: addAttachment, done: () => showView("media"), toast });
chrome.tabs.onActivated.addListener(() => {
  refreshPageChip();
  if (state.view === "media") renderMedia(mediaDeps()); // follow the tab you switched to
});
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.title || info.status === "complete") refreshPageChip();
  if (info.status === "complete" && state.view === "media" && tabId === (await ctx.activeTab())?.id) renderMedia(mediaDeps(), { keepSelection: true });
});

let chipCount = 0;
function renderChips() {
  els.chips.querySelectorAll(".chip.extra").forEach((c) => c.remove());
  queueMicrotask(() => {
    const chips = els.chips.querySelectorAll(".chip.extra");
    if (chips.length > chipCount) motion.popIn(chips[chips.length - 1], { from: 4, scale: 0.8 });
    chipCount = chips.length;
  });
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
    x.addEventListener("click", async () => {
      x.disabled = true; // a double click would remove the next chip too
      await motion.leave(c, { y: 0, scale: 0.7, duration: 140 });
      onRemove();
    });
    c.append(label, x);
    els.chips.append(c);
  };
  if (state.skill) add(`/${state.skill.name}`, state.skill.prompt, () => ((state.skill = null), renderChips()));
  if (state.quote) add(`“${state.quote.slice(0, 40)}${state.quote.length > 40 ? "…" : ""}”`, state.quote, () => ((state.quote = null), renderChips()));
  state.mentions.forEach((m) => {
    const name = m.type === "tab" ? m.tab.title : `${m.group.title || "Tab group"} (${m.group.tabs.length})`;
    add(`@ ${name}`, name, () => ((state.mentions = state.mentions.filter((x) => x !== m)), renderChips()));
  });
  state.attachments.forEach((a) => {
    add(`${a.kind === "image" ? "🖼" : "📄"} ${a.name}`, a.name, () => ((state.attachments = state.attachments.filter((x) => x !== a)), renderChips()));
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

let menuSeq = 0;
async function updateMenu() {
  const seq = ++menuSeq; // only the latest keystroke's results may open the menu
  const before = els.input.value.slice(0, els.input.selectionStart);
  const skillMatch = before.match(/(?:^|\s)\/([\w-]*)$/);
  const tabMatch = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (skillMatch) {
    const q = skillMatch[1].toLowerCase();
    const items = (await skills.allSkills())
      .filter((s) => !q || skills.slug(s.name).includes(q) || s.id.includes(q))
      .map((s) => ({ kind: "skill", skill: s, title: s.name, sub: s.prompt }));
    if (seq === menuSeq) openMenu("skill", items, before.length - q.length - 1);
  } else if (tabMatch) {
    const q = tabMatch[1].toLowerCase();
    const [tabs, groups] = await Promise.all([ctx.windowTabs(), ctx.tabGroups()]);
    const items = [
      ...groups.map((g) => ({ kind: "group", group: g, title: `${g.title || "Untitled group"} · ${g.tabs.length} tabs`, sub: "Tab group" })),
      ...tabs.map((t) => ({ kind: "tab", tab: t, title: t.title || t.url, sub: new URL(t.url).hostname, icon: t.favIconUrl })),
    ].filter((i) => !q || i.title.toLowerCase().includes(q) || (i.sub || "").toLowerCase().includes(q));
    if (seq === menuSeq) openMenu("tab", items, before.length - q.length - 1);
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
      const row = itemButton(item.title, item.sub || "", { className: i === m.index ? "active" : "", role: "option" });
      if (item.icon) row.prepend(Object.assign(document.createElement("img"), { src: item.icon, alt: "" }));
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
  motion.press(els.send);
  if (state.pending) return stop();
  if (state.sending) return;
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
    items.push(h, ...downloads.map((d) => menuButton(d.name, ctx.formatBytes(d.size), async () => addAttachment(await ctx.fetchAttachment(d.url, d.name)))));
  }
  els.attachMenu.replaceChildren(...items);
  els.attachMenu.hidden = false;
}

function menuButton(title, sub, fn) {
  const b = itemButton(title, sub || "");
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

let lastAction = 0; // startup and the change listener can both see the same action
async function runPendingAction() {
  const { pendingAction: a } = await chrome.storage.session.get("pendingAction");
  if (!a || a.at === lastAction || Date.now() - a.at > 60000) return;
  lastAction = a.at;
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
motion.intro();
// A small squash on every icon button: tactile feedback.
document.querySelectorAll("button.icon").forEach((b) => b.addEventListener("pointerdown", () => motion.press(b)));
refreshPageChip();
renderAll();
runPendingAction();
