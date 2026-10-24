// OpenAI, Gemini and DeepSeek all speak the OpenAI Chat Completions format,
// so one implementation covers all three API-key providers.

const config = require("../config");
const { sse, request, once, openaiContent, history, run } = require("./http");
const { SYSTEM_PROMPT } = require("./prompt");
const { MAX_CALLS, BROWSE_PROMPT, openaiTools } = require("./tools");

// Chat-capable models only; these APIs also list embedding, audio, image and dated snapshot models.
const OPENAI_SKIP = /audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|codex|\d{4}-\d{2}-\d{2}/;
const GEMINI_SKIP = /embedding|tts|image|live|aqa|imagen|veo/;

function make({ id, label, keyName, baseUrl, filter = () => true }) {
  const headers = () => ({
    authorization: `Bearer ${config.getKey(keyName)}`,
    "content-type": "application/json",
  });

  return {
    id,
    label,
    keyName,

    isAvailable: async () => !!config.getKey(keyName),

    models: once(async () => {
      const { data } = await (await request(`${baseUrl}/models`, headers())).json();
      return data
        .map((m) => m.id.replace(/^models\//, ""))
        .filter(filter)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        .map((m) => ({ id: m, label: m }));
    }),

    chat(req, callbacks) {
      const browse = !!callbacks.tool;
      const messages = [
        { role: "system", content: browse ? `${SYSTEM_PROMPT} ${BROWSE_PROMPT}` : SYSTEM_PROMPT },
        ...history(req),
        { role: "user", content: openaiContent(req) },
      ];

      return run(async function* (signal) {
        let wrote = false;
        for (let calls = 0; ; ) {
          const res = await request(`${baseUrl}/chat/completions`, headers(), {
            model: req.model,
            messages,
            stream: true,
            ...(browse && calls < MAX_CALLS && { tools: openaiTools(callbacks.toolNames) }),
          }, signal);

          let text = "";
          const toolCalls = [];
          for await (const ev of sse(res)) {
            if (ev.error) throw new Error(ev.error.message || "Stream error");
            const choice = ev.choices?.[0];
            const d = choice?.delta;
            if (d?.content) {
              if (wrote && !text) yield "\n\n";
              text += d.content;
              wrote = true;
              yield d.content;
            }
            for (const tc of d?.tool_calls || []) {
              const slot = (toolCalls[tc.index ?? toolCalls.length] ??= { id: "", name: "", args: "" });
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name += tc.function.name;
              if (tc.function?.arguments) slot.args += tc.function.arguments;
            }
          }
          const calls_ = toolCalls.filter(Boolean);
          if (!calls_.length) return; // a plain answer: done

          messages.push({
            role: "assistant",
            content: text || null,
            tool_calls: calls_.map((c, i) => ({ id: c.id || `call_${i}`, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
          });
          for (const [i, c] of calls_.entries()) {
            calls++;
            let input = {};
            try {
              input = JSON.parse(c.args || "{}");
            } catch {}
            const r = await callbacks.tool(c.name, input);
            messages.push({ role: "tool", tool_call_id: c.id || `call_${i}`, content: r.isError ? `Error: ${r.content}` : r.content });
          }
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
