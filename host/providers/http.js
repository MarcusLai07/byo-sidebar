// Shared helpers for API-key providers: streaming SSE reader and in-memory chat history.

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

// API chats are stateless, so the router keeps each conversation's turns here.
// It lives as long as the panel's connection; a reopened panel starts fresh anyway.
const histories = new Map();

function history(sessionId, resume) {
  if (!resume || !histories.has(sessionId)) histories.set(sessionId, []);
  return histories.get(sessionId);
}

// Run a streaming request; returns a cancel function. `stream` yields text chunks.
function run(stream, { delta, done, error }, onComplete) {
  const controller = new AbortController();
  (async () => {
    let text = "";
    try {
      for await (const chunk of stream(controller.signal)) {
        text += chunk;
        delta(chunk);
      }
      onComplete(text);
      done();
    } catch (e) {
      if (!controller.signal.aborted) error(e.message);
    }
  })();
  return () => controller.abort();
}

module.exports = { sse, failure, history, run };
