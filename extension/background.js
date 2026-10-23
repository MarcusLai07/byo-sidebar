// Open the panel when the toolbar icon (or Cmd+Shift+E) is used.
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
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.audible !== true) return;
  const { mediaTabs = [] } = await chrome.storage.session.get("mediaTabs");
  if (!mediaTabs.includes(tabId)) chrome.storage.session.set({ mediaTabs: [...mediaTabs, tabId] });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { mediaTabs = [] } = await chrome.storage.session.get("mediaTabs");
  if (mediaTabs.includes(tabId)) chrome.storage.session.set({ mediaTabs: mediaTabs.filter((t) => t !== tabId) });
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
