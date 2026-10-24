// Claude via the Anthropic API, with your own key.

const config = require("../config");
const { sse, request, once, anthropicContent, history, run } = require("./http");
const { SYSTEM_PROMPT } = require("./prompt");
const { MAX_CALLS, BROWSE_PROMPT, anthropicTools } = require("./tools");

const API = "https://api.anthropic.com/v1";
const headers = () => ({
  "x-api-key": config.getKey("anthropic"),
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
});

module.exports = {
  id: "anthropic-api",
  label: "Claude (API key)",
  keyName: "anthropic",

  isAvailable: async () => !!config.getKey("anthropic"),

  models: once(async () => {
    const { data } = await (await request(`${API}/models?limit=100`, headers())).json();
    return data.map((m) => ({ id: m.id, label: m.display_name || m.id }));
  }),

  chat(req, callbacks) {
    const browse = !!callbacks.tool;
    const system = browse ? `${SYSTEM_PROMPT} ${BROWSE_PROMPT}` : SYSTEM_PROMPT;
    const messages = [...history(req), { role: "user", content: anthropicContent(req) }];

    return run(async function* (signal) {
      let wrote = false;
      for (let calls = 0; ; ) {
        const res = await request(`${API}/messages`, headers(), {
          model: req.model,
          max_tokens: 8192,
          system,
          messages,
          stream: true,
          // Out of tool calls: no tools offered, so the model has to answer.
          ...(browse && calls < MAX_CALLS && { tools: anthropicTools(callbacks.toolNames) }),
        }, signal);

        const blocks = [];
        let stop = null;
        for await (const ev of sse(res)) {
          if (ev.type === "content_block_start") blocks[ev.index] = { ...ev.content_block, json: "" };
          if (ev.type === "content_block_delta") {
            const b = blocks[ev.index];
            if (ev.delta.type === "text_delta") {
              if (wrote && !b.text) yield "\n\n"; // keep text from separate turns apart
              b.text = (b.text || "") + ev.delta.text;
              wrote = true;
              yield ev.delta.text;
            } else if (ev.delta.type === "input_json_delta") b.json += ev.delta.partial_json;
          }
          if (ev.type === "message_delta") stop = ev.delta?.stop_reason;
          if (ev.type === "error") throw new Error(ev.error?.message || "Stream error");
        }
        if (stop !== "tool_use") return;

        const content = blocks.filter(Boolean).flatMap((b) =>
          b.type === "text" && b.text ? [{ type: "text", text: b.text }]
          : b.type === "tool_use" ? [{ type: "tool_use", id: b.id, name: b.name, input: JSON.parse(b.json || "{}") }]
          : []
        );
        messages.push({ role: "assistant", content });
        const results = [];
        for (const use of content.filter((c) => c.type === "tool_use")) {
          calls++;
          const r = await callbacks.tool(use.name, use.input);
          results.push({ type: "tool_result", tool_use_id: use.id, content: r.content, is_error: r.isError });
        }
        messages.push({ role: "user", content: results });
      }
    }, callbacks);
  },
};
