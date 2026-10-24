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
  animate(menu.querySelectorAll(".menu-heading, .menu-tabs, .menu-note, .item"), {
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

// Tab highlight gliding to the selected tab.
export function slidePill(pill, left, width, instant) {
  if (instant || !on()) {
    pill.style.left = `${left}px`;
    pill.style.width = `${width}px`;
    return;
  }
  animate(pill, { left, width, ease: springy(0.25, 420) });
}

// Tab content: items slide in from the side you switched toward.
export function paneIn(nodes, dir) {
  if (!on()) return;
  animate([...nodes], { opacity: [0, 1], translateX: [dir > 0 ? 14 : -14, 0], delay: stagger(18), duration: 280, ease: "out(3)" });
}

// A reordered row springs from where it was drawn (dy px away) into its slot.
export function settle(el, dy) {
  if (!on() || !dy) return;
  animate(el, { translateY: [dy, 0], scale: [1.02, 1], ease: springy(0.3, 420) });
}

// ---------- exits: the reverse of each entrance, quick and eased out ----------

// Animate something away; resolves when it's gone (immediately if motion is off).
export function leave(targets, { y = 6, scale = 0.96, duration = 170, x = 0 } = {}) {
  const list = targets instanceof Element ? [targets] : [...(targets || [])];
  if (!on() || !list.length) return Promise.resolve();
  return new Promise((resolve) => {
    const anim = animate(list, { opacity: 0, translateY: y, translateX: x, scale, duration, ease: "in(2)" });
    anim.then(resolve);
    setTimeout(resolve, duration + 120); // never block the UI on an animation
  });
}

// The ⚡ menu folds back up toward its button.
export function menuOut(menu) {
  if (!on()) return Promise.resolve();
  return new Promise((resolve) => {
    animate(menu.querySelectorAll(".menu-heading, .menu-tabs, .menu-note, .item"), { opacity: 0, translateX: -6, duration: 120, delay: stagger(8, { from: "last" }), ease: "in(2)" });
    const anim = animate(menu, { opacity: 0, scaleY: 0.9, scaleX: 0.97, translateY: -4, duration: 190, delay: 40, ease: "in(3)" });
    anim.then(resolve);
    setTimeout(resolve, 360);
  });
}

// Accordion body opening: height grows from 0 with a soft spring, content fades up.
export function expand(body) {
  if (!on()) return Promise.resolve();
  const h = body.scrollHeight;
  body.style.overflow = "hidden";
  return new Promise((resolve) => {
    const done = () => {
      body.style.removeProperty("height");
      body.style.removeProperty("overflow");
      resolve();
    };
    animate(body, { height: [0, h], ease: springy(0.18, 480) }).then(done);
    animate(body.children, { opacity: [0, 1], translateY: [-6, 0], delay: stagger(30, { start: 60 }), duration: 320, ease: "out(3)" });
    setTimeout(done, 900);
  });
}

// Accordion body closing: content fades, then height folds to 0.
export function collapse(body) {
  if (!on()) return Promise.resolve();
  body.style.overflow = "hidden";
  return new Promise((resolve) => {
    const done = () => {
      body.style.removeProperty("height");
      body.style.removeProperty("overflow");
      [...body.children].forEach(reset);
      resolve();
    };
    animate(body.children, { opacity: 0, duration: 120, ease: "in(2)" });
    animate(body, { height: [body.offsetHeight, 0], duration: 260, ease: "inOut(3)" }).then(done);
    setTimeout(done, 600);
  });
}

// Remove inline styles left by animations so CSS takes over again.
export function reset(el) {
  if (!el) return;
  for (const p of ["opacity", "transform", "translate", "scale"]) el.style.removeProperty(p); // keeps top/left
}

// For the classic media-strip script, which can't import modules.
window.lumenMotion = { popIn, tilesIn, cascade, leave, reset };
