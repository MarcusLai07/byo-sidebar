// The ⓘ view: models & keys, skills, PDFs & downloads, and a feature guide, as accordions.

import * as skills from "./skills.js";
import * as ctx from "./context.js";
import * as motion from "./motion.js";
import { makeSortable } from "./sortable.js";

const KEY_PROVIDERS = [
  { name: "anthropic", label: "Anthropic", placeholder: "sk-ant-…", url: "https://console.anthropic.com/settings/keys" },
  { name: "openai", label: "OpenAI", placeholder: "sk-…", url: "https://platform.openai.com/api-keys" },
  { name: "gemini", label: "Gemini", placeholder: "AIza…", url: "https://aistudio.google.com/apikey" },
  { name: "deepseek", label: "DeepSeek", placeholder: "sk-…", url: "https://platform.deepseek.com/api_keys" },
];

const GUIDE = [
  ["Ask about the page", "Your current tab is included automatically. Click its chip above the box to leave it out. Highlighted text is sent too."],
  ["Skills & actions", "Click ⚡ next to the model for skills (Summarize, Copy edit, Timestamps…) and actions like saving the page's images and videos. Or type / for skills. Make your own under Skills."],
  ["Other tabs", "Type @ to add another tab, or a whole tab group, to your question."],
  ["Attachments", "Use the paperclip to upload images, PDFs or text files, screenshot the tab, or pick a recent download. You can also paste images."],
  ["PDFs", "Open a PDF in a tab and ask about it: the sidebar sends the PDF itself."],
  ["Videos", "Timestamps in answers are links: click one to jump the video. On YouTube, open “Show transcript” under the video for answers based on the full captions."],
  ["Right-click", "Select text and right-click → Lumen to explain, translate or copy-edit it. Right-click an image to ask about it."],
  ["Address bar", "Type ai, a space, then your question in the address bar."],
  ["Edit & regenerate", "Hover a message to edit your question or regenerate the answer. You can switch models mid-chat."],
  ["History", "Every chat is saved on this Mac. Open the clock to search and reopen them."],
  ["Media strip", "Tabs playing (or paused) audio or video get a mini player above the box: play/pause, skip, seek, mute. Two or more show side by side. ⌄ minimizes them to small tabs; click one to open just that player. ✕ pauses it and hides it until it plays again."],
  ["Shortcut", "Set a keyboard shortcut in your browser's extensions → Keyboard shortcuts page. In Dia, move Dia's own Chat shortcut first (Settings → Shortcuts)."],
  ["Browsing", "The chat can read your other tabs, follow links (opened in a background tab and closed after) and load more YouTube comments when it needs more to answer. Read-only: it never clicks or types. Turn it off under Models & keys."],
  ["Tech stack", "⚡ → Detect tech stack lists the page's frameworks, CMS, analytics, hosting and more. It runs on this device with no AI, so it costs no tokens; ask a follow-up and the model sees the list."],
  ["Voice", "Click the mic to dictate. Some browsers don't include speech recognition."],
];

const open = () => JSON.parse(localStorage.getItem("infoOpen") || '["models"]');
const setOpen = (ids) => localStorage.setItem("infoOpen", JSON.stringify(ids));

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v != null) e.setAttribute(k, v);
  }
  e.append(...children.flat().filter((c) => c != null));
  return e;
}

const CHEVRON = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';

function section(id, title, ...body) {
  const summary = el("summary", {}, el("span", {}, title));
  summary.insertAdjacentHTML("beforeend", CHEVRON);
  const content = el("div", { class: "acc-body" }, ...body);
  const d = el("details", { class: "acc", "data-id": id }, summary, content);
  d.open = open().includes(id);
  // Animate instead of the instant native toggle: open, then grow; shrink, then close.
  let busy = false;
  summary.addEventListener("click", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const opening = !d.open;
    if (opening) {
      d.open = true;
      await motion.expand(content);
    } else {
      d.classList.add("closing");
      await motion.collapse(content);
      d.open = false;
      d.classList.remove("closing");
    }
    const ids = new Set(open());
    opening ? ids.add(id) : ids.delete(id);
    setOpen([...ids]);
    busy = false;
  });
  return d;
}

// ---------- models & keys ----------

function keysSection({ keys, post }) {
  const rows = KEY_PROVIDERS.map((p) => {
    const input = el("input", { type: "password", placeholder: keys[p.name] ? "•••••• saved" : p.placeholder, autocomplete: "off" });
    const form = el(
      "form",
      { class: "key-row", onsubmit: (e) => {
        e.preventDefault();
        post({ type: "setKey", name: p.name, value: input.value });
        input.value = "";
        input.placeholder = "saving…";
      } },
      el("label", {}, p.label),
      input,
      el("button", {}, "Save")
    );
    return el("div", {}, form, el("a", { class: "key-link", href: p.url, target: "_blank", rel: "noopener" }, keys[p.name] ? "Manage key " : "Get a key ", el("span", { class: "ne" }, "↗")));
  });
  return [
    el("p", { class: "hint" }, "Stored only on this Mac in ~/.config/lumen/config.json. Save an empty box to remove a key."),
    ...rows,
  ];
}

function loginsSection({ logins, post }) {
  const code = (t) => el("code", {}, t);
  return [
    el("p", { class: "hint" }, "Use an account you're already signed in to, with no key. Nothing is used until you connect it. Disconnecting only stops this sidebar using it."),
    ...logins.map((l) => {
      const live = l.connected && l.account;
      const detail = el("div", { class: "detail" });
      if (!l.installed) detail.append("Not installed: ", code(l.install));
      else if (!l.account) detail.append("Not signed in. In Terminal run ", code(l.signIn), ", then reopen this panel.");
      else detail.append(l.connected ? `Using ${l.account}` : `Signed in as ${l.account}`);
      const row = el("div", { class: `login-row${live ? " connected" : ""}` }, el("div", { class: "name" }, el("span", { class: "dot" }, "●"), l.name), detail);
      if ((l.installed && l.account) || l.connected) {
        const on = !l.connected;
        row.append(el("button", { class: on ? "primary" : "", onclick: (e) => {
          e.currentTarget.disabled = true;
          post({ type: "connect", provider: l.id, on });
        } }, on ? "Connect" : "Disconnect"));
      }
      return row;
    }),
  ];
}

function browseToggle() {
  const box = el("input", { type: "checkbox" });
  box.checked = localStorage.getItem("browse") !== "off";
  box.addEventListener("change", () => localStorage.setItem("browse", box.checked ? "on" : "off"));
  return el("label", { class: "toggle" }, box,
    el("span", {}, el("strong", {}, "Let the chat browse (read-only)"),
      el("small", {}, "It can list and read your tabs, open links in a background tab, and load more YouTube comments. It never clicks or types. Links that haven't appeared in the chat ask first. Works with Claude Code and API-key models.")));
}

// ---------- tidy tabs ----------

const TIDY_LEVELS = [
  ["broad", "Broad", "A few big groups first (Dev, Video, Shopping…), then topics and sites."],
  ["balanced", "Balanced", "Topics shared by several tabs, then sites, then kinds of site."],
  ["specific", "Specific", "Only close matches: shared topics and same-site tabs."],
];

function tidySection() {
  const bar = el("div", { class: "media-filter tidy-levels", role: "group", "aria-label": "How fine the groups are" });
  const note = el("p", { class: "hint" });
  const draw = () => {
    const current = localStorage.getItem("tidyLevel") || "balanced";
    bar.replaceChildren(...TIDY_LEVELS.map(([id, label]) =>
      el("button", { type: "button", class: id === current ? "on" : "", "aria-pressed": String(id === current), onclick: () => (localStorage.setItem("tidyLevel", id), draw()) }, label)));
    note.textContent = TIDY_LEVELS.find(([id]) => id === current)[2];
  };
  draw();
  return [
    el("p", { class: "hint" }, "⚡ → Tools → Tidy tabs sorts this window's loose tabs into named groups, worked out on this Mac from their titles and sites (no AI, no tokens). Pinned tabs, grouped tabs, and mail, calendar and chat stay where they are. Every tidy can be undone."),
    bar,
    note,
  ];
}

// ---------- skills ----------

function skillsSection() {
  const list = el("div", { class: "skill-list" });
  const restore = el("div", { class: "skill-restore" });
  const name = el("input", { placeholder: "Name, e.g. Tweet thread", maxlength: "40" });
  const prompt = el("textarea", { rows: "3", placeholder: "Prompt. Use {tab}, {selection}, {tabs} and {input}." });
  const form = el(
    "form",
    { class: "skill-form", onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim() || !prompt.value.trim()) return;
      await skills.saveSkill({ name: name.value.trim(), prompt: prompt.value.trim() });
      name.value = prompt.value = "";
      await draw();
      motion.popIn(list.lastElementChild, { from: 6 });
    } },
    name,
    prompt,
    el("button", { class: "primary" }, "Add skill")
  );

  // Drag the ⋮⋮ grip (or focus it and press ↑/↓) to reorder; the ⚡ and / menus follow.
  makeSortable(list, { itemSel: ".skill", handleSel: ".grip", onChange: (ids) => skills.saveOrder(ids) });

  // Edit in place: the row turns into a small form.
  function editRow(row, s) {
    const n = el("input", { value: s.name, maxlength: "40" });
    const p = el("textarea", { rows: "4" });
    p.value = s.prompt;
    const done = () => draw();
    const f = el(
      "form",
      { class: "skill-form inline", onsubmit: async (e) => {
        e.preventDefault();
        if (!n.value.trim() || !p.value.trim()) return;
        await skills.saveSkill({ ...s, name: n.value.trim(), prompt: p.value.trim() });
        done();
      } },
      n,
      p,
      el("div", { class: "row-actions" }, el("button", { type: "button", onclick: done }, "Cancel"), el("button", { class: "primary" }, "Save"))
    );
    row.replaceChildren(f);
    motion.popIn(f, { from: 4, scale: 0.98 });
    n.focus();
  }

  function row(s) {
    const r = el("div", { class: "skill", "data-id": s.id });
    const grip = el("button", { class: "grip", type: "button", title: "Drag to reorder (or focus and press ↑/↓)", "aria-label": `Move ${s.name}` }, "⋮⋮");
    const tags = [s.custom ? el("span", { class: "tag" }, "yours") : null, s.edited ? el("span", { class: "tag" }, "edited") : null];
    const info = el("div", { class: "skill-info" }, el("div", { class: "skill-name" }, el("strong", {}, `/${skills.slug(s.name)}`), ...tags), el("small", {}, s.prompt));
    let armed = 0;
    const del = el("button", { title: s.builtin ? "Hide this built-in skill (you can restore it)" : "Delete this skill" }, "Delete");
    del.addEventListener("click", async () => {
      if (!armed) {
        // First click arms it; a second within 3 seconds deletes.
        del.textContent = "Delete?";
        del.classList.add("danger");
        armed = setTimeout(() => {
          armed = 0;
          del.textContent = "Delete";
          del.classList.remove("danger");
        }, 3000);
        return;
      }
      clearTimeout(armed);
      await motion.leave(r, { x: -12, y: 0, scale: 0.97, duration: 180 });
      await skills.deleteSkill(s.id);
      draw();
    });
    const actions = el(
      "div",
      { class: "row-actions" },
      s.edited ? el("button", { title: "Back to the original", onclick: async () => (await skills.resetSkill(s.id), draw()) }, "Reset") : null,
      el("button", { onclick: () => editRow(r, s) }, "Edit"),
      del
    );
    r.append(grip, info, actions);
    return r;
  }

  async function draw() {
    const [all, hidden] = await Promise.all([skills.allSkills(), skills.hiddenBuiltins()]);
    list.replaceChildren(...all.map(row));
    restore.replaceChildren(
      ...(hidden.length
        ? [el("button", { class: "link", onclick: async () => (await skills.restoreBuiltins(), draw()) }, `Restore ${hidden.length} hidden built-in skill${hidden.length === 1 ? "" : "s"}`)]
        : [])
    );
  }
  draw();
  return [el("p", { class: "hint" }, "Drag ⋮⋮ to reorder; the ⚡ menu and / follow this order."), list, restore, el("p", { class: "hint" }, "New skill"), form];
}

// ---------- downloads ----------

// Redraws the downloads list whenever a download starts, progresses or finishes.
let redrawDownloads = null;
let pending = 0;
const scheduleRedraw = () => {
  clearTimeout(pending);
  pending = setTimeout(() => redrawDownloads?.(), 250);
};
if (chrome.downloads?.onChanged) {
  chrome.downloads.onCreated.addListener(scheduleRedraw);
  chrome.downloads.onChanged.addListener(scheduleRedraw);
  chrome.downloads.onErased?.addListener(scheduleRedraw);
}

function downloadsSection({ attach, toast }) {
  let tick = 0;
  const list = el("div", { class: "download-list" }, el("p", { class: "hint" }, "Loading…"));
  const draw = async () => {
    const items = await ctx.recentDownloads(12, { includeActive: true }).catch(() => []);
    if (!items.length) return list.replaceChildren(el("p", { class: "hint" }, "No recent PDFs, images or text downloads."));
    list.replaceChildren(
      ...items.map((d) =>
        el(
          "div",
          { class: `download${d.active ? " active" : ""}` },
          el("div", {},
            el("strong", {}, d.name),
            el("small", {}, d.active
              ? `Downloading${d.progress != null ? ` ${Math.floor(d.progress * 100)}%` : "…"}`
              : [ctx.formatBytes(d.size), new Date(d.time).toLocaleDateString()].filter(Boolean).join(" · "))),
          d.active
            ? null
            : el("div", { class: "row-actions" },
                el("button", { onclick: () => chrome.downloads.open(d.id) }, "Open"),
                el("button", { class: "primary", onclick: async () => {
                  try {
                    attach(await ctx.fetchAttachment(d.url, d.name));
                    toast(`Attached ${d.name}`);
                  } catch (e) {
                    toast(e.message);
                  }
                } }, "Attach"))
        )
      )
    );
    // Keep a running download's percentage moving even between change events.
    // One timer at a time, however many events trigger a redraw.
    clearTimeout(tick);
    if (items.some((d) => d.active)) tick = setTimeout(() => redrawDownloads === draw && draw(), 1000);
  };
  redrawDownloads = draw;
  draw();
  return [
    el("div", { class: "hint-row" },
      el("p", { class: "hint" }, "Attach a recent download to your next message. The list updates as downloads finish."),
      el("button", { class: "refresh", title: "Refresh", "aria-label": "Refresh downloads", onclick: draw }, "↻")),
    list,
  ];
}

// ---------- render ----------

export function renderInfo(container, deps) {
  const scroll = container.scrollTop;
  container.replaceChildren(
    section("models", "Models & keys",
      browseToggle(),
      el("h3", {}, "API keys"), ...keysSection(deps),
      el("h3", {}, "Login providers"), ...loginsSection(deps)),
    section("skills", "Skills", ...skillsSection()),
    section("downloads", "PDFs & downloads", ...downloadsSection(deps)),
    section("tidy", "Tidy tabs", ...tidySection()),
    section("guide", "Features & guide",
      el("dl", { class: "guide" }, ...GUIDE.flatMap(([t, d]) => [el("dt", {}, t), el("dd", {}, d)]))),
    section("about", "About",
      el("p", {}, `Lumen ${chrome.runtime.getManifest().version}. Your chats, keys and history stay on this Mac; questions go only to the model you pick.`),
      el("p", {}, el("a", { class: "key-link", href: "https://github.com/MarcusLai07/lumen", target: "_blank", rel: "noopener" }, "Source code ", el("span", { class: "ne" }, "↗"))))
  );
  container.scrollTop = scroll;
}
