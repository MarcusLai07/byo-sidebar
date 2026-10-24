// Motion for the panel, built on anime.js (vendored: extensions can't load remote code).
// Every helper is a no-op when the system asks for reduced motion.

import { animate as rawAnimate, stagger, spring, splitText } from "../vendor/anime.esm.min.js";

// Every animation gets a deadline: if frames are throttled (panel half-hidden, busy
// machine) it jumps to its end state instead of leaving things invisible.
function animate(targets, params) {
  const anim = rawAnimate(targets, params);
  if (!params.loop) {
    setTimeout(() => {
      if (!anim.completed) anim.complete();
    }, 2500);
  }
  return anim;
}

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
// Also skip when the panel isn't visible: frames don't run in the background, so an
// entrance animation would hold things at opacity 0 until the panel is shown.
const on = () => !reduced.matches && document.visibilityState === "visible";
const springy = (bounce = 0.32, duration = 520) => spring({ bounce, duration });

// First open: header buttons drop in, then the welcome line types itself in.
export function intro() {
  if (!on()) return;
  animate("header > *", {
    opacity: [0, 1],
    translateY: [-8, 0],
    delay: stagger(45),
    ease: springy(0.3, 600),
  });
  const title = document.querySelector("#empty p:first-child");
  if (title && !title.dataset.split) {
    title.dataset.split = "1";
    const { words } = splitText(title, { words: true });
    animate(words, { opacity: [0, 1], translateY: [10, 0], filter: ["blur(4px)", "blur(0px)"], delay: stagger(40, { start: 250 }), duration: 520, ease: "out(3)" });
  }
  animate("#empty .hint", { opacity: [0, 1], translateY: [6, 0], delay: 650, duration: 500, ease: "out(3)" });
  animate("footer", { opacity: [0, 1], translateY: [14, 0], delay: 120, ease: springy(0.25, 700) });
}

// Something new on screen: a message, chip, card or row.
export function popIn(el, { from = 8, scale = 0.94, delay = 0 } = {}) {
  if (!on() || !el) return;
  animate(el, { opacity: [0, 1], translateY: [from, 0], scale: [scale, 1], delay, ease: springy() });
}

// A list appearing: rows cascade in.
export function cascade(nodes, { gap = 28, from = 10, max = 24 } = {}) {
  if (!on()) return;
  const list = [...nodes].slice(0, max);
  if (!list.length) return;
  animate(list, { opacity: [0, 1], translateY: [from, 0], delay: stagger(gap), duration: 420, ease: "out(3)" });
}

// Grid tiles (media, extensions): scale up from the middle outward.
export function tilesIn(nodes) {
  if (!on()) return;
  const list = [...nodes].slice(0, 40);
  if (!list.length) return;
  animate(list, { opacity: [0, 1], scale: [0.85, 1], delay: stagger(22, { from: "first" }), ease: springy(0.35, 560) });
}

// The ⚡ menu: the panel unfolds, then its rows slide in.
export function menuIn(menu) {
  if (!on()) return;
  animate(menu, { scaleY: [0.85, 1], scaleX: [0.96, 1], opacity: [0, 1], duration: 380, ease: springy(0.28, 420) });
  animate(menu.querySelectorAll(".menu-heading, .item"), {
    opacity: [0, 1],
    translateX: [-10, 0],
    delay: stagger(22, { start: 60 }),
    duration: 360,
    ease: "out(3)",
  });
}

// A button press: a quick squash and bounce back.
export function press(el) {
  if (!on() || !el) return;
  animate(el, { scale: [{ to: 0.82, duration: 90, ease: "out(2)" }, { to: 1, ease: springy(0.5, 520) }] });
}

// A view (history, info, media, extensions) sliding in.
export function viewIn(el) {
  if (!on() || !el) return;
  animate(el, { opacity: [0, 1], translateY: [12, 0], duration: 360, ease: "out(3)" });
}

export function toastIn(el) {
  if (!on()) return;
  animate(el, { opacity: [0, 1], translateY: [16, 0], scale: [0.9, 1], ease: springy(0.45, 520) });
}

// Three dots that bounce while the model hasn't said anything yet. Returns stop().
export function thinking(container) {
  const box = document.createElement("span");
  box.className = "thinking";
  box.setAttribute("aria-label", "Thinking");
  for (let i = 0; i < 3; i++) box.append(document.createElement("i"));
  container.append(box);
  const anim = on()
    ? animate(box.children, {
        translateY: [{ to: -5, duration: 360 }, { to: 0, duration: 360 }],
        opacity: [{ to: 1, duration: 360 }, { to: 0.35, duration: 360 }],
        delay: stagger(140),
        loopDelay: 180,
        loop: true,
        ease: "inOut(2)",
      })
    : null;
  return () => {
    anim?.pause();
    box.remove();
  };
}

// The send button breathing while a reply streams.
export function busy(el, isBusy) {
  if (!on() || !el) return;
  el._pulse?.pause();
  el._pulse = null;
  if (isBusy) {
    el._pulse = animate(el, { boxShadow: ["0 0 0 0 rgba(217,119,87,0.55)", "0 0 0 9px rgba(217,119,87,0)"], duration: 1200, loop: true, ease: "out(2)" });
  } else {
    el.style.boxShadow = "";
  }
}

// Capture countdown: the number punches in each second and the ring drains.
// Shows `secondsLeft`, and drains the ring to where it'll be one second later.
export function countdownTick(num, arc, secondsLeft, total) {
  num.textContent = secondsLeft;
  const offset = 100 - (100 * (secondsLeft - 1)) / total;
  if (!on()) {
    arc.style.strokeDashoffset = offset;
    return;
  }
  animate(num, { scale: [1.6, 1], opacity: [0, 1], ease: springy(0.45, 500) });
  animate(arc, { strokeDashoffset: offset, duration: 950, ease: "linear" });
}

export function flash(el) {
  if (!on() || !el) return;
  animate(el, { backgroundColor: ["rgba(255,255,255,0.9)", "rgba(255,255,255,0)"], duration: 450, ease: "out(2)" });
}

// For the classic media-strip script, which can't import modules.
window.lumenMotion = { popIn, tilesIn, cascade };
