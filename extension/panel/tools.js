// Runs the model's read-only browsing tools in the browser (see host/providers/tools.js).
// Nothing here clicks, types or submits. One safeguard against a page smuggling your
// data out: open_url only opens links that already appeared in the conversation, in
// pages read, or in tool results, or are on a site you named or allowed in this chat;
// any other URL needs your approval first.

import * as ctx from "./context.js";

const CHUNK = 20000;
const OPEN_TIMEOUT_MS = 20000;
const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;

const clean = (u) => u.replace(/[.,;:!?]+$/, "").replace(/#.*$/, "");

// "re-structure.ai" for https://www.re-structure.ai/robots.txt.
export const siteOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

// Sites you named in your own words ("check re-structure.ai"), with or without https://.
export function sitesIn(text) {
  return (String(text || "").match(/\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) || []).map((d) => siteOf(/^https?:/i.test(d) ? d : `https://${d}`)).filter(Boolean);
}

export function urlsIn(text) {
  return (String(text || "").match(URL_RE) || []).map(clean);
}

const linkList = (links) =>
  links.length ? `\n\nLinks on this page:\n${links.map(([t, u]) => `- [${t}](${u})`).join("\n")}` : "";

function chunk(text, offset = 0) {
  const start = Math.max(0, offset | 0);
  const part = text.slice(start, start + CHUNK);
  const rest = text.length - (start + part.length);
  return rest > 0 ? `${part}\n\n(${rest} more characters: call again with offset ${start + part.length}.)` : part;
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    let fired = false;
    const done = () => {
      if (fired) return;
      fired = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      // Give script-rendered pages a moment after "complete".
      setTimeout(resolve, 1200);
    };
    const listener = (id, info) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, OPEN_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(listener);
    // It may have finished loading before the listener was added.
    chrome.tabs.get(tabId).then((t) => t.status === "complete" && listener(tabId, t), () => {});
  });
}

// seen: Set of URLs the conversation already contains (grows as pages are read).
// activity(label) → { done(note?), fail(note) } shows progress in the reply.
// sites: Set of sites (siteOf) you allowed in this chat, or named yourself: any page
// on them opens without asking again.
// approve(url) → Promise<boolean> asks the user.
export function createRunner({ seen, sites, activity, approve }) {
  const remember = (text, links = []) => {
    urlsIn(text).forEach((u) => seen.add(u));
    links.forEach(([, u]) => seen.add(clean(u)));
  };

  async function readTabText(tab) {
    const info = await ctx.readTab(tab, { limit: 400000 });
    const links = await ctx.pageLinks(tab.id);
    const text = ctx.block(info, "tab");
    remember(text, links);
    return text + linkList(links);
  }

  const tools = {
    async list_tabs() {
      const a = activity("Looking at your tabs");
      const tabs = await ctx.windowTabs();
      const active = await ctx.activeTab();
      a.done(`${tabs.length} tabs`);
      return tabs.map((t) => `- id ${t.id}${t.id === active?.id ? " (current)" : ""}: ${t.title} (${t.url})`).join("\n") || "No tabs.";
    },

    async read_tab({ tab_id, offset }) {
      const tab = await chrome.tabs.get(tab_id).catch(() => null);
      if (!tab) throw new Error(`No tab with id ${tab_id}.`);
      const a = activity(`Reading “${tab.title}”`);
      const text = await readTabText(tab);
      a.done();
      return chunk(text, offset);
    },

    async open_url({ url, offset }) {
      let u;
      try {
        u = new URL(url);
      } catch {
        throw new Error("That isn't a valid URL.");
      }
      if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https links can be opened.");
      // A link already seen opens without its #fragment, so nothing new can ride along
      // in it; anything else opens exactly as you approved it.
      let target = clean(u.href);
      if (!seen.has(target)) {
        if (!sites.has(siteOf(u.href)) && !(await approve(u.href))) throw new Error("The user didn't allow opening that link.");
        target = u.href;
      }
      seen.add(clean(target));
      const a = activity(`Opening ${u.hostname}`);
      const current = await ctx.activeTab();
      const tab = await chrome.tabs.create({ url: target, active: false, windowId: current?.windowId });
      try {
        await waitForLoad(tab.id);
        const loaded = await chrome.tabs.get(tab.id);
        const text = await readTabText(loaded);
        a.done(loaded.title);
        return chunk(text, offset);
      } catch (e) {
        a.fail();
        throw e;
      } finally {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    },

    async youtube_comments({ tab_id, count = 100 }) {
      const tab = await chrome.tabs.get(tab_id).catch(() => null);
      if (!tab || !/youtube\.com\/watch/.test(tab.url)) throw new Error("That tab isn't a YouTube video.");
      const a = activity("Loading more YouTube comments");
      const { comments } = await ctx.youtubeDetails(tab.id, Math.min(200, Math.max(1, count | 0)));
      a.done(`${comments.length} comments`);
      const text = comments.map((c) => `- ${c.author}${c.likes ? ` (${c.likes} likes)` : ""}: ${c.text}`).join("\n");
      remember(text);
      return chunk(text || "No comments found.");
    },
  };

  return async (name, input) => {
    const fn = tools[name];
    if (!fn) return { content: `Unknown tool ${name}.`, isError: true };
    try {
      return { content: await fn(input || {}), isError: false };
    } catch (e) {
      return { content: e.message || String(e), isError: true };
    }
  };
}
