// Drag-to-reorder for a list, with pointer events rather than HTML5 drag and drop
// (no ghost image, works with springs). Grab an item's handle: it lifts and follows the
// pointer, the others slide aside, and on release it springs into its new slot.
// The handle also works from the keyboard: ↑/↓ move the item.

import { settle } from "./motion.js";

// list: container; itemSel/handleSel: selectors; onChange(ids) after a move
// (ids from each item's data-id, in the new order).
export function makeSortable(list, { itemSel, handleSel, onChange }) {
  const items = () => [...list.querySelectorAll(itemSel)];
  const ids = () => items().map((el) => el.dataset.id);

  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(handleSel);
    if (!handle || e.button !== 0) return;
    const el = handle.closest(itemSel);
    if (!el) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);

    const all = items();
    const from = all.indexOf(el);
    const rects = all.map((x) => x.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
    const shift = rects[from].height + gap; // how far the others move to make room
    const startY = e.clientY;
    let to = from;

    el.classList.add("dragging");
    all.forEach((x) => x !== el && x.classList.add("shifting"));

    const move = (ev) => {
      // Keep the dragged item within the list.
      const dy = Math.max(rects[0].top - rects[from].top, Math.min(rects[rects.length - 1].bottom - rects[from].bottom, ev.clientY - startY));
      el.style.transform = `translateY(${dy}px) scale(1.02)`;
      // The slot follows the pointer (not the row's center, which a tall row
      // could never get past a short neighbor's).
      const y = ev.clientY;
      to = from;
      for (let i = 0; i < rects.length; i++) {
        const c = rects[i].top + rects[i].height / 2;
        if (i < from && y < c) { to = i; break; }
        if (i > from && y > c) to = i;
      }
      all.forEach((x, i) => {
        if (x === el) return;
        const off = from < to && i > from && i <= to ? -shift : to < from && i >= to && i < from ? shift : 0;
        x.style.transform = off ? `translateY(${off}px)` : "";
      });
    };

    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      const before = el.getBoundingClientRect().top; // where it's drawn now, mid-drag
      all.forEach((x) => {
        x.classList.remove("shifting");
        x.style.transform = "";
      });
      el.classList.remove("dragging");
      if (to !== from) {
        const ref = all[to];
        to > from ? ref.after(el) : ref.before(el);
        onChange(ids());
      }
      // Spring from where you let go into the slot.
      settle(el, before - el.getBoundingClientRect().top);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });

  list.addEventListener("keydown", (e) => {
    const handle = e.target.closest(handleSel);
    if (!handle || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const el = handle.closest(itemSel);
    const sib = e.key === "ArrowUp" ? el.previousElementSibling : el.nextElementSibling;
    if (!sib || !sib.matches(itemSel)) return;
    const before = el.getBoundingClientRect().top;
    e.key === "ArrowUp" ? sib.before(el) : sib.after(el);
    settle(el, before - el.getBoundingClientRect().top);
    handle.focus();
    onChange(ids());
  });
}
