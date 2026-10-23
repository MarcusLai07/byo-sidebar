// Saved chats, kept in IndexedDB on this machine only.
//
// chat = { id, title, createdAt, updatedAt,
//          providerId, modelId,           // last model used
//          sessionId, sessionProvider,    // CLI session the chat can resume, and whose it is
//          cliSession,                    // provider-chosen session id (Codex thread)
//          messages: [message] }
// message = { role: "user" | "assistant", display, prompt?, text?, error?, model?,
//             labels?: [string], pages?: [url] /* pages whose text it carried */, sourceTabId?, sourceUrl? }

const DB = "byo-sidebar";
const STORE = "chats";

let dbPromise = null;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("updatedAt", "updatedAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const getChat = (id) => tx("readonly", (s) => s.get(id));
export const deleteChat = (id) => tx("readwrite", (s) => s.delete(id));

// Attachment bytes stay in memory only; saved chats keep their names (in labels).
export function saveChat(chat) {
  const copy = {
    ...chat,
    messages: chat.messages.map(({ attachments, ...m }) => ({
      ...m,
      // Tool rows keep their text; approval callbacks can't be stored.
      ...(m.tools && { tools: m.tools.map(({ label, status, note }) => ({ label, status: status === "asking" ? "failed" : status, note })) }),
    })),
  };
  return tx("readwrite", (s) => s.put(copy));
}

export async function listChats() {
  const all = await tx("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
