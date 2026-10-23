// Provider registry. Each provider exports:
//   id, label
//   keyName (API-key providers) and isAvailable(): Promise<boolean>
//   or login: { name, install, signIn }, isInstalled() and account() (login providers)
//   models(): Promise<[{ id, label }]>
//   chat(request, { delta, done, error }): cancel function

const config = require("../config");

const all = [
  require("./claude-cli"),
  require("./codex-cli"),
  require("./gemini-cli"),
  require("./anthropic-api"),
  ...require("./openai-compatible"),
];

// A login provider is usable only when its CLI is installed, signed in, and the
// user has connected it from the panel.
async function loginState(p) {
  const installed = await p.isInstalled();
  const account = installed ? await p.account() : null;
  return { id: p.id, ...p.login, installed, account, connected: config.isConnected(p.id) };
}

async function usable(p) {
  if (!p.login) return p.isAvailable();
  if (!config.isConnected(p.id)) return false;
  return !!(await p.account());
}

module.exports = {
  get: (id) => all.find((p) => p.id === id),

  keyNames: () => all.filter((p) => p.keyName).map((p) => p.keyName),

  isLogin: (id) => !!all.find((p) => p.id === id)?.login,

  logins: () => Promise.all(all.filter((p) => p.login).map(loginState)),

  isUsable: (id) => {
    const p = all.find((x) => x.id === id);
    return p ? usable(p) : false;
  },

  async available() {
    const checks = all.map(async (p) => {
      if (!(await usable(p))) return null;
      try {
        return { id: p.id, label: p.label, models: await p.models() };
      } catch (e) {
        return { id: p.id, label: p.label, models: [], error: e.message };
      }
    });
    return (await Promise.all(checks)).filter(Boolean);
  },
};
