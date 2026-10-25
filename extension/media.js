// Media strip: an Arc-style mini player for every tab that's playing (or has played) media.
// probe() and control() run inside the page (main world, every frame), so they must be self-contained.

(function () {
  // Sites whose own buttons do more than the <video>/<audio> element can (skip tracks,
  // or players like Spotify that don't expose a normal media element).
  const ADAPTERS = {
    "www.youtube.com": { next: ".ytp-next-button", prev: ".ytp-prev-button" },
    "music.youtube.com": { next: ".next-button", prev: ".previous-button", toggle: "#play-pause-button" },
    "open.spotify.com": {
      next: '[data-testid="control-button-skip-forward"]',
      prev: '[data-testid="control-button-skip-back"]',
      toggle: '[data-testid="control-button-playpause"]',
    },
    "soundcloud.com": { next: ".skipControl__next", prev: ".skipControl__previous", toggle: ".playControl" },
  };

  // Further back than this from the newest moment of a live stream counts as "behind".
  // Players normally sit a few segments (up to ~20s) behind the edge, so allow for that.
  const LIVE_SLACK = 30;

  function probe(adapters, slack) {
    const site = adapters[location.hostname] || {};
    // Present and enabled is enough: YouTube hides its next button in narrow players
    // with display:none, but clicking it still works.
    const usable = (sel) => {
      const el = sel && document.querySelector(sel);
      return !!el && !el.disabled && el.getAttribute("aria-disabled") !== "true";
    };

    // Prefer what's playing, then what has been played, then the longest thing on the page.
    const media = [...document.querySelectorAll("video, audio")]
      .filter((m) => m.currentSrc || m.srcObject)
      .filter((m) => !(m.muted && m.currentTime === 0 && m.paused)) // hover previews, muted autoplay stubs
      .sort((a, b) => (a.paused - b.paused) || (b.currentTime > 0) - (a.currentTime > 0) || (b.duration || 0) - (a.duration || 0))[0];

    const meta = navigator.mediaSession?.metadata;
    if (!media && !meta && !usable(site.toggle)) return null;

    const art = meta?.artwork?.length ? meta.artwork[meta.artwork.length - 1].src : null;
    const toggleEl = site.toggle && document.querySelector(site.toggle);
    // Players without a media element: read paused state off their play button's label.
    const labelPaused = toggleEl ? /play/i.test(toggleEl.getAttribute("aria-label") || toggleEl.title || "") : null;

    // Live: an endless stream (Twitch, beIN, most HLS) or a YouTube live player, whose
    // "LIVE" badge is disabled while you're watching the live edge.
    const ytLive = location.hostname.endsWith("youtube.com") && document.querySelector(".html5-video-player.ytp-live");
    const live = !!media && (media.duration === Infinity || !!ytLive);
    let behind = null;
    if (live && media.seekable.length) behind = Math.max(0, media.seekable.end(media.seekable.length - 1) - media.currentTime);
    const badge = ytLive && document.querySelector(".ytp-live-badge");
    const atEdge = live && (badge ? badge.disabled || badge.hasAttribute("disabled") : behind == null || behind < slack);

    return {
      hasElement: !!media,
      live,
      atEdge,
      behind,
      paused: media ? media.paused : labelPaused ?? navigator.mediaSession?.playbackState !== "playing",
      currentTime: media && isFinite(media.currentTime) ? media.currentTime : null,
      duration: media && isFinite(media.duration) && !live ? media.duration : null,
      title: meta?.title || null,
      artist: meta?.artist || null,
      artwork: art,
      canNext: usable(site.next),
      canPrev: usable(site.prev),
      score: media ? (!media.paused ? 3 : media.currentTime > 0 ? 2 : 1) : meta ? 1 : 0,
    };
  }

  function control(adapters, action, value) {
    const site = adapters[location.hostname] || {};
    const click = (sel) => {
      const el = sel && document.querySelector(sel);
      if (el) el.click();
      return !!el;
    };
    const media = [...document.querySelectorAll("video, audio")]
      .filter((m) => m.currentSrc || m.srcObject)
      .sort((a, b) => (a.paused - b.paused) || (b.currentTime > 0) - (a.currentTime > 0) || (b.duration || 0) - (a.duration || 0))[0];

    if (action === "pause") {
      // Pause only (never resumes): used when a player is closed from the strip.
      if (media && !media.paused) {
        media.pause();
        return true;
      }
      const toggleEl = !media && site.toggle && document.querySelector(site.toggle);
      if (toggleEl && /pause/i.test(toggleEl.getAttribute("aria-label") || toggleEl.title || "")) toggleEl.click();
      return true;
    }
    if (action === "next") return click(site.next);
    if (action === "prev") return click(site.prev);
    if (action === "toggle") {
      if (site.toggle && click(site.toggle)) return true;
      if (!media) return false;
      if (media.paused) media.play().catch(() => {});
      else media.pause();
      return true;
    }
    if (action === "seek" && media && isFinite(media.duration)) {
      media.currentTime = Math.max(0, Math.min(media.duration, value));
      return true;
    }
    if (action === "live" && media) {
      // YouTube's own badge also resets its playback speed and buffering for the edge.
      const badge = document.querySelector(".html5-video-player.ytp-live .ytp-live-badge");
      if (badge && !badge.disabled) badge.click();
      else if (media.seekable.length) media.currentTime = Math.max(0, media.seekable.end(media.seekable.length - 1) - 2);
      if (media.paused) media.play().catch(() => {});
      return true;
    }
    if (action === "skip" && media) {
      media.currentTime = Math.max(0, media.currentTime + value);
      return true;
    }
    return false;
  }

  // ---------- panel side ----------

  const POLL_MS = 1000;
  const els = {};
  let tracked = new Set(); // tabs that have played sound (from the background worker)
  let dismissed = new Set(); // tabs the user closed in the strip; they return if they play again
  let timer = null;
  // Minimized: players shrink to small tabs; clicking one expands just that player.
  let collapsed = (() => {
    try {
      return localStorage.getItem("mediaCollapsed") === "1";
    } catch {
      return false;
    }
  })();
  let focusId = null; // tab id of the player expanded while minimized
  let lastPlayers = [];
  let shownIds = new Set(); // players already on screen, so only new ones animate in

  async function run(tabId, func, args) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        func,
        args,
      });
      return results.map((r) => ({ frameId: r.frameId, value: r.result })).filter((r) => r.value != null);
    } catch {
      return []; // tab closed, discarded, or a page extensions can't touch
    }
  }

  async function candidates() {
    const audible = await chrome.tabs.query({ audible: true });
    for (const t of audible) dismissed.delete(t.id);
    const ids = new Set([...tracked, ...audible.map((t) => t.id)]);
    const tabs = await Promise.all([...ids].map((id) => chrome.tabs.get(id).catch(() => null)));
    return tabs.filter((t) => t && !dismissed.has(t.id) && /^https?:/.test(t.url || ""));
  }

  // Polls and tab events overlap: only the latest refresh may render, and none while hidden.
  let refreshSeq = 0;
  async function refresh() {
    if (document.visibilityState !== "visible") return;
    const seq = ++refreshSeq;
    const tabs = await candidates();
    const players = await Promise.all(
      tabs.map(async (tab) => {
        const frames = await run(tab.id, probe, [ADAPTERS, LIVE_SLACK]);
        const best = frames.sort((a, b) => b.value.score - a.value.score)[0];
        // Keep audible tabs even when nothing can be read (e.g. Web Audio), so they can still be muted.
        if (!best && !tab.audible) return null;
        return { tab, frameId: best?.frameId, state: best?.value || { paused: false, hasElement: false } };
      })
    );
    if (seq === refreshSeq) render(players.filter(Boolean));
  }

  async function act(player, action, value) {
    const target = { tabId: player.tab.id, ...(player.frameId != null && { frameIds: [player.frameId] }) };
    try {
      if (action === "mute") {
        await chrome.tabs.update(player.tab.id, { muted: !player.tab.mutedInfo?.muted });
      } else if (action === "focus") {
        await chrome.tabs.update(player.tab.id, { active: true });
        await chrome.windows.update(player.tab.windowId, { focused: true });
      } else if (action === "dismiss") {
        // Closing a player pauses it too; it comes back if it plays again.
        dismissed.add(player.tab.id);
        if (focusId === player.tab.id) focusId = null;
        await chrome.scripting.executeScript({ target, world: "MAIN", func: control, args: [ADAPTERS, "pause", null] });
      } else {
        // Script arguments must be JSON-serializable: `undefined` makes executeScript throw
        // before it even returns a promise, which is why only mute used to work.
        await chrome.scripting.executeScript({ target, world: "MAIN", func: control, args: [ADAPTERS, action, value ?? null] });
      }
    } catch (e) {
      console.warn("Lumen media control failed:", action, e);
    }
    setTimeout(refresh, 150);
  }

  const fmt = (s) => {
    if (s == null) return "";
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  };

  function button(label, title, onClick, disabled) {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.disabled = !!disabled;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  async function setCollapsed(on) {
    const m = window.lumenMotion;
    // Flip the chevron on the current button first: the strip redraws, so a new
    // button would appear already flipped and never animate.
    els.list.querySelector(".media-toggle")?.classList.toggle("flipped", on);
    const old = [...els.list.querySelectorAll(".media-cards, .media-pills, .player")];
    if (m) await Promise.all([m.leave(old, { y: on ? 6 : -6, scale: 0.95, duration: 150 }), new Promise((r) => setTimeout(r, 320))]);
    collapsed = on;
    focusId = null;
    try {
      localStorage.setItem("mediaCollapsed", on ? "1" : "0");
    } catch {}
    shownIds = new Set(); // everything that appears now animates in
    render(lastPlayers);
  }

  // One player as a card. `compact` stacks the controls under the title for the
  // two-column layout.
  function card(p, compact) {
    const { tab, state } = p;
    const el = document.createElement("div");
    el.className = `player${compact ? " compact" : ""}`;
    el.dataset.tab = tab.id;
    el.title = "Go to tab";
    el.addEventListener("click", () => act(p, "focus"));

    const art = document.createElement("img");
    art.className = "art";
    art.alt = "";
    const artSrc = state.artwork || tab.favIconUrl;
    if (artSrc) art.src = artSrc;

    const info = document.createElement("div");
    info.className = "info";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = state.title || tab.title || "Untitled";
    const sub = document.createElement("div");
    sub.className = "sub";
    const host = new URL(tab.url).hostname.replace(/^www\./, "");
    sub.textContent = [state.artist || host, state.duration ? `${fmt(state.currentTime)} / ${fmt(state.duration)}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (state.live) sub.prepend(liveButton(p));
    info.append(title, sub);

    const controls = document.createElement("div");
    controls.className = "controls";
    const canToggle = state.hasElement || state.title || state.score > 0;
    if (state.canPrev) controls.append(button("⏮", "Previous", () => act(p, "prev")));
    else if (state.hasElement) controls.append(button("↺", "Back 10 seconds", () => act(p, "skip", -10)));
    controls.append(button(state.paused ? "▶" : "⏸", state.paused ? "Play" : "Pause", () => act(p, "toggle"), !canToggle));
    if (state.canNext) controls.append(button("⏭", "Next", () => act(p, "next")));
    else if (state.hasElement) controls.append(button("↻", "Forward 10 seconds", () => act(p, "skip", 10)));
    controls.append(
      button(tab.mutedInfo?.muted ? "🔇" : "🔊", tab.mutedInfo?.muted ? "Unmute tab" : "Mute tab", () => act(p, "mute")),
      button("✕", "Pause and hide", () => act(p, "dismiss"))
    );

    el.append(art, info, controls);

    if (state.duration) {
      const bar = document.createElement("div");
      bar.className = "progress";
      bar.title = "Seek";
      const fill = document.createElement("div");
      fill.style.width = `${(100 * (state.currentTime || 0)) / state.duration}%`;
      bar.append(fill);
      bar.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = bar.getBoundingClientRect();
        act(p, "seek", ((e.clientX - r.left) / r.width) * state.duration);
      });
      el.append(bar);
    }
    return el;
  }

  // Live streams: a red LIVE tag while you're watching the newest moment; fall behind
  // (paused, or skipped back) and it glows as GO LIVE, which jumps back to the edge.
  function liveButton(p) {
    const { atEdge, behind } = p.state;
    const b = button("", atEdge ? "Watching live" : `${behind ? `${fmt(behind)} behind live. ` : ""}Jump to live`, () => act(p, "live"), atEdge);
    b.className = `live-btn${atEdge ? " on" : " behind"}`;
    b.append(Object.assign(document.createElement("span"), { className: "dot", ariaHidden: "true" }), atEdge ? "Live" : "Go live");
    if (!atEdge && behind) b.append(Object.assign(document.createElement("small"), { textContent: `−${fmt(behind)}` }));
    return b;
  }

  // A minimized player: artwork, title and whether it's playing.
  function pill(p) {
    const { tab, state } = p;
    const b = document.createElement("button");
    b.type = "button";
    b.className = `media-pill${focusId === tab.id ? " on" : ""}${state.paused ? "" : " playing"}${state.live ? " live" : ""}`;
    b.dataset.tab = tab.id;
    b.title = state.title || tab.title || "";
    const art = document.createElement("img");
    art.alt = "";
    const artSrc = state.artwork || tab.favIconUrl;
    if (artSrc) art.src = artSrc;
    const name = document.createElement("span");
    name.textContent = state.title || tab.title || "Untitled";
    b.append(art, name);
    b.addEventListener("click", () => {
      focusId = focusId === tab.id ? null : tab.id;
      render(lastPlayers);
    });
    return b;
  }

  function render(players) {
    lastPlayers = players;
    els.root.hidden = players.length === 0;
    if (!players.length) return els.list.replaceChildren();
    if (focusId != null && !players.some((p) => p.tab.id === focusId)) focusId = null;

    const head = document.createElement("div");
    head.className = "media-strip-head";
    const label = document.createElement("span");
    const playing = players.filter((p) => !p.state.paused).length;
    label.textContent = `${players.length} player${players.length === 1 ? "" : "s"}${playing ? ` · ${playing} playing` : ""}`;
    const toggle = button("", collapsed ? "Show all players" : "Minimize", () => setCollapsed(!collapsed));
    toggle.className = `media-toggle${collapsed ? " flipped" : ""}`;
    toggle.innerHTML = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
    head.append(label, toggle);

    const body = [];
    if (collapsed) {
      const focused = players.find((p) => p.tab.id === focusId);
      if (focused) body.push(card(focused, false));
      const pills = document.createElement("div");
      pills.className = "media-pills";
      pills.append(...players.map(pill));
      body.push(pills);
    } else {
      const grid = document.createElement("div");
      grid.className = players.length > 1 ? "media-cards two" : "media-cards";
      grid.append(...players.map((p) => card(p, players.length > 1)));
      body.push(grid);
    }
    els.list.replaceChildren(head, ...body);
    const ids = new Set(players.map((p) => p.tab.id));
    els.list.querySelectorAll("[data-tab]").forEach((node, i) => {
      if (!shownIds.has(Number(node.dataset.tab))) window.lumenMotion?.popIn(node, { from: 6, scale: 0.92, delay: i * 40 });
    });
    shownIds = ids;
  }

  function schedule() {
    clearInterval(timer);
    timer = null;
    if (document.visibilityState === "visible") {
      refresh();
      timer = setInterval(refresh, POLL_MS);
    }
  }

  // Tabs only join the strip once they make sound, and that list is lost when the
  // extension reloads or the browser restarts. So on open, also look for tabs whose
  // video or audio has already been played (now paused) and add them.
  function playedScript() {
    return [...document.querySelectorAll("video, audio")].some((m) => (m.currentSrc || m.srcObject) && m.currentTime > 1);
  }

  async function discover() {
    const tabs = (await chrome.tabs.query({})).filter((t) => /^https?:/.test(t.url || "") && !t.discarded).slice(0, 60);
    const found = await Promise.all(
      tabs.map(async (t) => {
        if (tracked.has(t.id)) return null;
        const results = await chrome.scripting
          .executeScript({ target: { tabId: t.id, allFrames: true }, func: playedScript })
          .catch(() => []);
        return results.some((r) => r.result) ? t.id : null;
      })
    );
    const ids = found.filter((id) => id != null);
    if (!ids.length) return;
    const { mediaTabs = [] } = await chrome.storage.session.get("mediaTabs");
    await chrome.storage.session.set({ mediaTabs: [...new Set([...mediaTabs, ...ids])] });
  }

  async function init() {
    els.root = document.getElementById("media");
    els.list = document.getElementById("media-list");
    const { mediaTabs = [] } = await chrome.storage.session.get("mediaTabs");
    tracked = new Set(mediaTabs);
    discover();
    chrome.storage.session.onChanged.addListener((changes) => {
      if (changes.mediaTabs) {
        tracked = new Set(changes.mediaTabs.newValue || []);
        refresh();
      }
    });
    chrome.tabs.onUpdated.addListener((_, info) => {
      if ("audible" in info || "mutedInfo" in info || info.title) refresh();
    });
    chrome.tabs.onRemoved.addListener(refresh);
    document.addEventListener("visibilitychange", schedule);
    schedule();
  }

  init();
})();
