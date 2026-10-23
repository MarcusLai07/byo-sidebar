// Small, dependency-free Markdown renderer for chat replies.
// Everything is HTML-escaped first, so model output can never inject markup.
(function () {
  const escape = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = escape(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escape(codes[i])}</code>`);
  }

  function render(src) {
    const lines = src.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let para = [];
    let list = null;

    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
      list = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const fence = line.match(/^```(\w*)/);
      if (fence) {
        flushPara();
        flushList();
        const code = [];
        while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
        out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,3})\s+(.*)/);
      if (heading) {
        flushPara();
        flushList();
        out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
        continue;
      }

      const item = line.match(/^\s*([-*]|\d+\.)\s+(.*)/);
      if (item) {
        flushPara();
        const tag = /\d/.test(item[1]) ? "ol" : "ul";
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push(item[2]);
        continue;
      }

      if (!line.trim()) {
        flushPara();
        flushList();
        continue;
      }

      flushList();
      para.push(line);
    }
    flushPara();
    flushList();
    return out.join("");
  }

  window.renderMarkdown = render;
})();
