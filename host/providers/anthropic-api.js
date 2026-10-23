// Claude via the Anthropic API, with your own key.

const config = require("../config");
const { sse, failure, anthropicContent, history, run } = require("./http");
const { SYSTEM_PROMPT } = require("./prompt");

const API = "https://api.anthropic.com/v1";
const headers = () => ({
  "x-api-key": config.getKey("anthropic"),
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

let cachedModels = null;

module.exports = {
  id: "anthropic-api",
  label: "Claude (API key)",
  keyName: "anthropic",

  isAvailable: async () => !!config.getKey("anthropic"),

  async models() {
    if (cachedModels) return cachedModels;
    const res = await fetch(`${API}/models?limit=100`, { headers: headers() });
    if (!res.ok) throw new Error(await failure(res));
    const { data } = await res.json();
    cachedModels = data.map((m) => ({ id: m.id, label: m.display_name || m.id }));
    return cachedModels;
  },

  chat(req, callbacks) {
    const messages = [...history(req), { role: "user", content: anthropicContent(req) }];

    return run(async function* (signal) {
      const res = await fetch(`${API}/messages`, {
        method: "POST",
        headers: headers(),
        signal,
        body: JSON.stringify({ model: req.model, max_tokens: 8192, system: SYSTEM_PROMPT, messages, stream: true }),
      });
      if (!res.ok) throw new Error(await failure(res));
      for await (const ev of sse(res)) {
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") yield ev.delta.text;
        if (ev.type === "error") throw new Error(ev.error?.message || "Stream error");
      }
    }, callbacks);
  },
};
