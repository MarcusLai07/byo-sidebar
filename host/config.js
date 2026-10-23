// API keys live in ~/.config/byo-sidebar/config.json (owner-only permissions),
// never in the extension, so web pages and other extensions can't reach them.

const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".config", "byo-sidebar");
const FILE = path.join(DIR, "config.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(config) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(FILE, 0o600); // `mode` only applies when the file is first created
}

module.exports = {
  getKey: (name) => load().keys?.[name] || "",

  setKey(name, value) {
    const config = load();
    config.keys = { ...config.keys, [name]: value || undefined };
    save(config);
  },

  keyStatus(names) {
    const keys = load().keys || {};
    return Object.fromEntries(names.map((n) => [n, !!keys[n]]));
  },
};
