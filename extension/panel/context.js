// Reading context from tabs: page text, selection, YouTube captions, PDFs, screenshots.

const PAGE_LIMIT = 40000;
const TAB_LIMIT = 12000; // per @-mentioned tab
const TRANSCRIPT_LIMIT = 60000;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export async function activeTab() {
  // In window mode the panel's own window is focused, so look at normal windows only.
  const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

export async function windowTabs() {
  const tab = await activeTab();
  if (!tab) return [];
  return (await chrome.tabs.query({ windowId: tab.windowId })).filter((t) => /^https?:|^file:/.test(t.url || ""));
}

export async function tabGroups() {
  const tab = await activeTab();
  if (!tab || !chrome.tabGroups) return [];
  const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
  return Promise.all(groups.map(async (g) => ({ ...g, tabs: await chrome.tabs.query({ groupId: g.id }) })));
}

// Runs in a YouTube page: reads the transcript panel if the user has opened it
// ("…more" → "Show transcript"). YouTube blocks fetching captions directly
// (its caption and transcript endpoints need a device attestation token), so
// without the panel the chat relies on the page text: description and comments.
function youtubeTranscript(limit) {
  const panel = [...document.querySelectorAll("ytd-engagement-panel-section-list-renderer")].find(
    (p) => /transcript/i.test(p.getAttribute("target-id") || "") && p.getAttribute("visibility") !== "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"
  );
  const raw = panel?.innerText || "";
  // Lines come as "0:12\nSome words", sometimes with chapter titles in between.
  const lines = [];
  let time = null;
  for (const line of raw.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(line)) time = line;
    else if (time) {
      lines.push(`[${time}] ${line}`);
      time = null;
    }
  }
  if (lines.length < 3) return null;
  return { language: document.documentElement.lang || "", auto: false, text: lines.join("\n").slice(0, limit) };
}

function pageScript(limit) {
  return {
    selection: String(getSelection() || "").trim(),
    text: (document.body?.innerText || "").slice(0, limit),
    duration: (() => {
      const m = [...document.querySelectorAll("video, audio")].find((x) => isFinite(x.duration) && x.duration > 0);
      return m ? m.duration : null;
    })(),
  };
}

const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// Fetch a URL as an attachment (image or PDF). Throws with a readable message.
export async function fetchAttachment(url, name) {
  if (!/^https?:|^file:/.test(url)) throw new Error("Only web and file URLs can be attached.");
  const res = await fetch(url, { credentials: "include" }).catch(() => {
    throw new Error(url.startsWith("file:")
      ? "Can't read local files: turn on “Allow access to file URLs” for BYO Sidebar in the extensions page."
      : "Couldn't download it.");
  });
  if (!res.ok) throw new Error(`Couldn't download it (${res.status}).`);
  const mime = (res.headers.get("content-type") || "").split(";")[0].trim() || guessMime(url);
  const buf = await res.arrayBuffer();
  return fromBytes(buf, mime, name || decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "file"));
}

export function guessMime(name) {
  const ext = (name.split(/[?#]/)[0].split(".").pop() || "").toLowerCase();
  return { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json" }[ext] || "";
}

export function fromBytes(buf, mime, name) {
  if (buf.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`${name} is too large (max 25 MB).`);
  if (mime === "application/pdf") return { kind: "pdf", mime, name, data: toBase64(buf) };
  if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) return { kind: "image", mime, name, data: toBase64(buf) };
  if (/^text\/|json|xml|csv|markdown/.test(mime) || /\.(txt|md|csv|json|log|xml|ya?ml|js|ts|py|html?)$/i.test(name)) {
    return { kind: "text", mime: mime || "text/plain", name, text: new TextDecoder().decode(buf).slice(0, PAGE_LIMIT) };
  }
  throw new Error(`${name}: only images, PDFs and text files can be attached.`);
}

// Read one tab. Returns { tab, text, selection, transcript, pdf, unreadable }.
export async function readTab(tab, { limit = PAGE_LIMIT, transcript = true } = {}) {
  const out = { tab, text: "", selection: "", transcript: null, pdf: null, unreadable: false };
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageScript, args: [limit] });
    Object.assign(out, { text: result.text, selection: result.selection, duration: result.duration });
  } catch {
    out.unreadable = true;
  }
  // Chrome's PDF viewer can't be scripted: download the PDF itself instead.
  if ((out.unreadable || /\.pdf($|[?#])/i.test(tab.url)) && /^https?:|^file:/.test(tab.url)) {
    try {
      const a = await fetchAttachment(tab.url, tab.title);
      if (a.kind === "pdf") {
        out.pdf = a;
        out.unreadable = false;
      }
    } catch {
      // stays unreadable
    }
  }
  if (transcript && /^https:\/\/(www\.|m\.)?youtube\.com\/watch/.test(tab.url)) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: youtubeTranscript,
        args: [TRANSCRIPT_LIMIT],
      });
      out.transcript = result;
    } catch {
      // no captions
    }
  }
  return out;
}

export const readMentionedTab = (tab) => readTab(tab, { limit: TAB_LIMIT });

const attr = (s) => String(s || "").replace(/"/g, "'");

// Turn a read tab into a prompt block. `tag` is "page" for the current tab, "tab" for others.
export function block(info, tag = "page") {
  const { tab } = info;
  if (info.unreadable) return `(The ${tag === "page" ? "user is on" : "tab is"} ${tab.url}, which extensions can't read.)`;
  const parts = [];
  if (info.pdf) parts.push(`(The PDF is attached.)`);
  else parts.push(info.text);
  if (info.transcript) {
    parts.push(`<transcript language="${info.transcript.language}"${info.transcript.auto ? ' auto-generated="true"' : ""}>\n${info.transcript.text}\n</transcript>`);
  }
  return `<${tag} url="${attr(tab.url)}" title="${attr(tab.title)}">\n${parts.join("\n\n")}\n</${tag}>`;
}

export async function screenshot() {
  const tab = await activeTab();
  if (!tab) throw new Error("No tab to capture.");
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
  return { kind: "image", mime: "image/jpeg", name: `Screenshot of ${tab.title || "tab"}`, data: url.split(",")[1] };
}

// Recent finished downloads that can be attached.
export async function recentDownloads(limit = 12) {
  if (!chrome.downloads) return [];
  const items = await chrome.downloads.search({ orderBy: ["-startTime"], state: "complete", limit: 50 });
  return items
    .filter((d) => d.exists !== false)
    .filter((d) => /pdf|image\/(png|jpe?g|gif|webp)|text|json|csv/.test(d.mime || "") || /\.(pdf|png|jpe?g|gif|webp|txt|md|csv|json)$/i.test(d.filename))
    .slice(0, limit)
    .map((d) => ({ id: d.id, name: d.filename.split("/").pop(), url: d.finalUrl || d.url, mime: d.mime, size: d.fileSize, time: d.startTime }));
}

// Jump the video/audio in a tab to `seconds` and play it (timestamp links).
function seekScript(seconds) {
  const media = [...document.querySelectorAll("video, audio")]
    .filter((m) => m.currentSrc || m.srcObject)
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
  if (!media) return false;
  media.currentTime = seconds;
  media.play().catch(() => {});
  return true;
}

export async function seekTab(tabId, url, seconds) {
  let tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    // The tab is gone: reopen the page, at the time if it's YouTube.
    if (!url) return false;
    const u = new URL(url);
    if (/youtube\.com$/.test(u.hostname.replace(/^www\.|^m\./, ""))) u.searchParams.set("t", `${Math.floor(seconds)}s`);
    tab = await chrome.tabs.create({ url: u.toString() });
    return true;
  }
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  const results = await chrome.scripting
    .executeScript({ target: { tabId: tab.id, allFrames: true }, world: "MAIN", func: seekScript, args: [seconds] })
    .catch(() => []);
  return results.some((r) => r.result);
}
