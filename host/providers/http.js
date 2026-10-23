// Shared helpers for providers: streaming SSE reader, request → message builders,
// and transcript replay for CLIs.
//
// A chat request from the panel looks like:
//   { prompt, history: [{ role: "user" | "assistant", content: string }],
//     attachments: [{ kind: "image" | "pdf", mime, name, data /* base64 */ }] }
// The panel owns the conversation, so API providers are stateless.

async function* sse(response) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of response.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
        // ignore keep-alives and partial lines
      }
    }
  }
}

async function failure(response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    const err = Array.isArray(body) ? body[0]?.error : body.error;
    return `${response.status}: ${err?.message || text}`;
  } catch {
    return `${response.status}: ${text.slice(0, 300)}`;
  }
}

// Anthropic Messages API content blocks (also accepted by `claude -p --input-format stream-json`).
function anthropicContent({ prompt, attachments = [] }) {
  const blocks = attachments.map((a) =>
    a.kind === "image"
      ? { type: "image", source: { type: "base64", media_type: a.mime, data: a.data } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name }
  );
  return [...blocks, { type: "text", text: prompt }];
}

// OpenAI Chat Completions content parts.
function openaiContent({ prompt, attachments = [] }) {
  if (!attachments.length) return prompt;
  return [
    { type: "text", text: prompt },
    ...attachments.map((a) =>
      a.kind === "image"
        ? { type: "image_url", image_url: { url: `data:${a.mime};base64,${a.data}` } }
        : { type: "file", file: { filename: a.name || "document.pdf", file_data: `data:application/pdf;base64,${a.data}` } }
    ),
  ];
}

const history = (req) => (req.history || []).map((h) => ({ role: h.role, content: h.content }));

// When a CLI can't resume its own session (after an edit, a regenerate, or switching
// in an old chat), replay the conversation so far as text ahead of the new message.
const REPLAY_LIMIT = 60000;
function withTranscript(req) {
  if (req.resume || !req.history?.length) return req.prompt;
  let transcript = req.history.map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n\n");
  if (transcript.length > REPLAY_LIMIT) transcript = "…" + transcript.slice(-REPLAY_LIMIT);
  return `<conversation_so_far>\n${transcript}\n</conversation_so_far>\n\n${req.prompt}`;
}

// Run a streaming request; returns a cancel function. `stream` yields text chunks.
function run(stream, { delta, done, error }) {
  const controller = new AbortController();
  (async () => {
    try {
      for await (const chunk of stream(controller.signal)) delta(chunk);
      done();
    } catch (e) {
      if (!controller.signal.aborted) error(e.message);
    }
  })();
  return () => controller.abort();
}

module.exports = { sse, failure, anthropicContent, openaiContent, history, withTranscript, run };
