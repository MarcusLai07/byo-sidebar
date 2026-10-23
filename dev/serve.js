// Tiny static server for dev/ pages: node dev/serve.js [port]
// Serves the repo root so pages can load ../extension/* files.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || process.argv[2]) || 5317;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

http
  .createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end("not found");
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }).end(data);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/dev/media-harness.html`));
