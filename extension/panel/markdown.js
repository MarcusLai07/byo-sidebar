// Small, dependency-free Markdown renderer for chat replies.
// Everything is HTML-escaped first, so model output can never inject markup.
// With { timestamps: true }, times like 3:55 or 1:02:03 become links the panel
// turns into "seek the video" clicks (like YouTube comment timestamps).

const escape = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TIMESTAMP = /(^|[^\w:/.])((?:(\d{1,2}):)?([0-5]?\d):([0-5]\d))(?![\w:])/g;

const emphasis = (s) =>
  s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");

// Code spans and links are set aside first, so the emphasis and timestamp rules can't
// reach into them (a "1:23" or "*" inside a URL stays part of the URL).
function inline(s, opts) {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  s = s.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${escape(c)}</code>`));
  // URLs may contain one level of parentheses, like Wikipedia's Foo_(bar).
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)(?:[^\s()]|\([^\s()]*\))+)\)/g, (_, text, url) =>
    hold(`<a href="${escape(url)}" target="_blank" rel="noopener">${emphasis(escape(text))}</a>`)
  );
  s = emphasis(escape(s));
  if (opts.timestamps) {
    s = s.replace(TIMESTAMP, (_, pre, all, h, m, sec) => {
      const t = (Number(h) || 0) * 3600 + Number(m) * 60 + Number(sec);
      return `${pre}<a class="ts" href="#" data-t="${t}" title="Jump to ${all}">${all}</a>`;
    });
  }
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[i]);
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function renderMarkdown(src, opts = {}) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, opts)).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((i) => `<li${i.depth ? ` class="d${Math.min(i.depth, 3)}"` : ""}>${inline(i.text, opts)}</li>`);
      out.push(`<${list.tag}>${items.join("")}</${list.tag}>`);
    }
    list = null;
  };
  const flush = () => (flushPara(), flushList());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flush();
      const code = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
      continue;
    }

    // Table: a header row followed by a |---|---| rule.
    if (isTableRow(line) && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      i--;
      const th = head.map((c) => `<th>${inline(c, opts)}</th>`).join("");
      const tb = rows.map((r) => `<tr>${head.map((_, j) => `<td>${inline(r[j] || "", opts)}</td>`).join("")}</tr>`).join("");
      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inline(heading[2], opts)}</h${level}>`);
      continue;
    }

    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }

    const quote = line.match(/^>\s?(.*)/);
    if (quote) {
      flush();
      out.push(`<blockquote>${inline(quote[1], opts)}</blockquote>`);
      continue;
    }

    const item = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
    if (item) {
      flushPara();
      const tag = /\d/.test(item[2]) ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push({ depth: Math.floor(item[1].length / 2), text: item[3] }); // nested items keep their indent
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    flushList();
    para.push(line);
  }
  flush();
  return out.join("");
}
