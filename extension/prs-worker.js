// Pull requests, kept fresh in the background like Arc's live folders: every few
// minutes the router asks GitHub (through your gh logins) for open PRs. The panel's
// PR list reads the result from storage. New review requests can notify you and open
// in a "PRs" tab group; tabs Lumen opened close again once their PR is merged or closed.
// Loaded into the background worker with importScripts.

const PR_POLL_MINUTES = 3;
const PR_DEFAULTS = { notify: true, autoOpen: false, autoClose: true };
const PR_GROUP = "PRs";

function github(action, input = {}) {
  return new Promise((resolve, reject) =>
    chrome.runtime.sendNativeMessage("com.lumen.router", { type: "github", id: crypto.randomUUID(), action, input }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res || res.error) return reject(new Error(res?.error || "No answer from the router."));
      resolve(res.data);
    })
  );
}

async function prSettings() {
  const { prSettings: s = {} } = await chrome.storage.local.get("prSettings");
  return { ...PR_DEFAULTS, ...s };
}

// Tabs showing this PR (its conversation, files or checks), but not pull/12 for pull/1.
const prTabs = async (url) => (await chrome.tabs.query({ url: `${url}*` })).filter((t) => /^[/?#]|^$/.test(t.url.slice(url.length)));

// Focus the tab already showing this PR, or open it.
async function openPr(url, { active = true } = {}) {
  const [tab] = await prTabs(url);
  if (tab) {
    if (active) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return null;
  }
  return chrome.tabs.create({ url, active });
}

// Opens PRs in the background, in a "PRs" tab group where the browser has groups.
async function openInGroup(urls) {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
  const tabs = [];
  for (const url of urls) {
    if ((await prTabs(url)).length) continue;
    tabs.push(await chrome.tabs.create({ url, active: false, ...(win && { windowId: win.id }) }));
  }
  if (!tabs.length || !chrome.tabGroups || !win) return tabs;
  try {
    const [group] = await chrome.tabGroups.query({ title: PR_GROUP, windowId: win.id });
    const groupId = await chrome.tabs.group({ tabIds: tabs.map((t) => t.id), ...(group ? { groupId: group.id } : { createProperties: { windowId: win.id } }) });
    if (!group) await chrome.tabGroups.update(groupId, { title: PR_GROUP, color: "purple", collapsed: false });
  } catch {
    // no tab groups here: plain tabs are fine
  }
  return tabs;
}

let polling = null;
function pollPrs() {
  return (polling ??= doPoll().finally(() => (polling = null)));
}

async function doPoll() {
  const { prState: old = {}, prSeen, prOpened = {} } = await chrome.storage.local.get(["prState", "prSeen", "prOpened"]);
  let result;
  try {
    result = await github("prs");
  } catch (e) {
    await chrome.storage.local.set({ prState: { ...old, error: e.message, checkedAt: Date.now() } });
    // Without gh (or a login) there's nothing to poll for; the panel's ↻ tries again.
    if (/not found|not signed in|host not found|native messaging host/i.test(e.message)) chrome.alarms.clear("prs");
    return;
  }
  const settings = await prSettings();
  const review = result.items.filter((i) => i.group === "review");

  // The first check only learns what's there, so it doesn't open or announce everything.
  const fresh = prSeen ? review.filter((i) => !prSeen.includes(i.url)) : [];
  if (fresh.length && settings.notify) {
    for (const pr of fresh.slice(0, 5)) {
      chrome.notifications.create(`pr:${pr.url}`, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: `Review requested · ${pr.repo}#${pr.number}`,
        message: pr.title,
        contextMessage: pr.author ? `from ${pr.author}` : "",
      });
    }
  }
  if (fresh.length && settings.autoOpen) {
    for (const t of await openInGroup(fresh.map((i) => i.url))) prOpened[t.pendingUrl || t.url] = t.id;
  }

  // Tabs Lumen opened: close them once their PR is merged or closed.
  const open = new Set(result.items.map((i) => i.url));
  const gone = Object.keys(prOpened).filter((u) => !open.has(u));
  if (gone.length) {
    const states = await github("states", { urls: gone }).catch(() => ({}));
    for (const url of gone) {
      const tab = await chrome.tabs.get(prOpened[url]).catch(() => null);
      if (!tab || !/^[/?#]|^$/.test(tab.url.startsWith(url) ? tab.url.slice(url.length) : "x")) delete prOpened[url]; // closed or navigated away: not ours anymore
      else if (states[url] === "MERGED" || states[url] === "CLOSED") {
        if (settings.autoClose) await chrome.tabs.remove(tab.id).catch(() => {});
        delete prOpened[url];
      }
    }
  }

  await chrome.storage.local.set({
    prState: { ...result, error: null, checkedAt: Date.now() },
    prSeen: review.map((i) => i.url),
    prOpened,
  });
  chrome.action.setBadgeText({ text: review.length ? String(review.length) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#d97757" });
}

function schedulePrs() {
  chrome.alarms.create("prs", { periodInMinutes: PR_POLL_MINUTES, delayInMinutes: 0.1 });
}

chrome.runtime.onInstalled.addListener(schedulePrs);
chrome.runtime.onStartup.addListener(schedulePrs);
chrome.alarms.onAlarm.addListener((a) => a.name === "prs" && pollPrs());
chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith("pr:")) return;
  chrome.notifications.clear(id);
  openPr(id.slice(3));
});

// From the panel: { type: "prs:refresh" } checks now; { type: "prs:open", url } opens one.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "prs:refresh") {
    schedulePrs();
    pollPrs().then(() => reply(true), () => reply(false));
    return true;
  }
  if (msg?.type === "prs:open") {
    openPr(msg.url).then(() => reply(true), () => reply(false));
    return true;
  }
});
