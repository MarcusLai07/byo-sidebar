# BYO Sidebar

Bring your own AI to your browser's sidebar. A Chromium extension (built for people who are done with Dia's built-in chat, but works in Chrome, Arc, Brave and Edge too) that gives you a chat panel where **you** pick the model, and signs in with an API key **or your existing login**.

- **Chat about your tabs:** the current page and highlighted text go along automatically (click the tab chip to leave it out). Type `@` to add other tabs or a whole tab group. PDFs open in a tab are sent as PDFs.
- **Skills:** type `/` for saved prompts (Summarize, Explain, Copy edit, Reply, Translate, Compare tabs, Action items, Timestamps, ELI5, Fact check), or write your own with `{tab}`, `{selection}`, `{tabs}` and `{input}` placeholders.
- **Attachments:** upload or paste images, PDFs and text files, screenshot the tab, or attach a recent download.
- **Clickable timestamps:** times in answers (`3:55`, `1:02:03`) jump the video or audio in the tab you asked about, like YouTube comment timestamps.
- **Saved chats:** every chat is kept locally and searchable. Edit a question or regenerate an answer, and switch models mid-chat.
- **Right-click and address bar:** select text → right-click → BYO Sidebar to explain, translate or copy-edit it, or ask about an image. Type `ai` + space in the address bar to ask from there.
- **Voice input** where the browser supports speech recognition.
- **Media strip:** an Arc-style mini player for every tab that's played sound this session (play/pause, next/previous or ±10s, seek, mute, jump to tab). Next/previous use the site's own buttons on YouTube, YouTube Music, Spotify and SoundCloud.
- **No API key needed for Claude:** it can use your signed-in [Claude Code](https://claude.com/claude-code) CLI, with all tools disabled.
- Everything runs on your machine; questions go only to the model provider you pick.

On YouTube, open **Show transcript** under the video for answers based on the full captions. YouTube blocks extensions from fetching captions directly, so otherwise the sidebar uses the description and comments.

> Not affiliated with The Browser Company or Dia. Browsers don't let extensions replace their built-in UI, so this runs in the extension side panel (or a docked window where side panels aren't supported).

## Providers

| Provider | Login mode (no key) | API key mode |
|---|---|---|
| Claude | [Claude Code](https://claude.com/claude-code): sign in by running `claude` | Anthropic key |
| OpenAI | [Codex CLI](https://github.com/openai/codex): `npm i -g @openai/codex`, then `codex login` with your ChatGPT account | OpenAI key |
| Gemini | [Gemini CLI](https://github.com/google-gemini/gemini-cli): `npm i -g @google/gemini-cli`, then run `gemini` and sign in with Google | Gemini key |
| DeepSeek | n/a (no official CLI) | DeepSeek key |

Add API keys from the panel's **ⓘ → Models & keys** section. They're saved to `~/.config/byo-sidebar/config.json` (readable only by you) and never stored in the extension. Model lists for API providers come live from each provider, so new models show up on their own.

Login mode notes:
- Every CLI runs in an empty folder with tools off or read-only, and without your CLI config, so it only chats.
- Codex returns each reply in one piece rather than streaming it.
- Re-run `./host/install.sh` after installing a new CLI so the router can find it.

## Install (macOS)

Requires Node.js 18+. Set up at least one login CLI or API key from the table above.

1. Register the local router with your browsers:

   ```bash
   ./host/install.sh
   ```

2. Open `dia://extensions` (or `chrome://extensions`), turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder.
3. Click the extension's toolbar icon, or set a shortcut in `dia://extensions/shortcuts`.

   **Dia users:** to have ⌘E open this instead of Dia's chat, first move Dia's own shortcuts in Dia → Settings → Shortcuts. Change **Chat…** (⌘E) and **New Chat** (⇧⌘E) to something else, then give BYO Sidebar ⌘E.

Test the router without the browser: `node host/test-host.js "hello" claude-cli haiku` (any provider id and model; it also checks that a follow-up remembers the first message).
Remove it with `./host/uninstall.sh`.

The installer copies the router to `~/Library/Application Support/byo-sidebar/host`, because macOS stops browsers from launching programs inside `~/Documents`, `~/Desktop` or `~/Downloads`. Re-run it after pulling updates. If the panel says it can't reach the router, check `~/Library/Logs/byo-sidebar/host.log`.

## How it works

```
Side panel (extension/)  ──native messaging──▶  host/router.js  ──▶  providers/*.js
                                                                    ├─ claude-cli / codex-cli / gemini-cli
                                                                    ├─ anthropic-api
                                                                    └─ openai-compatible: OpenAI, Gemini, DeepSeek
```

The panel (`extension/panel/`) owns the conversation and saves chats in IndexedDB. API providers get the history with every request; CLI providers resume their own session, or get the conversation replayed as text after an edit, a regenerate or a model switch.

The media strip (`extension/media.js`) needs no router: it reads and drives `<video>`/`<audio>` elements and the page's Media Session info directly. To support another site's skip buttons, add its selectors to `ADAPTERS`.

For development, `node dev/serve.js` serves:
- `/extension/sidepanel.html?harness`: the real panel with stubbed extension APIs and a fake router (`dev/chrome-stub.js`)
- `/dev/media-harness.html`: the media strip against a test tone

The extension has a fixed ID (from the `key` in `manifest.json`) so the router only accepts messages from it. To add a provider, drop a file in `host/providers/` and register it in `host/providers/index.js`.

## License

MIT
