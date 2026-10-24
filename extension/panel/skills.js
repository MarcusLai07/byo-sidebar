// Skills: reusable prompts triggered with "/" in the composer.
// A prompt can use {input} (what you type after the skill), {selection} (highlighted
// text), {tab} (the current page) and {tabs} (the @-mentioned tabs, or every tab in
// the window if none are mentioned).

export const BUILTIN = [
  { id: "summarize", name: "Summarize", prompt: "Summarize {tab} in a few bullet points, then give a one-line takeaway. {input}" },
  { id: "explain", name: "Explain", prompt: "Explain {selection} in plain language, with an example if it helps. {input}" },
  { id: "copyedit", name: "Copy edit", prompt: "Copy-edit {selection} for clarity, grammar and tone. Return the improved text first, then a short list of what you changed. {input}" },
  { id: "reply", name: "Reply", prompt: "Draft a reply to the message or email in {tab}. Points and tone to include: {input}" },
  { id: "translate", name: "Translate", prompt: "Translate {selection} into {input}. If no language is given, use English. Return only the translation." },
  { id: "compare", name: "Compare tabs", prompt: "Compare {tabs}: the key points of each, where they agree, and where they differ. {input}" },
  { id: "actions", name: "Action items", prompt: "List the action items, decisions, deadlines and owners in {tab}. {input}" },
  { id: "timestamps", name: "Timestamps", prompt: "List the chapters, topics or songs in the video on {tab} with their timestamps (m:ss) and a short label each. Use the description, comments and transcript; if none of them has timestamps, get the video's transcript with your tools. {input}" },
  { id: "eli5", name: "ELI5", prompt: "Explain {tab} like I'm five. {input}" },
  { id: "factcheck", name: "Fact check", prompt: "Point out claims in {tab} that look doubtful or need a source, and say why. {input}" },
];

const KEY = "customSkills";

export async function customSkills() {
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  return list;
}

const ORDER = "skillOrder";

// Skills in the order you arranged them (ⓘ → Skills, drag the ⋮⋮ grips). Skills not
// in the saved order (new ones) go at the end, built-ins first.
// Built-ins can be edited (your version is kept in OVERRIDES, with Reset to undo) or
// hidden (Delete; restorable). Your own skills are edited and deleted directly.
const OVERRIDES = "skillOverrides";
const HIDDEN = "hiddenSkills";

export async function hiddenBuiltins() {
  const { [HIDDEN]: hidden = [] } = await chrome.storage.local.get(HIDDEN);
  return BUILTIN.filter((s) => hidden.includes(s.id));
}

export async function allSkills() {
  const { [OVERRIDES]: overrides = {}, [HIDDEN]: hidden = [], [ORDER]: order = [] } = await chrome.storage.local.get([OVERRIDES, HIDDEN, ORDER]);
  const builtins = BUILTIN.filter((s) => !hidden.includes(s.id)).map((s) =>
    overrides[s.id] ? { ...s, ...overrides[s.id], builtin: true, edited: true } : { ...s, builtin: true }
  );
  const list = [...builtins, ...(await customSkills())];
  const rank = new Map(order.map((id, i) => [id, i]));
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (rank.get(a.s.id) ?? 1e6 + a.i) - (rank.get(b.s.id) ?? 1e6 + b.i))
    .map(({ s }) => s);
}

export async function saveOrder(ids) {
  await chrome.storage.local.set({ [ORDER]: ids });
}

export async function saveSkill(skill) {
  if (BUILTIN.some((b) => b.id === skill.id)) {
    const { [OVERRIDES]: overrides = {} } = await chrome.storage.local.get(OVERRIDES);
    await chrome.storage.local.set({ [OVERRIDES]: { ...overrides, [skill.id]: { name: skill.name, prompt: skill.prompt } } });
    return skill.id;
  }
  const list = await customSkills();
  const id = skill.id || `custom-${crypto.randomUUID().slice(0, 8)}`;
  const next = [...list.filter((s) => s.id !== id), { ...skill, id, custom: true }];
  await chrome.storage.local.set({ [KEY]: next });
  return id;
}

export async function deleteSkill(id) {
  if (BUILTIN.some((b) => b.id === id)) {
    const { [HIDDEN]: hidden = [] } = await chrome.storage.local.get(HIDDEN);
    await chrome.storage.local.set({ [HIDDEN]: [...new Set([...hidden, id])] });
    return;
  }
  const list = await customSkills();
  await chrome.storage.local.set({ [KEY]: list.filter((s) => s.id !== id) });
}

// Undo your edits to a built-in skill.
export async function resetSkill(id) {
  const { [OVERRIDES]: overrides = {} } = await chrome.storage.local.get(OVERRIDES);
  delete overrides[id];
  await chrome.storage.local.set({ [OVERRIDES]: overrides });
}

export async function restoreBuiltins() {
  await chrome.storage.local.set({ [HIDDEN]: [] });
}

export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

// What context a skill needs, so the panel gathers it even if the page chip is off.
export function needs(skill) {
  const p = skill?.prompt || "";
  return { tab: p.includes("{tab}"), selection: p.includes("{selection}"), tabs: p.includes("{tabs}") };
}

// Fill in the placeholders. The actual page/tab/selection content is attached as tagged
// blocks alongside, so the placeholders just point at them.
export function expand(skill, input, { hasSelection }) {
  return skill.prompt
    .replaceAll("{input}", input || "")
    .replaceAll("{tab}", "the current page (in <page>)")
    .replaceAll("{tabs}", "the tabs provided (in <tab> tags)")
    .replaceAll("{selection}", hasSelection ? "the selected text (in <selection>)" : "the current page (in <page>)")
    .replace(/\s+$/, "")
    .replace(/\s{2,}/g, " ");
}
