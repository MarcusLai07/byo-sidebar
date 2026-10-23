// Provider registry. Each provider exports:
//   id, label, keyName? (API-key providers)
//   isAvailable(): Promise<boolean>
//   models(): Promise<[{ id, label }]>
//   chat(request, { delta, done, error }): cancel function

const all = [
  require("./claude-cli"),
  require("./codex-cli"),
  require("./gemini-cli"),
  require("./anthropic-api"),
  ...require("./openai-compatible"),
];

module.exports = {
  get: (id) => all.find((p) => p.id === id),

  keyNames: () => all.filter((p) => p.keyName).map((p) => p.keyName),

  async available() {
    const checks = all.map(async (p) => {
      if (!(await p.isAvailable())) return null;
      try {
        return { id: p.id, label: p.label, models: await p.models() };
      } catch (e) {
        return { id: p.id, label: p.label, models: [], error: e.message };
      }
    });
    return (await Promise.all(checks)).filter(Boolean);
  },
};
