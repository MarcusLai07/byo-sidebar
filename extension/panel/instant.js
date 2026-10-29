// Instant actions: answers Lumen works out itself, on this device, with no AI and no
// tokens. Each returns Markdown for a local chat message (follow-up questions can see
// it). `when(tab)` says whether the action applies to the current tab.

import * as ctx from "./context.js";
import * as techstack from "./techstack.js";

const host = ctx.hostOf;
const isYouTubeVideo = (tab) => /^https:\/\/(www\.|m\.)?youtube\.com\/watch/.test(tab?.url || "");
const isWeb = (tab) => /^https?:/.test(tab?.url || "");
const isPr = (tab) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(tab?.url || "");
const BUCKET = { pass: "✓", fail: "✕", pending: "●", skipping: "–", cancel: "–" };
const mdText = (s) => String(s).replace(/([[\]`*_|])/g, "\\$1").replace(/\s+/g, " ").trim();

const inPage = (tab, func) => ctx.inPage(tab.id, func).catch(() => {
  throw new Error("This page can't be read by extensions.");
});

// ---------- page scripts (run in the tab) ----------

function outlineScript() {
  return [...document.querySelectorAll("h1, h2, h3, h4")]
    .filter((h) => h.offsetParent !== null && h.textContent.trim())
    .slice(0, 120)
    .map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.replace(/\s+/g, " ").trim().slice(0, 140), id: h.id || h.closest("[id]")?.id || "" }));
}

function contactsScript() {
  const text = document.body.innerText;
  const emails = new Set();
  const phones = new Set();
  const socials = new Map();
  for (const a of document.querySelectorAll("a[href]")) {
    const h = a.getAttribute("href") || "";
    if (h.startsWith("mailto:")) {
      const e = h.slice(7).split("?")[0];
      try { emails.add(decodeURIComponent(e)); } catch { emails.add(e); }
    }
    if (h.startsWith("tel:")) phones.add(h.slice(4).replace(/[^\d+]/g, ""));
    const m = a.href.match(/^https?:\/\/(?:www\.)?(x\.com|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|youtube\.com|github\.com|t\.me|wa\.me|discord\.gg|threads\.net)\/[^?#\s]+/i);
    if (m && !socials.has(m[0])) socials.set(m[0], m[1].toLowerCase());
  }
  for (const m of text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g)) emails.add(m[0].replace(/\.$/, ""));
  for (const m of text.matchAll(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{3,4}/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15 && /[\s()+-]/.test(m[0])) phones.add(m[0].trim());
  }
  return { emails: [...emails].slice(0, 50), phones: [...phones].slice(0, 30), socials: [...socials].slice(0, 30) };
}

function infoScript() {
  const meta = (sel) => document.querySelector(sel)?.content?.trim() || "";
  const text = document.body.innerText || "";
  const words = (text.match(/\S+/g) || []).length;
  return {
    title: document.title,
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    author: meta('meta[name="author"]') || meta('meta[property="article:author"]'),
    published: meta('meta[property="article:published_time"]') || document.querySelector("time[datetime]")?.getAttribute("datetime") || "",
    modified: meta('meta[property="article:modified_time"]') || document.lastModified,
    canonical: document.querySelector('link[rel="canonical"]')?.href || "",
    lang: document.documentElement.lang || "",
    words,
    headings: document.querySelectorAll("h1, h2, h3").length,
    images: document.images.length,
    links: document.links.length,
    videos: document.querySelectorAll("video, iframe[src*='youtube'], iframe[src*='vimeo']").length,
  };
}

// ---------- actions ----------

const TIME = /(?:^|[^\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/;

// Pull "m:ss label" lines out of a block of text (a description or a comment).
function timedLines(text) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    const m = raw.match(TIME);
    if (!m) continue;
    const label = raw.replace(/[[\]()]/g, " ").replace(m[1], "").replace(/^[\s\-–—:|•.]+|[\s\-–—:|•]+$/g, "").replace(/\s+/g, " ").trim();
    out.push({ t: m[1], label });
  }
  return out;
}

export const INSTANT = [
  {
    id: "prchecks",
    name: "PR checks",
    sub: "Each check's status, with links",
    when: isPr,
    async run(tab, { github }) {
      const checks = await github("checks", { url: tab.url });
      if (!checks.length) return { text: "This pull request has no checks." };
      const order = { fail: 0, pending: 1, pass: 2 };
      checks.sort((a, b) => (order[a.bucket] ?? 3) - (order[b.bucket] ?? 3));
      const failed = checks.filter((c) => c.bucket === "fail").length;
      const rows = checks.map((c) => `| ${BUCKET[c.bucket] || "·"} | ${c.link ? `[${mdText(c.name)}](${c.link})` : mdText(c.name)} | ${mdText(c.workflow || "")} |`);
      return {
        text: [`**${checks.length} checks**${failed ? ` · ${failed} failed` : " · none failed"}`, "", "| | Check | Workflow |", "|---|---|---|", ...rows].join("\n"),
      };
    },
  },
  {
    id: "prrerun",
    name: "Re-run failed checks",
    sub: "Only the failed GitHub Actions jobs",
    when: isPr,
    async run(tab, { github }) {
      const { rerun, others } = await github("rerunFailed", { url: tab.url });
      const note = others.length ? `\n\n${others.map(mdText).join(", ")} failed too, but ${others.length > 1 ? "they run" : "it runs"} outside GitHub Actions: re-run ${others.length > 1 ? "them" : "it"} from that service.` : "";
      return { text: (rerun ? `Re-running the failed jobs of ${rerun} workflow run${rerun > 1 ? "s" : ""}.` : "No failed GitHub Actions jobs to re-run.") + note };
    },
  },
  {
    id: "prdiff",
    name: "PR diff",
    sub: "The full diff, for follow-up questions",
    when: isPr,
    async run(tab, { github }) {
      const d = await github("diff", { url: tab.url });
      const MAX = 60000;
      const body = d.diff.length > MAX ? `${d.diff.slice(0, MAX)}\n… (${d.diff.length - MAX} more characters not shown)` : d.diff;
      return {
        text: [
          `**${mdText(d.title)}** · \`${d.headRefName}\` → \`${d.baseRefName}\` · ${d.changedFiles} files, +${d.additions} −${d.deletions}`,
          "",
          "*Ask a follow-up (review it, explain a change, write the description) and your model sees this diff.*",
          "",
          "```diff",
          body.replace(/^```/gm, "` ``"),
          "```",
        ].join("\n"),
      };
    },
  },
  {
    id: "prbranch",
    name: "Copy branch name",
    sub: "And the checkout command",
    when: isPr,
    async run(tab, { github }) {
      const i = await github("info", { url: tab.url });
      await navigator.clipboard.writeText(i.headRefName);
      const number = tab.url.match(/\/pull\/(\d+)/)[1];
      return { text: `Copied \`${i.headRefName}\` (into \`${i.baseRefName}\`).\n\nTo check it out: \`gh pr checkout ${number}\`` };
    },
  },
  {
    id: "techstack",
    name: "Detect tech stack",
    sub: "Frameworks, CMS, analytics, hosting…",
    when: isWeb,
    async run(tab) {
      return { text: techstack.toMarkdown(await techstack.detect(tab)) };
    },
  },
  {
    id: "timestamps",
    name: "Video timestamps",
    sub: "From the description and comments",
    when: isYouTubeVideo,
    async run(tab) {
      const yt = await ctx.youtubeDetails(tab.id, 100);
      const sources = [
        { from: "the description", lines: timedLines(yt.description) },
        ...yt.comments.map((c) => ({ from: `a comment by ${c.author}${c.likes ? ` (${c.likes} likes)` : ""}`, lines: timedLines(c.text) })),
      ].filter((s) => s.lines.length >= 3);
      if (!sources.length) {
        return { text: "No timestamp list in the description or top comments.\n\n*Use the **Timestamps** AI skill to work them out from the transcript.*", sourceTab: tab };
      }
      // The longest list is usually the full chapter list or tracklist.
      const best = sources.sort((a, b) => b.lines.length - a.lines.length)[0];
      const rows = best.lines.map((l) => `| ${l.t} | ${mdText(l.label) || "–"} |`);
      return {
        text: [`**${best.lines.length} timestamps** from ${mdText(best.from)} · click a time to jump`, "", "| Time | |", "|---|---|", ...rows].join("\n"),
        sourceTab: tab,
      };
    },
  },
  {
    id: "transcript",
    name: "Video transcript",
    sub: "Captions or local transcription, via the router",
    when: isYouTubeVideo,
    async run(tab, { localTool }) {
      let text = "";
      for (let offset = 0, page = 0; offset != null && page < 6; page++) {
        const chunk = await localTool("video_transcript", { url: tab.url, offset });
        text += (page ? "\n" : "") + chunk.replace(/\n\n\(Transcript continues:[\s\S]*$/, "");
        const next = chunk.match(/offset (\d+) for the rest/);
        offset = next ? Number(next[1]) : null;
      }
      const [head, ...rest] = text.split("\n\n");
      const lines = rest.join("\n\n").split("\n").filter((l) => /^\[/.test(l));
      const body = lines.map((l) => {
        const m = l.match(/^\[([\d:]+)\]\s*(.*)$/);
        return m ? `${m[1]}  ${mdText(m[2])}` : mdText(l);
      });
      return { text: [`**Transcript** · ${mdText(head.replace(/^Video: /, ""))}`, "", ...body.map((b) => `${b}  `)].join("\n"), sourceTab: tab };
    },
  },
  {
    id: "outline",
    name: "Page outline",
    sub: "Its headings, click to jump",
    when: isWeb,
    async run(tab) {
      const heads = await inPage(tab, outlineScript);
      if (!heads.length) return { text: "This page has no headings." };
      const base = tab.url.split("#")[0];
      const min = Math.min(...heads.map((h) => h.level));
      const lines = heads.map((h) => `${"  ".repeat(h.level - min)}- ${h.id ? `[${mdText(h.text)}](${base}#${encodeURIComponent(h.id)})` : mdText(h.text)}`);
      return { text: [`**Outline of ${host(tab.url)}** · ${heads.length} headings`, "", ...lines].join("\n"), sourceTab: tab };
    },
  },
  {
    id: "links",
    name: "Links on this page",
    sub: "Every link, this site's first",
    when: isWeb,
    async run(tab) {
      const links = await ctx.pageLinks(tab.id, 300);
      if (!links.length) return { text: "No links on this page." };
      const origin = new URL(tab.url).origin;
      const inside = links.filter(([, href]) => href.startsWith(origin));
      const outside = links.filter(([, href]) => !href.startsWith(origin));
      const list = (ls) => ls.slice(0, 80).map(([text, href]) => `- [${mdText(text)}](${href})`);
      return {
        text: [
          `**${links.length} links** on ${host(tab.url)}`,
          "",
          ...(inside.length ? [`**On this site** (${inside.length})`, ...list(inside), ""] : []),
          ...(outside.length ? [`**Elsewhere** (${outside.length})`, ...list(outside)] : []),
        ].join("\n"),
      };
    },
  },
  {
    id: "contacts",
    name: "Contacts on this page",
    sub: "Emails, phone numbers, social profiles",
    when: isWeb,
    async run(tab) {
      const { emails, phones, socials } = await inPage(tab, contactsScript);
      if (!emails.length && !phones.length && !socials.length) return { text: `No contact details found on ${host(tab.url)}.` };
      return {
        text: [
          `**Contacts on ${host(tab.url)}**`,
          "",
          ...(emails.length ? ["**Email**", ...emails.map((e) => `- [${mdText(e)}](mailto:${e})`), ""] : []),
          ...(phones.length ? ["**Phone**", ...phones.map((p) => `- [${mdText(p)}](tel:${p.replace(/[^\d+]/g, "")})`), ""] : []),
          ...(socials.length ? ["**Social**", ...socials.map(([url, site]) => `- [${site}](${url})`)] : []),
        ].join("\n"),
      };
    },
  },
  {
    id: "pageinfo",
    name: "Page info",
    sub: "Words, reading time, dates, language",
    when: isWeb,
    async run(tab) {
      const i = await inPage(tab, infoScript);
      const minutes = Math.max(1, Math.round(i.words / 230));
      const row = (k, v) => (v ? `- **${k}:** ${v}` : null);
      const date = (d) => (d && !isNaN(new Date(d)) ? new Date(d).toLocaleString() : "");
      return {
        text: [
          `**${mdText(i.title || host(tab.url))}**`,
          i.description ? `\n${mdText(i.description)}\n` : "",
          ...[
            row("Reading time", `${minutes} min (${i.words.toLocaleString()} words)`),
            row("Language", i.lang),
            row("Author", mdText(i.author)),
            row("Published", date(i.published)),
            row("Updated", date(i.modified)),
            row("Headings · images · links", `${i.headings} · ${i.images} · ${i.links}`),
            row("Videos", i.videos || ""),
            row("Canonical URL", i.canonical ? `[${host(i.canonical)}](${i.canonical})` : ""),
          ].filter(Boolean),
        ].join("\n"),
      };
    },
  },
];
