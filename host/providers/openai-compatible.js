// OpenAI, Gemini and DeepSeek all speak the OpenAI Chat Completions format,
// so one implementation covers all three API-key providers.

const config = require("../config");
const { sse, failure, openaiContent, history, run } = require("./http");
const { SYSTEM_PROMPT } = require("./prompt");

// Chat-capable models only; these APIs also list embedding, audio, image and dated snapshot models.
const OPENAI_SKIP = /audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex|\d{4}-\d{2}-\d{2}/;
const GEMINI_SKIP = /embedding|tts|image|live|aqa|imagen|veo/;

function make({ id, label, keyName, baseUrl, filter = () => true }) {
  let cachedModels = null;
  const headers = () => ({
    authorization: `Bearer ${config.getKey(keyName)}`,
    "content-type": "application/json",
  });

  return {
    id,
    label,
    keyName,

    isAvailable: async () => !!config.getKey(keyName),

    async models() {
      if (cachedModels) return cachedModels;
      const res = await fetch(`${baseUrl}/models`, { headers: headers() });
      if (!res.ok) throw new Error(await failure(res));
      const { data } = await res.json();
      cachedModels = data
        .map((m) => m.id.replace(/^models\//, ""))
        .filter(filter)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((m) => ({ id: m, label: m }));
      return cachedModels;
    },

    chat(req, callbacks) {
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history(req),
        { role: "user", content: openaiContent(req) },
      ];

      return run(async function* (signal) {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: headers(),
          signal,
          body: JSON.stringify({ model: req.model, messages, stream: true }),
        });
        if (!res.ok) throw new Error(await failure(res));
        for await (const ev of sse(res)) {
          if (ev.error) throw new Error(ev.error.message || "Stream error");
          const text = ev.choices?.[0]?.delta?.content;
          if (text) yield text;
        }
      }, callbacks);
    },
  };
}

module.exports = [
  make({
    id: "openai-api",
    label: "OpenAI (API key)",
    keyName: "openai",
    baseUrl: "https://api.openai.com/v1",
    filter: (m) => /^(gpt-|o\d|chatgpt)/.test(m) && !OPENAI_SKIP.test(m),
  }),
  make({
    id: "gemini-api",
    label: "Gemini (API key)",
    keyName: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    filter: (m) => m.startsWith("gemini") && !GEMINI_SKIP.test(m),
  }),
  make({
    id: "deepseek-api",
    label: "DeepSeek (API key)",
    keyName: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
  }),
];
