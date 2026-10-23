// The history view: search, reopen and delete saved chats.

import * as db from "./db.js";

const search = document.getElementById("history-search");
const list = document.getElementById("history-list");
let handlers = {};
let chats = [];

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return new Date(t).toLocaleDateString();
};

function matches(chat, q) {
  if (!q) return true;
  if (chat.title.toLowerCase().includes(q)) return true;
  return chat.messages.some((m) => (m.display || m.text || "").toLowerCase().includes(q));
}

function snippet(chat, q) {
  const hit = q && chat.messages.find((m) => (m.display || m.text || "").toLowerCase().includes(q));
  const text = (hit?.display || hit?.text || chat.messages.find((m) => m.role === "assistant")?.text || "").replace(/\s+/g, " ");
  if (!q || !hit) return text.slice(0, 90);
  const i = text.toLowerCase().indexOf(q);
  return (i > 30 ? "…" : "") + text.slice(Math.max(0, i - 30), i + 60);
}

function draw() {
  const q = search.value.trim().toLowerCase();
  const shown = chats.filter((c) => matches(c, q));
  if (!shown.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = chats.length ? "No chats match." : "No saved chats yet.";
    return list.replaceChildren(p);
  }
  list.replaceChildren(
    ...shown.map((chat) => {
      const row = document.createElement("div");
      row.className = `history-item${chat.id === handlers.currentId ? " current" : ""}`;
      const main = document.createElement("button");
      main.className = "open";
      const title = document.createElement("strong");
      title.textContent = chat.title;
      const sub = document.createElement("small");
      const n = chat.messages.filter((m) => m.role === "user").length;
      sub.textContent = `${ago(chat.updatedAt)} · ${n} message${n === 1 ? "" : "s"}`;
      const snip = document.createElement("span");
      snip.textContent = snippet(chat, q);
      main.append(title, snip, sub);
      main.addEventListener("click", () => handlers.onOpen(chat.id));
      const del = document.createElement("button");
      del.className = "delete";
      del.title = "Delete chat";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        await db.deleteChat(chat.id);
        chats = chats.filter((c) => c.id !== chat.id);
        draw();
      });
      row.append(main, del);
      return row;
    })
  );
}

search.addEventListener("input", draw);

export async function renderHistory(h) {
  handlers = h;
  chats = await db.listChats();
  draw();
  search.focus();
}
