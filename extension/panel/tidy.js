// Tidy tabs without AI (no tokens): loose tabs go into named, colored tab groups.
//   tidy:        by topic. Words that several tabs' titles (and repo names) share
//                become groups ("Japan Trip"); then tabs on the same site; then
//                broad kinds of site (Dev, Shopping, Video…).
//   bySite:      one group per site.
//   duplicates:  closes extra copies of the same page.
// Pinned tabs, tabs already in a group (Dia's sidebar folders count: extensions see
// them as groups), everyday tools (mail, calendar, chat) and anything on your
// Never-tidy list are left alone; re-tidying adds new tabs to a matching group by
// name. Each action returns { summary, undo }.
//
// Never tidy: Dia's favorites look exactly like ordinary tabs to extensions, so you
// mark them (right-click → Lumen → Never tidy this tab / site, or ⓘ → Tidy tabs).
// A tab is kept by its id while it's open (storage.session: neverTidyTabs) and by
// its address for next time (storage.local: neverTidy.pages); a site by host
// (neverTidy.sites), including its subdomains.

const KEEP_LOOSE = /^(mail\.google|calendar\.google|web\.whatsapp|app\.slack|outlook\.(live|office)|teams\.microsoft|discord|messenger|web\.telegram|meet\.google)\./;

const SITE_NAMES = {
  "github.com": "GitHub", "youtube.com": "YouTube", "stackoverflow.com": "Stack Overflow", "reddit.com": "Reddit", "x.com": "X",
  "twitter.com": "X", "linkedin.com": "LinkedIn", "facebook.com": "Facebook", "instagram.com": "Instagram", "amazon.com": "Amazon",
  "shopee.com.my": "Shopee", "lazada.com.my": "Lazada", "netflix.com": "Netflix", "figma.com": "Figma", "notion.so": "Notion",
  "vercel.com": "Vercel", "npmjs.com": "npm", "developer.mozilla.org": "MDN", "claude.ai": "Claude", "chatgpt.com": "ChatGPT",
  "docs.google.com": "Google Docs", "drive.google.com": "Google Drive", "sheets.google.com": "Google Sheets", "wikipedia.org": "Wikipedia",
  "medium.com": "Medium", "localhost": "Localhost",
};

const CATEGORIES = {
  Dev: /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|stackoverflow\.com|stackexchange\.com|npmjs\.com|vercel\.com|netlify\.app|supabase\.com|neon\.tech|developer\.mozilla\.org|pypi\.org|docker\.com|cloud\.google\.com|console\.aws\.amazon\.com|localhost|127\.0\.0\.1|trigger\.dev|render\.com|railway\.app|codepen\.io|jsfiddle\.net)$/,
  AI: /(^|\.)(claude\.ai|chatgpt\.com|openai\.com|anthropic\.com|gemini\.google\.com|perplexity\.ai|huggingface\.co|aistudio\.google\.com)$/,
  Video: /(^|\.)(youtube\.com|twitch\.tv|netflix\.com|vimeo\.com|disneyplus\.com|primevideo\.com|beinsports\.com|f1tv\.formula1\.com|bilibili\.com)$/,
  Shopping: /(^|\.)(amazon\.[a-z.]+|shopee\.[a-z.]+|lazada\.[a-z.]+|ebay\.[a-z.]+|aliexpress\.com|taobao\.com|ikea\.com|zalora\.[a-z.]+)$/,
  Social: /(^|\.)(x\.com|twitter\.com|reddit\.com|facebook\.com|instagram\.com|linkedin\.com|threads\.net|tiktok\.com|bsky\.app)$/,
  Docs: /(^|\.)(docs\.google\.com|sheets\.google\.com|slides\.google\.com|drive\.google\.com|notion\.so|dropbox\.com|confluence\.[a-z.]+|atlassian\.net|figma\.com|miro\.com|canva\.com)$/,
  News: /(^|\.)(bbc\.co\.uk|bbc\.com|cnn\.com|nytimes\.com|theguardian\.com|reuters\.com|bloomberg\.com|thestar\.com\.my|malaymail\.com|straitstimes\.com|techcrunch\.com|theverge\.com|news\.ycombinator\.com)$/,
  Travel: /(^|\.)(booking\.com|airbnb\.[a-z.]+|agoda\.com|expedia\.[a-z.]+|tripadvisor\.[a-z.]+|skyscanner\.[a-z.]+|klook\.com|google\.com\/travel)$/,
};

const STOP = new Set(
  ("the and for with from your you are this that how what why when who into about over not all new use using our out get can has have was were will " +
    "home page login log sign signin dashboard untitled welcome official site website video videos watch search results google tab tabs " +
    "pull request requests issue issues commit commits files changed blob tree main master readme docs documentation guide " +
    "free best top online app apps vs via com www http https html php inbox view edit settings").split(" ")
);

const COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const colorFor = (name) => COLORS[[...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const titleCase = (s) => s.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// "github.com", "bbc.co.uk", "docs.google.com" (Google's apps stay apart).
function siteOf(host) {
  if (/\.google\.com$/.test(host)) return host;
  const parts = host.split(".");
  const n = parts.length > 2 && /^(co|com|net|org|gov|edu|ac)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-n).join(".");
}

const siteName = (site) => SITE_NAMES[site] || titleCase(site.split(".")[0]);

// The words of a tab: its title without the site's name and counters like "(38)",
// plus the repo or project name from GitHub/GitLab paths.
function wordsOf(tab, site) {
  let title = (tab.title || "").replace(/^\(\d+\+?\)\s*/, "");
  const parts = title.split(/\s+[-–—|·•]\s+/);
  const label = siteName(site).toLowerCase();
  if (parts.length > 1 && (parts.at(-1).toLowerCase().includes(label) || parts.at(-1).split(/\s+/).length <= 2)) parts.pop();
  title = parts.join(" ");
  const words = new Set();
  for (const w of title.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'+#.]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu) || []) {
    // Light stemming so "desks"/"desk" and "reactjs"/"react" count as one word.
    const word = w.replace(/'s$/, "").replace(/^(.{4,})js$/, "$1").replace(/^(.{3,}[^s])s$/, "$1");
    const cjk = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(word);
    if ((cjk ? word.length >= 2 : word.length >= 3) && !STOP.has(word) && !/^\d+$/.test(word) && word !== label && !site.startsWith(word + ".")) words.add(word);
  }
  try {
    const path = new URL(tab.url).pathname.split("/").filter(Boolean);
    if (/^(github\.com|gitlab\.com)$/.test(site) && path[1]) words.add(path[1].toLowerCase());
  } catch {}
  return words;
}

// Planned groups for a window's tabs: [{ title, tabIds, groupId? }], where groupId
// means "add to this existing group". level: "broad" | "balanced" | "specific".
export function plan(tabs, groups = [], level = "balanced", kept = () => false) {
  const loose = tabs
    .filter((t) => !t.pinned && (t.groupId == null || t.groupId === -1) && /^https?:/.test(t.url || "") && !kept(t))
    .map((t) => {
      const host = hostOf(t.url);
      const site = siteOf(host);
      const path = (() => {
        try {
          return new URL(t.url).pathname.split("/").filter(Boolean);
        } catch {
          return [];
        }
      })();
      const repo = /^(github\.com|gitlab\.com)$/.test(site) && path[1] ? `${path[0]}/${path[1]}`.toLowerCase() : null;
      return { tab: t, host, site, repo, words: wordsOf(t, site), category: Object.keys(CATEGORIES).find((c) => CATEGORIES[c].test(host)) };
    })
    .filter((x) => !KEEP_LOOSE.test(x.host + "."));
  const out = [];
  const taken = new Set();
  const add = (title, items, groupId) => {
    const free = items.filter((x) => !taken.has(x.tab.id));
    if (free.length < (groupId ? 1 : 2)) return;
    free.forEach((x) => taken.add(x.tab.id));
    const same = groupId ? null : out.find((g) => g.title.toLowerCase() === title.toLowerCase());
    if (same) same.tabIds.push(...free.map((x) => x.tab.id));
    else out.push({ title, tabIds: free.map((x) => x.tab.id), ...(groupId && { groupId }) });
  };
  const free = () => loose.filter((x) => !taken.has(x.tab.id));

  // Tabs that belong in a group you already have (its name is one of their words).
  for (const g of groups) {
    const name = (g.title || "").toLowerCase().trim();
    if (!name) continue;
    const words = name.split(/\s+/);
    add(g.title, free().filter((x) => words.every((w) => x.words.has(w)) || siteName(x.site).toLowerCase() === name || x.category?.toLowerCase() === name), g.id);
  }

  // Code first: tabs from the same repository (PRs, issues, files) go together.
  const byRepo = () => {
    const repos = new Map();
    for (const x of free()) if (x.repo) repos.set(x.repo, [...(repos.get(x.repo) || []), x]);
    for (const [repo, items] of repos) add(items[0].tab.url.split("/")[4], items);
  };
  const byCategory = () => {
    for (const cat of Object.keys(CATEGORIES)) add(cat, free().filter((x) => x.category === cat));
  };
  const bySite = () => {
    const sites = new Map();
    for (const x of free()) sites.set(x.site, [...(sites.get(x.site) || []), x]);
    for (const [site, items] of [...sites].sort((a, b) => b[1].length - a[1].length)) add(siteName(site), items);
  };
  // Topics: the word shared by the most remaining tabs becomes a group, again and
  // again. Words on most tabs say nothing about any of them, so they're skipped.
  const byTopic = () => {
    for (;;) {
      const rest = free();
      const count = new Map();
      const sites = new Map();
      for (const x of rest) {
        for (const w of x.words) {
          count.set(w, (count.get(w) || 0) + 1);
          sites.set(w, (sites.get(w) || new Set()).add(x.site));
        }
      }
      // A topic spans sites; tabs that only share a site are grouped by site instead.
      const limit = Math.max(3, Math.ceil(loose.length * 0.6));
      const [best] = [...count].filter(([w, n]) => n >= 2 && n <= limit && sites.get(w).size > 1).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
      if (!best) return;
      const items = rest.filter((x) => x.words.has(best[0]));
      // Name it with every word all of them share, in the order the first title uses.
      const shared = [...items[0].words].filter((w) => items.every((x) => x.words.has(w))).slice(0, 2);
      add(titleCase(shared.join(" ") || best[0]), items);
    }
  };

  byRepo();
  if (level === "broad") {
    byCategory();
    byTopic();
    bySite();
  } else {
    byTopic();
    bySite();
    if (level === "balanced") byCategory();
  }
  return out;
}

// ---------- never tidy ----------

const pageOf = (url) => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return "";
  }
};

// (tab) => true for tabs on the Never-tidy list.
export async function keptCheck() {
  const [{ neverTidy: k = {} }, { neverTidyTabs: ids = [] }] = await Promise.all([chrome.storage.local.get("neverTidy"), chrome.storage.session.get("neverTidyTabs")]);
  const pages = new Set(k.pages || []);
  const sites = k.sites || [];
  return (t) => {
    if (ids.includes(t.id) || pages.has(pageOf(t.url))) return true;
    const host = hostOf(t.url);
    return sites.some((s) => host === s || host.endsWith(`.${s}`));
  };
}

// Adds a tab ({ id, url }) or a site ("music.youtube.com") to the list.
export async function neverTidy({ tab, site }) {
  const { neverTidy: k = {} } = await chrome.storage.local.get("neverTidy");
  if (tab) {
    const { neverTidyTabs: ids = [] } = await chrome.storage.session.get("neverTidyTabs");
    await chrome.storage.session.set({ neverTidyTabs: [...new Set([...ids, tab.id])] });
    k.pages = [...new Set([...(k.pages || []), pageOf(tab.url)])];
  }
  if (site) k.sites = [...new Set([...(k.sites || []), site.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase()])];
  await chrome.storage.local.set({ neverTidy: k });
}

export async function allowTidy({ page, site }) {
  const { neverTidy: k = {} } = await chrome.storage.local.get("neverTidy");
  if (page) {
    k.pages = (k.pages || []).filter((p) => p !== page);
    // Also let go of the open tab that was kept by id.
    const { neverTidyTabs: ids = [] } = await chrome.storage.session.get("neverTidyTabs");
    const open = await chrome.tabs.query({});
    await chrome.storage.session.set({ neverTidyTabs: ids.filter((id) => pageOf(open.find((t) => t.id === id)?.url) !== page) });
  }
  if (site) k.sites = (k.sites || []).filter((s) => s !== site);
  await chrome.storage.local.set({ neverTidy: k });
}

// ---------- applying, with undo ----------

async function windowTabs() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  const [tabs, groups] = await Promise.all([chrome.tabs.query({ windowId: win.id }), chrome.tabGroups.query({ windowId: win.id })]);
  return { win, tabs, groups };
}

// Puts the planned groups in place; undo() puts every moved tab back where it was.
async function apply(planned, win, tabs) {
  const before = new Map(tabs.map((t) => [t.id, { index: t.index, groupId: t.groupId }]));
  const moved = [];
  let skipped = 0;
  for (const g of planned) {
    const add = (tabIds, groupId) => chrome.tabs.group({ tabIds, ...(groupId ? { groupId } : { createProperties: { windowId: win.id } }) });
    let groupId = g.groupId;
    let ok = g.tabIds;
    try {
      groupId = await add(g.tabIds, groupId);
    } catch {
      // Dia lists some tabs it then can't find ("Tab not found for session ID"), and one
      // of them fails the whole call: add the tabs one by one and skip those.
      ok = [];
      for (const id of g.tabIds) {
        try {
          groupId = await add([id], groupId);
          ok.push(id);
        } catch {
          skipped++;
        }
      }
    }
    if (!ok.length) continue;
    if (!g.groupId) await chrome.tabGroups.update(groupId, { title: g.title, color: colorFor(g.title), collapsed: false }).catch(() => {});
    g.tabIds = ok;
    g.done = true;
    moved.push(...ok);
  }
  const undo = async () => {
    await chrome.tabs.ungroup(moved).catch(() => {});
    for (const id of [...moved].sort((a, b) => before.get(a).index - before.get(b).index)) {
      await chrome.tabs.move(id, { index: before.get(id).index }).catch(() => {});
    }
  };
  return { undo: moved.length ? undo : null, skipped };
}

// "Tidied 5 tabs: Reddit (2), …", noting tabs the browser wouldn't move.
function report(verb, planned, { undo, skipped }) {
  const done = planned.filter((g) => g.done);
  const n = done.reduce((s, g) => s + g.tabIds.length, 0);
  const skip = skipped ? ` ${skipped} tab${skipped > 1 ? "s" : ""} couldn't be moved (Dia can't reach sleeping tabs; open them once and try again).` : "";
  return { summary: n ? `${verb} ${n} tabs: ${describe(done)}.${skip}` : `Couldn't group any tabs.${skip}`, undo };
}

const describe = (planned) =>
  planned.map((g) => `${g.title} (${g.tabIds.length})`).join(", ");

export async function tidy(level = "balanced") {
  const { win, tabs, groups } = await windowTabs();
  const planned = plan(tabs, groups, level, await keptCheck());
  if (!planned.length) return { summary: "Nothing to tidy: no loose tabs share a topic or site." };
  return report("Tidied", planned, await apply(planned, win, tabs));
}

export async function bySite() {
  const { win, tabs } = await windowTabs();
  const kept = await keptCheck();
  const loose = tabs.filter((t) => !t.pinned && t.groupId === -1 && /^https?:/.test(t.url || "") && !kept(t));
  const sites = new Map();
  for (const t of loose) {
    const site = siteOf(hostOf(t.url));
    sites.set(site, [...(sites.get(site) || []), t.id]);
  }
  const planned = [...sites].filter(([, ids]) => ids.length >= 2).map(([site, tabIds]) => ({ title: siteName(site), tabIds }));
  if (!planned.length) return { summary: "No site has more than one loose tab." };
  return report("Grouped", planned, await apply(planned, win, tabs));
}

// The same page twice: same address, ignoring #anchors and a trailing slash.
const pageKey = (url) => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url;
  }
};

export async function closeDuplicates() {
  const { tabs } = await windowTabs();
  const pages = new Map();
  const kept = await keptCheck();
  for (const t of tabs) if (!t.pinned && /^https?:/.test(t.url || "")) pages.set(pageKey(t.url), [...(pages.get(pageKey(t.url)) || []), t]);
  const close = [];
  for (const copies of pages.values()) {
    if (copies.length < 2) continue;
    // Only loose copies are ever closed: never a tab in a group, one of Dia's sidebar
    // folders (which extensions see as groups) or a Never-tidy tab. Of the rest, keep the
    // tab you're on, otherwise the one used last, unless a grouped copy stays anyway.
    const loose = copies.filter((t) => t.groupId === -1 && !kept(t));
    const keep = loose.length === copies.length ? copies.find((t) => t.active) || [...copies].sort((a, b) => (b.lastAccessed || b.id) - (a.lastAccessed || a.id))[0] : loose.find((t) => t.active);
    close.push(...loose.filter((t) => t !== keep));
  }
  if (!close.length) return { summary: "No duplicate tabs." };
  await chrome.tabs.remove(close.map((t) => t.id));
  return {
    summary: `Closed ${close.length} duplicate tab${close.length > 1 ? "s" : ""}.`,
    undo: async () => {
      for (const t of [...close].sort((a, b) => a.index - b.index)) {
        const tab = await chrome.tabs.create({ url: t.url, index: t.index, windowId: t.windowId, active: false });
        if (t.groupId !== -1) await chrome.tabs.group({ tabIds: [tab.id], groupId: t.groupId }).catch(() => {});
      }
    },
  };
}
