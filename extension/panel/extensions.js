// The extensions view: every extension installed in this browser, with on/off,
// options, details and remove. Uses chrome.management; removing always goes through
// the browser's own confirmation dialog.

const view = document.getElementById("extensions-view");
const search = document.getElementById("ext-search");
const list = document.getElementById("ext-list");
const count = document.getElementById("ext-count");

let all = [];
let onChange = () => {};

const iconOf = (e) => (e.icons?.length ? [...e.icons].sort((a, b) => b.size - a.size)[0].url : "");

function row(e) {
  const self = e.id === chrome.runtime.id;
  const r = document.createElement("div");
  r.className = `ext-row${e.enabled ? "" : " off"}`;

  const icon = document.createElement("img");
  icon.className = "ext-icon";
  icon.alt = "";
  const src = iconOf(e);
  if (src) icon.src = src;

  const info = document.createElement("div");
  info.className = "ext-info";
  const name = document.createElement("strong");
  name.textContent = e.name;
  const sub = document.createElement("small");
  sub.textContent = [
    `v${e.version}`,
    e.installType === "development" ? "unpacked" : e.installType === "admin" ? "managed" : "",
    self ? "this extension" : "",
  ].filter(Boolean).join(" · ");
  info.append(name, sub);

  const actions = document.createElement("div");
  actions.className = "ext-actions";
  const btn = (label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", fn);
    return b;
  };
  if (e.optionsUrl) actions.append(btn("⚙", "Options", () => chrome.tabs.create({ url: e.optionsUrl })));
  actions.append(btn("ⓘ", "Details", () => chrome.tabs.create({ url: `chrome://extensions/?id=${e.id}` })));
  if (!self && e.mayDisable) {
    actions.append(btn("🗑", "Remove…", () => chrome.management.uninstall(e.id, { showConfirmDialog: true }).catch(() => {})));
  }

  // On/off switch (the panel can't switch itself off).
  const toggle = document.createElement("label");
  toggle.className = "switch";
  toggle.title = self ? "Lumen can't switch itself off here" : e.enabled ? "Turn off" : "Turn on";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = e.enabled;
  box.disabled = self || !e.mayDisable;
  box.addEventListener("change", async () => {
    try {
      await chrome.management.setEnabled(e.id, box.checked);
    } catch {
      box.checked = !box.checked;
    }
  });
  toggle.append(box, document.createElement("span"));
  actions.append(toggle);

  r.append(icon, info, actions);
  return r;
}

function draw() {
  const q = search.value.trim().toLowerCase();
  const shown = all.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q));
  const on = shown.filter((e) => e.enabled);
  const off = shown.filter((e) => !e.enabled);
  const heading = (t) => Object.assign(document.createElement("div"), { className: "ext-heading", textContent: t });
  count.textContent = `${all.filter((e) => e.enabled).length} on · ${all.filter((e) => !e.enabled).length} off`;
  list.replaceChildren(
    ...(on.length ? [heading("On"), ...on.map(row)] : []),
    ...(off.length ? [heading("Off"), ...off.map(row)] : []),
    ...(!shown.length ? [Object.assign(document.createElement("p"), { className: "hint", textContent: "No extensions match." })] : [])
  );
  onChange(list);
}

async function load() {
  const items = await chrome.management.getAll();
  all = items.filter((e) => e.type === "extension").sort((a, b) => a.name.localeCompare(b.name));
  draw();
}

search.addEventListener("input", draw);
document.getElementById("ext-store").addEventListener("click", () => chrome.tabs.create({ url: "https://chromewebstore.google.com/category/extensions" }));
document.getElementById("ext-page").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/" }));

if (chrome.management?.onEnabled) {
  for (const ev of ["onInstalled", "onUninstalled", "onEnabled", "onDisabled"]) {
    chrome.management[ev].addListener(() => !view.hidden && load());
  }
}

// changed(list) is called after each redraw (the panel animates the rows in).
export function renderExtensions({ changed } = {}) {
  onChange = changed || (() => {});
  search.value = "";
  return load();
}
