importScripts("prs-worker.js");

// Open the panel when the toolbar icon (or your shortcut) is used.
// Browsers without a working chrome.sidePanel get a docked popup window instead.
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => chrome.action.onClicked.addListener(openWindow));
} else {
  chrome.action.onClicked.addListener(openWindow);
}

// Remember every tab that has played sound this browser session, so paused
// players stay in the media strip (like Arc) instead of vanishing when they go quiet.
// Updates run one at a time, so two tabs starting to play at once can't drop one.
let mediaQueue = Promise.resolve();
const updateMediaTabs = (change) =>
  (mediaQueue = mediaQueue.then(async () => {
    const { mediaTabs = [] } = await chrome.storage.session.get("mediaTabs");
    const next = change(mediaTabs);
    if (next.length !== mediaTabs.length) await chrome.storage.session.set({ mediaTabs: next });
  }).catch(() => {}));

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.audible === true) updateMediaTabs((tabs) => (tabs.includes(tabId) ? tabs : [...tabs, tabId]));
});
chrome.tabs.onRemoved.addListener((tabId) => updateMediaTabs((tabs) => tabs.filter((t) => t !== tabId)));

// ---------- right-click menu ----------

const MENU = [
  { id: "ask-selection", title: "Ask about “%s”", contexts: ["selection"] },
  { id: "skill:explain", title: "Explain", contexts: ["selection"] },
  { id: "skill:copyedit", title: "Copy edit", contexts: ["selection"] },
  { id: "skill:translate", title: "Translate to English", contexts: ["selection"] },
  { id: "skill:summarize", title: "Summarize this page", contexts: ["page"] },
  { id: "ask-image", title: "Ask about this image", contexts: ["image"] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "lumen", title: "Lumen", contexts: ["selection", "page", "image"] });
    for (const item of MENU) chrome.contextMenus.create({ ...item, parentId: "lumen" });
  });
});

// The panel picks this up when it opens (or right away if it's already open).
function hand(action) {
  return chrome.storage.session.set({ pendingAction: { ...action, at: Date.now() } });
}

// sidePanel.open() must run synchronously inside the click, before any await.
function openPanel(windowId) {
  if (chrome.sidePanel?.open) chrome.sidePanel.open({ windowId }).catch(openWindow);
  else openWindow();
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  openPanel(tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT); // no tab in some PDF viewers and frames
  const id = String(info.menuItemId);
  if (id === "ask-selection") hand({ kind: "selection", selection: info.selectionText });
  else if (id === "ask-image") hand({ kind: "image", srcUrl: info.srcUrl });
  else if (id.startsWith("skill:")) hand({ kind: "skill", skillId: id.slice(6), selection: info.selectionText });
});

// ---------- address bar: type "ai", a space, and a question ----------

chrome.omnibox.setDefaultSuggestion({ description: "Ask Lumen: %s" });
chrome.omnibox.onInputEntered.addListener((text) => {
  openPanel(chrome.windows.WINDOW_ID_CURRENT);
  hand({ kind: "ask", text });
});

async function openWindow() {
  const url = chrome.runtime.getURL("sidepanel.html?mode=window");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  const current = await chrome.windows.getLastFocused();
  const width = 420;
  chrome.windows.create({
    url,
    type: "popup",
    width,
    height: current.height ?? 900,
    left: (current.left ?? 0) + (current.width ?? 1400) - width,
    top: current.top ?? 0,
  });
}
