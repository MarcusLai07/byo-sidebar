// "Save media" view: find the images and videos on the current page and download
// them (or attach images to the chat). Only files the page actually points to are
// saved; streamed video (YouTube, most video sites) can't be saved this way.

import * as ctx from "./context.js";

// Runs in every frame of the page.
function mediaScript() {
  const out = [];
  const seen = new Set();
  const add = (type, url, extra = {}) => {
    if (!url) return;
    try {
      url = new URL(url, location.href).href;
    } catch {
      return;
    }
    if (url.startsWith("data:") ? url.length < 400 : !/^https?:/.test(url)) return; // skip tiny placeholders
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ type, url, ...extra });
  };
  const largest = (srcset) =>
    srcset
      .split(",")
      .map((s) => s.trim().split(/\s+/))
      .filter(([u]) => u)
      .map(([u, d]) => ({ u, n: parseFloat(d) || 1 }))
      .sort((a, b) => b.n - a.n)[0]?.u;

  for (const img of document.images) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if ((w && w < 48) || (h && h < 48)) continue; // icons, spacers, thin decorative strips
    const big = img.srcset && largest(img.srcset);
    add("image", big || img.currentSrc || img.src, { w, h, alt: img.alt || "" });
  }
  for (const source of document.querySelectorAll("picture source[srcset]")) add("image", largest(source.srcset), {});
  for (const m of document.querySelectorAll('meta[property^="og:image"], meta[name="twitter:image"]')) {
    if (/^https?:/.test(m.content)) add("image", m.content, { alt: "Share preview image" });
  }
  // Large CSS background images (hero banners, galleries).
  let checked = 0;
  for (const el of document.querySelectorAll("div, section, header, a, span, figure")) {
    if (++checked > 1500) break;
    const r = el.getBoundingClientRect();
    if (r.width < 160 || r.height < 120) continue;
    const bg = getComputedStyle(el).backgroundImage;
    const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
    if (m) add("image", m[1], { w: Math.round(r.width), h: Math.round(r.height), alt: "Background image" });
  }

  let streamed = false;
  for (const v of document.querySelectorAll("video, audio")) {
    const type = v.tagName === "AUDIO" ? "audio" : "video";
    const srcs = [v.currentSrc, v.src, ...[...v.querySelectorAll("source")].map((s) => s.src)].filter(Boolean);
    const files = srcs.filter((s) => /^https?:/.test(s));
    files.forEach((s) => add(type, s, { w: v.videoWidth || 0, h: v.videoHeight || 0, poster: v.poster || "", duration: isFinite(v.duration) ? v.duration : 0 }));
    if (!files.length && srcs.length) streamed = true; // blob: or MediaSource
  }
  for (const m of document.querySelectorAll('meta[property^="og:video"]')) {
    if (/^https?:/.test(m.content) && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(m.content)) add("video", m.content, {});
  }
  for (const a of document.querySelectorAll("a[href]")) {
    const ext = (a.href.split(/[?#]/)[0].match(/\.(\w{3,4})$/) || [])[1]?.toLowerCase();
    if (!ext) continue;
    const type = /^(jpe?g|png|gif|webp|avif)$/.test(ext) ? "image" : /^(mp4|webm|mov|m4v)$/.test(ext) ? "video" : /^(mp3|m4a|wav|flac|ogg)$/.test(ext) ? "audio" : null;
    if (type) add(type, a.href, { alt: (a.innerText || "").trim().slice(0, 80), linked: true });
  }
  return { items: out.slice(0, 400), streamed };
}

const els = {
  view: document.getElementById("media-view"),
  count: document.getElementById("media-count"),
  grid: document.getElementById("media-grid"),
  filter: document.querySelector(".media-filter"),
  selectAll: document.getElementById("media-select-all"),
  attach: document.getElementById("media-attach"),
  download: document.getElementById("media-download"),
  refresh: document.getElementById("media-refresh"),
};

let items = [];
let streamed = false;
let kind = "all";
let pageTab = null;
let deps = {};
const selected = new Set();

const shown = () => items.filter((m) => kind === "all" || (kind === "video" ? m.type !== "image" : m.type === "image"));

function fileName(m, i) {
  const host = (pageTab?.url && new URL(pageTab.url).hostname.replace(/^www\./, "")) || "page";
  let name = "";
  if (!m.url.startsWith("data:")) name = decodeURIComponent(new URL(m.url).pathname.split("/").pop() || "");
  name = name.replace(/[^\w.\-() ]+/g, "_").slice(0, 80);
  const ext = m.url.startsWith("data:image/") ? m.url.slice(11, m.url.indexOf(";")) : "";
  if (!name) name = `${m.type}-${i + 1}${ext ? `.${ext.replace("jpeg", "jpg")}` : ""}`;
  else if (!/\.\w{2,4}$/.test(name)) name += m.type === "image" ? ".jpg" : m.type === "audio" ? ".mp3" : ".mp4";
  return `BYO Sidebar/${host}/${name}`;
}

function tile(m) {
  const t = document.createElement("button");
  t.type = "button";
  t.className = `media-tile${selected.has(m.url) ? " selected" : ""}`;
  t.title = m.alt || m.url;
  if (m.type === "image") {
    const img = document.createElement("img");
    img.src = m.url;
    img.loading = "lazy";
    img.alt = m.alt || "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => t.classList.add("broken");
    img.onload = () => {
      if (!m.w) {
        m.w = img.naturalWidth;
        m.h = img.naturalHeight;
        size.textContent = `${m.w}×${m.h}`;
      }
    };
    t.append(img);
  } else if (m.poster) {
    const img = document.createElement("img");
    img.src = m.poster;
    img.alt = "";
    t.append(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "media-ph";
    ph.textContent = m.type === "audio" ? "♪" : "▶";
    t.append(ph);
  }
  const badge = document.createElement("span");
  badge.className = "media-badge";
  badge.textContent = m.type === "image" ? "" : m.type === "audio" ? "Audio" : "Video";
  if (!badge.textContent) badge.hidden = true;
  const size = document.createElement("span");
  size.className = "media-size";
  size.textContent = m.w && m.h ? `${m.w}×${m.h}` : m.duration ? `${Math.round(m.duration)}s` : "";
  const check = document.createElement("span");
  check.className = "media-check";
  check.textContent = "✓";
  t.append(badge, size, check);
  t.addEventListener("click", () => {
    selected.has(m.url) ? selected.delete(m.url) : selected.add(m.url);
    t.classList.toggle("selected", selected.has(m.url));
    updateActions();
  });
  return t;
}

function draw() {
  const list = shown();
  const nImg = items.filter((m) => m.type === "image").length;
  const nVid = items.length - nImg;
  els.count.textContent = items.length ? `${nImg} image${nImg === 1 ? "" : "s"}, ${nVid} video${nVid === 1 ? "" : "s"}` : "No media found on this page";
  const nodes = list.map(tile);
  if (streamed && kind !== "image") {
    const note = document.createElement("p");
    note.className = "hint media-note";
    note.textContent = "This page streams its video (as YouTube and most video sites do), so there's no file to save from the browser.";
    nodes.push(note);
  }
  els.grid.replaceChildren(...nodes);
  updateActions();
}

function updateActions() {
  const n = selected.size;
  els.download.textContent = n ? `Download ${n}` : "Download";
  els.download.disabled = !n;
  const imgs = items.filter((m) => selected.has(m.url) && m.type === "image").length;
  els.attach.disabled = !imgs;
  els.attach.textContent = imgs ? `Attach ${imgs}` : "Attach to chat";
  els.selectAll.textContent = shown().every((m) => selected.has(m.url)) && shown().length ? "Select none" : "Select all";
}

els.filter.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-kind]");
  if (!b) return;
  kind = b.dataset.kind;
  els.filter.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  draw();
});

els.selectAll.addEventListener("click", () => {
  const list = shown();
  const all = list.every((m) => selected.has(m.url));
  list.forEach((m) => (all ? selected.delete(m.url) : selected.add(m.url)));
  draw();
});

els.download.addEventListener("click", async () => {
  const picks = items.filter((m) => selected.has(m.url));
  let ok = 0;
  for (const [i, m] of picks.entries()) {
    try {
      await chrome.downloads.download({ url: m.url, filename: fileName(m, i), conflictAction: "uniquify" });
      ok++;
    } catch (e) {
      console.warn("BYO Sidebar: download failed", m.url, e);
    }
  }
  deps.toast?.(ok === picks.length ? `Saved ${ok} to Downloads/BYO Sidebar` : `Saved ${ok} of ${picks.length}; some couldn't be downloaded`);
});

els.attach.addEventListener("click", async () => {
  const picks = items.filter((m) => selected.has(m.url) && m.type === "image").slice(0, 10);
  for (const m of picks) {
    try {
      deps.attach(await ctx.fetchAttachment(m.url, m.alt || "image"));
    } catch (e) {
      deps.toast?.(e.message);
    }
  }
  deps.done?.();
});

els.refresh.addEventListener("click", () => renderMedia(deps, { keepSelection: true }));

// Scans the active tab. With keepSelection (refresh), ticked items that are still
// on the page stay ticked.
export async function renderMedia(d, { keepSelection = false } = {}) {
  deps = d;
  const previous = new Set(keepSelection ? selected : []);
  selected.clear();
  items = [];
  els.refresh.classList.add("spinning");
  streamed = false;
  pageTab = await ctx.activeTab();
  els.count.textContent = "Looking for media…";
  els.grid.replaceChildren();
  if (!pageTab) return draw();
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: pageTab.id, allFrames: true }, func: mediaScript });
    const seen = new Set();
    for (const r of results) {
      if (!r.result) continue;
      streamed ||= r.result.streamed;
      for (const m of r.result.items) if (!seen.has(m.url) && seen.add(m.url)) items.push(m);
    }
  } catch {
    els.count.textContent = "This page can't be read by extensions.";
    els.refresh.classList.remove("spinning");
    return;
  }
  for (const m of items) if (previous.has(m.url)) selected.add(m.url);
  setTimeout(() => els.refresh.classList.remove("spinning"), 300);
  // Biggest first: the photos you're after, not thumbnails.
  items.sort((a, b) => (b.type === "image") - (a.type === "image") || (b.w * b.h || 0) - (a.w * a.h || 0));
  draw();
}
