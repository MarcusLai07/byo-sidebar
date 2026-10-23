// Tiny static server for dev pages: node dev/serve.js [port]
// Serves the repo root so pages can load ../extension/* files.
//   /dev/media-harness.html             media strip against a test tone
//   /extension/sidepanel.html?harness   the real panel with stubbed extension APIs (dev/chrome-stub.js)
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || process.argv[2]) || 5317;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end("not found");
      if (url.searchParams.has("harness") && file.endsWith("sidepanel.html")) {
        data = Buffer.from(String(data).replace("<script", '<script src="/dev/chrome-stub.js"></script>\n  <script'));
      }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(data);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/extension/sidepanel.html?harness`));
