// Reading context from tabs: page text, selection, YouTube captions, PDFs, screenshots.

export const PAGE_LIMIT = 40000;
const TAB_LIMIT = 12000; // per @-mentioned tab
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

// Runs in a YouTube watch page (main world). Visible text is a poor source there:
// the description is collapsed, comments only load when you scroll, and long
// comments are cut at "Read more". So read YouTube's own data instead:
// - the full description from the player response,
// - the top comments, fetched the same way the page does when you scroll,
// - the transcript, if its panel is open (YouTube blocks fetching captions directly:
//   its caption and transcript endpoints need a device attestation token).
async function youtubeData(maxComments) {
  const out = { description: "", channel: "", comments: [], transcript: null };
  const player = document.getElementById("movie_player");
  const details = (player?.getPlayerResponse?.() || window.ytInitialPlayerResponse)?.videoDetails;
  out.description = details?.shortDescription || "";
  out.channel = details?.author || "";

  const find = (obj, test, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 45) return null;
    const hit = test(obj);
    if (hit) return hit;
    for (const v of Object.values(obj)) {
      const r = find(v, test, depth + 1);
      if (r) return r;
    }
    return null;
  };
  const tokenIn = (obj) => find(obj, (o) => o.continuationCommand?.token);

  try {
    const cfg = window.ytcfg;
    const data = document.querySelector("ytd-app")?.data?.response || window.ytInitialData;
    const section = find(data, (o) => o.itemSectionRenderer?.sectionIdentifier === "comment-item-section" && o.itemSectionRenderer);
    let token = section && tokenIn(section);
    for (let page = 0; token && page < 3 && out.comments.length < maxComments; page++) {
      const res = await fetch("/youtubei/v1/next?prettyPrint=false", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "X-Youtube-Client-Name": String(cfg.get("INNERTUBE_CONTEXT_CLIENT_NAME")),
          "X-Youtube-Client-Version": cfg.get("INNERTUBE_CLIENT_VERSION"),
        },
        body: JSON.stringify({ context: cfg.get("INNERTUBE_CONTEXT"), continuation: token }),
      });
      if (!res.ok) break;
      const json = await res.json();
      for (const m of json.frameworkUpdates?.entityBatchUpdate?.mutations || []) {
        const c = m.payload?.commentEntityPayload;
        if (c?.properties?.content?.content) {
          out.comments.push({ author: c.author?.displayName || "", likes: c.toolbar?.likeCountNotliked || "", text: c.properties.content.content });
        }
      }
      // The response has a header block and a comments block; the next page's token is
      // in the continuation item that ends the comments block.
      const items = (json.onResponseReceivedEndpoints || []).flatMap(
        (e) => (e.reloadContinuationItemsCommand || e.appendContinuationItemsAction)?.continuationItems || []
      );
      const more = items.filter((i) => i.continuationItemRenderer).pop();
      token = more ? tokenIn(more.continuationItemRenderer) : null;
    }
  } catch {
    // comments are a bonus; keep whatever we got
  }
  out.comments = out.comments.slice(0, maxComments);

  const panel = [...document.querySelectorAll("ytd-engagement-panel-section-list-renderer")].find(
    (p) => /transcript/i.test(p.getAttribute("target-id") || "") && p.getAttribute("visibility") !== "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"
  );
  const lines = [];
  let time = null;
  // Lines come as "0:12\nSome words", sometimes with chapter titles in between.
  for (const line of (panel?.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(line)) time = line;
    else if (time) {
      lines.push(`[${time}] ${line}`);
      time = null;
    }
  }
  if (lines.length >= 3) out.transcript = { language: document.documentElement.lang || "", text: lines.join("\n").slice(0, 60000) };
  return out;
}

// Runs in any page: visible text, plus text that's in the page but folded away
// (closed <details>, "read more" expanders, line-clamped or collapsed sections).
function pageScript(limit) {
  const visible = document.body?.innerText || "";
  const folded = [];
  const seen = new Set();
  const FOLD = /expand|collaps|truncat|read-?more|show-?more|clamp|accordion|spoiler/i;
  const candidates = [
    ...document.querySelectorAll("details:not([open]) > :not(summary)"),
    ...[...document.querySelectorAll("[class], [id], [aria-expanded='false']")].filter(
      (el) => FOLD.test(`${el.className} ${el.id}`) || el.getAttribute("aria-expanded") === "false"
    ),
  ];
  for (const el of candidates) {
    if (el.closest("script, style, noscript, template, nav, header, footer")) continue;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    // Only text that innerText missed, and big enough to be content rather than a label.
    if (text.length < 120 || seen.has(text) || visible.includes(text.slice(0, 80))) continue;
    seen.add(text);
    folded.push(text);
    if (folded.join("").length > limit / 2) break;
  }
  const text = folded.length ? `${visible}\n\n[Collapsed on the page]\n${folded.join("\n\n")}` : visible;
  return {
    selection: String(getSelection() || "").trim(),
    text: text.slice(0, limit),
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

// Read one tab. Returns { tab, text, selection, youtube, pdf, unreadable }.
// youtube: "full" for the current tab, "brief" for @-mentioned ones (fewer comments).
export async function readTab(tab, { limit = PAGE_LIMIT, youtube = "full" } = {}) {
  const out = { tab, text: "", selection: "", youtube: null, pdf: null, unreadable: false };
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
  if (youtube && /^https:\/\/(www\.|m\.)?youtube\.com\/watch/.test(tab.url)) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: youtubeData,
        args: [youtube === "full" ? 40 : 15],
      });
      out.youtube = result;
    } catch {
      // not a readable watch page
    }
  }
  return out;
}

export const readMentionedTab = (tab) => readTab(tab, { limit: TAB_LIMIT, youtube: "brief" });

// More YouTube comments for the browsing tool.
export async function youtubeComments(tabId, count) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: youtubeData, args: [count] });
  return result?.comments || [];
}

function linksScript(max) {
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    const text = (a.innerText || a.getAttribute("aria-label") || a.title || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!text) continue;
    seen.add(href);
    out.push([text, href]);
    if (out.length >= max) break;
  }
  return out;
}

// Links on a page as [text, url] pairs, for following with the browsing tool.
export async function pageLinks(tabId, max = 80) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: linksScript, args: [max] });
    return result || [];
  } catch {
    return [];
  }
}

const attr = (s) => String(s || "").replace(/"/g, "'");

// Turn a read tab into a prompt block. `tag` is "page" for the current tab, "tab" for others.
export function block(info, tag = "page") {
  const { tab } = info;
  if (info.unreadable) return `(The ${tag === "page" ? "user is on" : "tab is"} ${tab.url}, which extensions can't read.)`;
  const parts = [];
  if (info.pdf) parts.push(`(The PDF is attached.)`);
  else parts.push(info.text);
  const yt = info.youtube;
  if (yt?.description) parts.push(`<description channel="${attr(yt.channel)}">\n${yt.description}\n</description>`);
  if (yt?.comments?.length) {
    const list = yt.comments.map((c) => `- ${c.author}${c.likes ? ` (${c.likes} likes)` : ""}: ${c.text}`).join("\n");
    parts.push(`<comments order="top">\n${list}\n</comments>`);
  }
  if (yt?.transcript) parts.push(`<transcript language="${yt.transcript.language}">\n${yt.transcript.text}\n</transcript>`);
  return `<${tag} id="${tab.id}" url="${attr(tab.url)}" title="${attr(tab.title)}">\n${parts.join("\n\n")}\n</${tag}>`;
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
