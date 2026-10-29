// The pull requests view: your open PRs across every gh account, refreshed in the
// background (prs-worker.js) and read here from storage. Click one to open it (or
// jump to the tab already showing it).

const list = document.getElementById("prs-list");
const updated = document.getElementById("prs-updated");
const refresh = document.getElementById("prs-refresh");
const settingsBox = document.getElementById("prs-settings");

const GROUPS = [
  ["review", "Review requested"],
  ["mine", "Yours"],
  ["assigned", "Assigned to you"],
];
const CI = { pass: ["✓", "Checks passed"], fail: ["✕", "Checks failed"], pending: ["●", "Checks running"] };
const REVIEW = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "needs review" };
const SETTINGS = [
  ["notify", "Notify me about new review requests"],
  ["autoOpen", "Open new review requests in a “PRs” tab group"],
  ["autoClose", "Close those tabs when the PR is merged or closed"],
];
const DEFAULTS = { notify: true, autoOpen: false, autoClose: true };

let onChange = () => {};

const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};

// A color per repo, so PRs from the same repo are easy to pick out. Handed out in
// alphabetical order of the repos listed: different for up to 8 repos, and steady
// while the same repos have open PRs.
const REPO_COLORS = ["#d97757", "#7c5cff", "#38bdf8", "#34c759", "#f59e0b", "#ec4899", "#14b8a6", "#a3a3ff"];
let colors = new Map();
const repoColor = (repo) => colors.get(repo) || REPO_COLORS[0];

// "owner/repo#123" for any page of a PR, ignoring case (same as prs-worker.js).
const prKey = (url) => {
  const m = String(url || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/i);
  return m ? `${m[1]}/${m[2]}#${m[3]}`.toLowerCase() : null;
};
async function openKeys() {
  const tabs = await chrome.tabs.query({ url: "https://github.com/*" }).catch(() => []);
  return new Set(tabs.map((t) => prKey(t.url || t.pendingUrl)).filter(Boolean));
}

function row(pr, open) {
  const r = document.createElement("button");
  r.type = "button";
  r.className = "ext-row pr-row";
  r.style.setProperty("--repo", repoColor(pr.repo));
  r.title = open ? `${pr.url}\nOpen in a tab: click to go there` : pr.url;
  const [mark, label] = CI[pr.ci] || ["", "No checks"];
  const ci = Object.assign(document.createElement("span"), { className: `pr-ci ${pr.ci || "none"}`, textContent: mark, title: label });
  const info = document.createElement("div");
  info.className = "ext-info";
  const name = document.createElement("strong");
  name.textContent = pr.title;
  const sub = document.createElement("small");
  sub.textContent = [
    `#${pr.number}`,
    pr.group !== "mine" && pr.author,
    pr.draft ? "draft" : REVIEW[pr.review],
    ago(pr.updatedAt),
  ].filter(Boolean).join(" · ");
  info.append(name, sub);
  const side = document.createElement("span");
  side.className = "pr-side";
  if (open) side.append(Object.assign(document.createElement("span"), { className: "pr-open", textContent: "Open" }));
  r.append(ci, info, side);
  r.addEventListener("click", () => chrome.runtime.sendMessage({ type: "prs:open", url: pr.url }));
  return r;
}

// One repo within a section: its name (and account, with more than one) over its PRs.
function repoBlock(repo, prs, open, showAccount) {
  const head = document.createElement("div");
  head.className = "pr-repo";
  head.style.setProperty("--repo", repoColor(repo));
  const [owner, name] = repo.split("/");
  const label = document.createElement("span");
  label.append(Object.assign(document.createElement("span"), { className: "pr-repo-owner", textContent: `${owner}/` }), Object.assign(document.createElement("strong"), { textContent: name }));
  head.append(
    Object.assign(document.createElement("span"), { className: "pr-repo-dot" }),
    label,
    Object.assign(document.createElement("span"), { className: "pr-repo-account", textContent: showAccount ? prs[0].account : "" })
  );
  return [head, ...prs.map((p) => row(p, open.has(prKey(p.url))))];
}

async function draw() {
  const [{ prState: s }, open] = await Promise.all([chrome.storage.local.get("prState"), openKeys()]);
  const hint = (text) => Object.assign(document.createElement("p"), { className: "hint", textContent: text });
  const since = s?.checkedAt && Date.now() - s.checkedAt;
  updated.textContent = !s?.checkedAt ? "" : since < 60000 ? "Checked just now" : `Checked ${ago(new Date(s.checkedAt).toISOString())} ago`;
  if (!s) return list.replaceChildren(hint("Checking GitHub…"));
  if (s.error && !s.items) return list.replaceChildren(hint(`Couldn't read your pull requests: ${s.error}`));
  const showAccount = (s.accounts || []).length > 1;
  colors = new Map([...new Set(s.items.map((p) => p.repo))].sort().map((r, i) => [r, REPO_COLORS[i % REPO_COLORS.length]]));
  const sections = GROUPS.flatMap(([id, title]) => {
    const items = s.items.filter((p) => p.group === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!items.length) return [];
    // Repos in order of their latest change; PRs newest first within each.
    const byRepo = new Map();
    for (const p of items) byRepo.set(p.repo, [...(byRepo.get(p.repo) || []), p]);
    const heading = Object.assign(document.createElement("div"), { className: "ext-heading", textContent: `${title} · ${items.length}` });
    return [heading, ...[...byRepo].flatMap(([repo, prs]) => repoBlock(repo, prs, open, showAccount))];
  });
  const notes = [
    ...(s.error ? [hint(`Last check failed: ${s.error}`)] : []),
    ...(s.errors || []).map((e) => hint(e)),
  ];
  list.replaceChildren(...(sections.length ? sections : [hint("No open pull requests. 🎉")]), ...notes);
  onChange(list);
}

async function drawSettings() {
  const { prSettings: saved = {} } = await chrome.storage.local.get("prSettings");
  const settings = { ...DEFAULTS, ...saved };
  settingsBox.replaceChildren(
    ...SETTINGS.map(([key, text]) => {
      const label = document.createElement("label");
      label.className = "pr-setting";
      const sw = document.createElement("span");
      sw.className = "switch";
      const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: settings[key] });
      box.addEventListener("change", async () => {
        settings[key] = box.checked;
        await chrome.storage.local.set({ prSettings: settings });
      });
      sw.append(box, document.createElement("span"));
      label.append(Object.assign(document.createElement("span"), { textContent: text }), sw);
      return label;
    })
  );
}

async function check() {
  refresh.classList.add("spinning");
  await chrome.runtime.sendMessage({ type: "prs:refresh" }).catch(() => {});
  refresh.classList.remove("spinning");
}

refresh.addEventListener("click", check);
const visible = () => !list.closest(".view").hidden;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.prState && visible()) draw();
});
// Keep the "Open" marks current as PR tabs open and close.
let redraw = 0;
const soon = () => visible() && (clearTimeout(redraw), (redraw = setTimeout(draw, 300)));
chrome.tabs.onUpdated.addListener((_, info) => info.url && soon());
chrome.tabs.onRemoved.addListener(soon);

// changed(list) is called after each redraw (the panel animates the rows in).
export async function renderPrs({ changed } = {}) {
  onChange = changed || (() => {});
  drawSettings();
  await draw();
  // Older than a minute: check now (the result redraws through storage).
  const { prState: s } = await chrome.storage.local.get("prState");
  if (!s?.checkedAt || Date.now() - s.checkedAt > 60000) check();
}

// Review requests waiting, for the header button's badge.
export async function reviewCount() {
  const { prState: s } = await chrome.storage.local.get("prState");
  return (s?.items || []).filter((p) => p.group === "review").length;
}
