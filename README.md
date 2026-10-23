# BYO Sidebar

Bring your own AI to your browser's sidebar. A Chromium extension (built for people who are done with Dia's built-in chat, but works in Chrome, Arc, Brave and Edge too) that gives you a chat panel where **you** pick the model, and signs in with an API key **or your existing login**.

- Chats about the page you're on (page text + highlighted text are sent automatically; click the tab chip to turn that off)
- Streams replies, keeps conversation history per chat
- An Arc-style media strip above the chat box: every tab that's played sound this session gets a mini player (artwork, title, play/pause, next/previous or ±10s, seek, mute, jump to tab), across all windows. Next/previous use the site's own buttons on YouTube, YouTube Music, Spotify and SoundCloud
- No API key needed for Claude: it uses the [Claude Code](https://claude.com/claude-code) CLI's login, with all tools disabled
- Everything runs on your machine; nothing goes anywhere except the model provider you chose

> Not affiliated with The Browser Company or Dia. Browsers don't let extensions replace their built-in UI, so this runs in the extension side panel (or a docked window where side panels aren't supported).

## Providers

| Provider | Login mode (no key) | API key mode |
|---|---|---|
| Claude | [Claude Code](https://claude.com/claude-code): sign in by running `claude` | Anthropic key |
| OpenAI | [Codex CLI](https://github.com/openai/codex): `npm i -g @openai/codex`, then `codex login` with your ChatGPT account | OpenAI key |
| Gemini | [Gemini CLI](https://github.com/google-gemini/gemini-cli): `npm i -g @google/gemini-cli`, then run `gemini` and sign in with Google | Gemini key |
| DeepSeek | n/a (no official CLI) | DeepSeek key |

Add API keys from the panel's **Keys** screen. They're saved to `~/.config/byo-sidebar/config.json` (readable only by you) and never stored in the extension. Model lists for API providers come live from each provider, so new models show up on their own.

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
3. Click the extension's toolbar icon or press **⌘⇧E**.

Test the router without the browser: `node host/test-host.js "hello" claude-cli haiku` (any provider id and model; it also checks that a follow-up remembers the first message).
Remove it with `./host/uninstall.sh`.

## How it works

```
Side panel (extension/)  ──native messaging──▶  host/router.js  ──▶  providers/*.js
                                                                    ├─ claude-cli / codex-cli / gemini-cli
                                                                    ├─ anthropic-api
                                                                    └─ openai-compatible: OpenAI, Gemini, DeepSeek
```

The media strip (`extension/media.js`) needs no router: it reads and drives `<video>`/`<audio>` elements and the page's Media Session info directly. To support another site's skip buttons, add its selectors to `ADAPTERS`. `node dev/serve.js` serves `dev/media-harness.html`, which runs the strip against a test tone with stubbed browser APIs.

The extension has a fixed ID (from the `key` in `manifest.json`) so the router only accepts messages from it. To add a provider, drop a file in `host/providers/` and register it in `host/providers/index.js`.

## License

MIT
