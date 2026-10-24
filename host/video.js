// Timestamped video content for the model, from the router (where YouTube's caption
// blocks on browser extensions don't apply):
//   1. captions via yt-dlp: manual subtitles, else YouTube's auto captions (seconds)
//   2. otherwise download the audio and transcribe it here: Parakeet (English and
//      European languages, fast) or whisper.cpp (any language) (minutes)
//   3. separately, Gemini can "watch" a public YouTube video, if there's a Gemini key
// Results are cached per video in ~/Library/Caches/lumen/transcripts.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("./config");

const BIN = {
  ytdlp: process.env.LUMEN_YTDLP_BIN || "yt-dlp",
  parakeet: process.env.LUMEN_PARAKEET_BIN || "parakeet-mlx",
  whisper: process.env.LUMEN_WHISPER_BIN || "whisper-cli",
};
const CACHE = path.join(os.homedir(), "Library", "Caches", "lumen", "transcripts");
const WORK = path.join(os.tmpdir(), "lumen-video");
const MODELS = path.join(os.homedir(), "Library", "Application Support", "lumen", "models");
// Override with LUMEN_WHISPER_MODEL (a file name from huggingface.co/ggerganov/whisper.cpp,
// e.g. ggml-small.bin) for a smaller download.
const WHISPER_MODEL = process.env.LUMEN_WHISPER_MODEL || "ggml-large-v3-turbo.bin";
const WHISPER_MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL}`;
const OUTPUT_LIMIT = 90000; // characters of transcript kept per video
const CHUNK = 30000; // characters per tool call; the model pages with `offset`
// Languages the Parakeet TDT 0.6B v3 model covers; anything else goes to whisper.cpp.
const PARAKEET_LANGS = new Set("bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk".split(" "));

for (const d of [CACHE, WORK, MODELS]) fs.mkdirSync(d, { recursive: true });

// ---------- process helpers ----------

// `signal` (the chat's) kills the process when the chat is cancelled.
function run(bin, args, { onLine, signal, timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: WORK, stdio: ["ignore", "pipe", "pipe"], signal });
    let out = "";
    let err = "";
    const lines = (chunk, sink) => {
      sink(chunk);
      if (onLine) String(chunk).split(/[\r\n]+/).filter(Boolean).forEach(onLine);
    };
    child.stdout.on("data", (c) => lines(c, (x) => (out += x)));
    child.stderr.on("data", (c) => lines(c, (x) => (err += x)));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Couldn't run ${path.basename(bin)}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split("\n").filter(Boolean).pop() || `${path.basename(bin)} exited with ${code}`));
    });
  });
}

const has = (bin) => run(bin, ["--help"], { timeoutMs: 15000 }).then(() => true, () => false);

let found = null; // { at, ytdlp, parakeet, whisper }: checked at most once a minute
async function available() {
  if (!found || Date.now() - found.at > 60000) {
    const [ytdlp, parakeet, whisper] = await Promise.all([has(BIN.ytdlp), has(BIN.parakeet), has(BIN.whisper)]);
    found = { at: Date.now(), ytdlp, parakeet, whisper };
  }
  return { ...found, gemini: !!config.getKey("gemini") };
}

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

// ---------- video info & captions ----------

async function videoInfo(url, signal) {
  if (!/^https?:\/\//i.test(url)) throw new Error("That isn't an http(s) video URL.");
  const out = await run(BIN.ytdlp, ["-J", "--skip-download", "--no-playlist", "--no-warnings", "--js-runtimes", "node", "--", url], { timeoutMs: 90000, signal });
  return JSON.parse(out);
}

// Manual subtitles in the video's language beat auto captions; "-orig" is the
// untranslated auto-caption track.
function pickCaptions(info) {
  const lang = (info.language || "").split("-")[0];
  const json3 = (list) => list?.find((f) => f.ext === "json3");
  const manual = info.subtitles || {};
  const auto = info.automatic_captions || {};
  const manualKey =
    Object.keys(manual).find((k) => k.split("-")[0] === lang && k !== "live_chat") ||
    Object.keys(manual).find((k) => k !== "live_chat");
  if (manualKey && json3(manual[manualKey])) return { kind: "subtitles", lang: manualKey, url: json3(manual[manualKey]).url };
  const autoKey = Object.keys(auto).find((k) => k.endsWith("-orig")) || (auto[lang] && lang);
  if (autoKey && json3(auto[autoKey])) return { kind: "auto captions", lang: autoKey.replace(/-orig$/, ""), url: json3(auto[autoKey]).url };
  return null;
}

async function fetchCaptions(pick, signal) {
  const res = await fetch(pick.url, { headers: { "user-agent": "Mozilla/5.0" }, signal });
  if (!res.ok) throw new Error(`Captions download failed (${res.status}).`);
  const data = await res.json();
  return (data.events || [])
    .filter((e) => e.segs)
    .map((e) => ({ start: e.tStartMs / 1000, text: e.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text);
}

// ---------- local transcription ----------

async function downloadAudio(info, progress, signal) {
  const file = path.join(WORK, `${info.id}.wav`);
  if (fs.existsSync(file)) return file;
  progress("Downloading the audio");
  await run(
    BIN.ytdlp,
    ["-f", "bestaudio", "-x", "--audio-format", "wav", "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
     "--no-playlist", "--js-runtimes", "node", "-o", path.join(WORK, `${info.id}.%(ext)s`), "--", info.webpage_url],
    {
      signal,
      onLine: (l) => {
        const m = l.match(/\[download\]\s+([\d.]+)%/);
        if (m) progress("Downloading the audio", `${Math.floor(Number(m[1]))}%`);
      },
    }
  );
  return file;
}

async function ensureWhisperModel(progress, signal) {
  const file = path.join(MODELS, WHISPER_MODEL);
  if (fs.existsSync(file)) return file;
  const label = `Downloading the whisper.cpp model (once${WHISPER_MODEL.includes("large-v3-turbo") ? ", about 1.6 GB" : ""})`;
  progress(label);
  const res = await fetch(WHISPER_MODEL_URL, { signal });
  if (!res.ok) throw new Error(`Model download failed (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let last = 0;
  for await (const chunk of res.body) {
    out.write(chunk);
    got += chunk.length;
    if (total && Date.now() - last > 1000) {
      last = Date.now();
      progress(label, `${Math.floor((100 * got) / total)}%`);
    }
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, file);
  return file;
}

async function transcribeParakeet(file, progress, signal) {
  const cached = fs.existsSync(path.join(os.homedir(), ".cache", "huggingface", "hub", "models--mlx-community--parakeet-tdt-0.6b-v3", "snapshots"));
  progress("Transcribing with Parakeet", cached ? undefined : "first run downloads its 2.5 GB model");
  await run(BIN.parakeet, [file, "--output-format", "json", "--output-dir", WORK], { signal });
  const json = JSON.parse(fs.readFileSync(file.replace(/\.wav$/, ".json"), "utf8"));
  return (json.sentences || []).map((s) => ({ start: s.start, text: String(s.text || "").trim() })).filter((s) => s.text);
}

async function transcribeWhisper(file, lang, progress, signal) {
  const model = await ensureWhisperModel(progress, signal);
  progress("Transcribing with whisper.cpp");
  const base = file.replace(/\.wav$/, "");
  await run(BIN.whisper, ["-m", model, "-f", file, "-l", lang || "auto", "-oj", "-of", base, "-pp"], {
    signal,
    onLine: (l) => {
      const m = l.match(/progress\s*=\s*(\d+)%/);
      if (m) progress("Transcribing with whisper.cpp", `${m[1]}%`);
    },
  });
  const json = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"));
  return (json.transcription || []).map((s) => ({ start: (s.offsets?.from || 0) / 1000, text: String(s.text || "").trim() })).filter((s) => s.text);
}

// ---------- formatting ----------

// Merge caption fragments into lines of about `every` seconds, coarser if it's too long.
function toLines(segments) {
  for (const every of [10, 20, 40, 80]) {
    const lines = [];
    let cur = null;
    for (const s of segments) {
      if (!cur || s.start - cur.start >= every) {
        cur = { start: s.start, parts: [] };
        lines.push(cur);
      }
      cur.parts.push(s.text);
    }
    const text = lines.map((l) => `[${fmt(l.start)}] ${l.parts.join(" ")}`).join("\n");
    if (text.length <= OUTPUT_LIMIT || every === 80) return text.slice(0, OUTPUT_LIMIT);
  }
}

// ---------- public ----------

// Returns a text block: header + "[m:ss] …" lines, CHUNK characters at a time
// starting at `offset`. progress(label, note?) shows status; `signal` cancels.
async function transcript(url, progress, offset = 0, signal) {
  progress("Looking up the video");
  const info = await videoInfo(url, signal);
  const cacheFile = path.join(CACHE, `${info.id}.json`);
  let result = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : null;

  if (!result) {
    // LUMEN_VIDEO_FORCE_LOCAL=1 skips captions (for testing the transcription path).
    const pick = process.env.LUMEN_VIDEO_FORCE_LOCAL ? null : pickCaptions(info);
    if (pick) {
      progress(`Reading YouTube ${pick.kind}`);
      result = { source: `YouTube ${pick.kind} (${pick.lang})`, segments: await fetchCaptions(pick, signal) };
    } else {
      const { parakeet, whisper } = await available();
      const lang = (info.language || "").split("-")[0];
      const useParakeet = parakeet && (!lang || PARAKEET_LANGS.has(lang));
      if (!useParakeet && !whisper) {
        throw new Error("This video has no captions, and no local transcriber is installed. Install one: uv tool install parakeet-mlx (English/European) or brew install whisper.cpp (any language), then re-run host/install.sh.");
      }
      const file = await downloadAudio(info, progress, signal);
      const segments = useParakeet ? await transcribeParakeet(file, progress, signal) : await transcribeWhisper(file, lang, progress, signal);
      fs.rm(file, () => {});
      result = { source: useParakeet ? "local transcription (Parakeet)" : "local transcription (whisper.cpp)", segments };
    }
    if (result.segments.length) fs.writeFileSync(cacheFile, JSON.stringify(result));
  }

  if (!result.segments.length) throw new Error("The transcript came back empty.");
  const chapters = (info.chapters || []).map((c) => `[${fmt(c.start_time)}] ${c.title}`).join("\n");
  const body = toLines(result.segments);
  const start = Math.max(0, offset | 0);
  // Cut at a line break so no line is split between chunks.
  let end = Math.min(body.length, start + CHUNK);
  if (end < body.length) end = body.lastIndexOf("\n", end) > start ? body.lastIndexOf("\n", end) : end;
  const rest = body.length - end;
  return [
    `Video: ${info.title} (${fmt(info.duration || 0)}) by ${info.channel || info.uploader || "unknown"}`,
    `Transcript source: ${result.source}. Times are when each line starts; use them exactly.`,
    start === 0 && chapters && `Chapters:\n${chapters}`,
    body.slice(start, end).trim(),
    rest > 0 && `(Transcript continues: call video_transcript again with offset ${end} for the rest, ${rest} more characters.)`,
  ].filter(Boolean).join("\n\n");
}

// Gemini watches a public YouTube video (sees and hears it) and answers a question.
async function geminiWatch(url, question, progress, signal) {
  const key = config.getKey("gemini");
  if (!key) throw new Error("No Gemini API key saved.");
  progress("Gemini is watching the video");
  const api = "https://generativelanguage.googleapis.com/v1beta";
  const list = await fetch(`${api}/models?pageSize=200&key=${key}`, { signal }).then((r) => r.json());
  const model = (list.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /^models\/gemini-[\d.]+-flash$/.test(m.name))
    .map((m) => m.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (!model) throw new Error("Couldn't find a Gemini Flash model for this key.");
  const res = await fetch(`${api}/${model}:generateContent?key=${key}`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ file_data: { file_uri: url } }, { text: `${question}\nGive timestamps as m:ss (or h:mm:ss).` }] }],
      generationConfig: { mediaResolution: "MEDIA_RESOLUTION_LOW" },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Gemini error ${res.status}`);
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text) throw new Error("Gemini returned no answer (the video may be private or too long).");
  return `${model.replace("models/", "")} watched the video:\n\n${text}`;
}

module.exports = { available, transcript, geminiWatch };
