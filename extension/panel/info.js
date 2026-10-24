// The ⓘ view: models & keys, skills, PDFs & downloads, and a feature guide, as accordions.

import * as skills from "./skills.js";
import * as ctx from "./context.js";

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

function section(id, title, ...body) {
  const d = el("details", { class: "acc", "data-id": id }, el("summary", {}, title), el("div", { class: "acc-body" }, ...body));
  d.open = open().includes(id);
  d.addEventListener("toggle", () => {
    const ids = new Set(open());
    d.open ? ids.add(id) : ids.delete(id);
    setOpen([...ids]);
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
    return el("div", {}, form, el("a", { class: "key-link", href: p.url, target: "_blank", rel: "noopener" }, keys[p.name] ? "Manage key ↗" : "Get a key ↗"));
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

// ---------- skills ----------

function skillsSection(container, deps) {
  const list = el("div", { class: "skill-list" });
  const name = el("input", { placeholder: "Name, e.g. Tweet thread", maxlength: "40" });
  const prompt = el("textarea", { rows: "3", placeholder: "Prompt. Use {tab}, {selection}, {tabs} and {input}." });
  let editing = null;

  const form = el(
    "form",
    { class: "skill-form", onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim() || !prompt.value.trim()) return;
      await skills.saveSkill({ id: editing, name: name.value.trim(), prompt: prompt.value.trim() });
      editing = null;
      name.value = prompt.value = "";
      submit.textContent = "Add skill";
      draw();
    } },
    name,
    prompt,
  );
  const submit = el("button", { class: "primary" }, "Add skill");
  form.append(submit);

  async function draw() {
    const all = await skills.allSkills();
    list.replaceChildren(
      ...all.map((s) =>
        el(
          "div",
          { class: "skill" },
          el("div", {}, el("strong", {}, `/${skills.slug(s.name)}`), s.custom ? el("span", { class: "tag" }, "yours") : null, el("small", {}, s.prompt)),
          s.custom
            ? el(
                "div",
                { class: "row-actions" },
                el("button", { onclick: () => {
                  editing = s.id;
                  name.value = s.name;
                  prompt.value = s.prompt;
                  submit.textContent = "Save skill";
                  name.focus();
                } }, "Edit"),
                el("button", { onclick: async () => {
                  await skills.deleteSkill(s.id);
                  draw();
                } }, "Delete")
              )
            : null
        )
      )
    );
  }
  draw();
  return [list, el("p", { class: "hint" }, "New skill"), form];
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
              : [size(d.size), new Date(d.time).toLocaleDateString()].filter(Boolean).join(" · "))),
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
    if (items.some((d) => d.active)) setTimeout(() => redrawDownloads === draw && draw(), 1000);
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

const size = (b) => (!b ? "" : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// ---------- render ----------

export function renderInfo(container, deps) {
  const scroll = container.scrollTop;
  container.replaceChildren(
    section("models", "Models & keys",
      browseToggle(),
      el("h3", {}, "API keys"), ...keysSection(deps),
      el("h3", {}, "Login providers"), ...loginsSection(deps)),
    section("skills", "Skills", ...skillsSection(container, deps)),
    section("downloads", "PDFs & downloads", ...downloadsSection(deps)),
    section("guide", "Features & guide",
      el("dl", { class: "guide" }, ...GUIDE.flatMap(([t, d]) => [el("dt", {}, t), el("dd", {}, d)]))),
    section("about", "About",
      el("p", {}, `Lumen ${chrome.runtime.getManifest().version}. Your chats, keys and history stay on this Mac; questions go only to the model you pick.`),
      el("p", {}, el("a", { href: "https://github.com/MarcusLai07/lumen", target: "_blank", rel: "noopener" }, "Source code ↗")))
  );
  container.scrollTop = scroll;
}
