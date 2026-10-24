// API keys live in ~/.config/lumen/config.json (owner-only permissions),
// never in the extension, so web pages and other extensions can't reach them.

const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".config", "lumen");
const FILE = path.join(DIR, "config.json");

// A missing file is an empty config. An unreadable one throws, so a following save
// can't overwrite the other keys with {}; reads (`read`) just see no settings.
function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw new Error(`Couldn't read ${FILE}: ${e.message}`);
  }
}
const read = () => {
  try {
    return load();
  } catch {
    return {};
  }
};

// Write a temp file and rename it over the old one, so a reader never sees half a file.
function save(config) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // `mode` only applies when the file is first created
  fs.renameSync(tmp, FILE);
}

module.exports = {
  getKey: (name) => read().keys?.[name] || "",

  setKey(name, value) {
    const config = load();
    config.keys = { ...config.keys, [name]: value || undefined };
    save(config);
  },

  keyStatus(names) {
    const keys = read().keys || {};
    return Object.fromEntries(names.map((n) => [n, !!keys[n]]));
  },

  // Login providers are opt-in: being signed in to a CLI isn't enough, the user
  // has to connect it from the panel first.
  isConnected: (providerId) => !!read().connected?.[providerId],

  setConnected(providerId, on) {
    const config = load();
    config.connected = { ...config.connected, [providerId]: on || undefined };
    save(config);
  },
};
