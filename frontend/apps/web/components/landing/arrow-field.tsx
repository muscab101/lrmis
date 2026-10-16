"use client";

import { useEffect, useRef } from "react";

const GAP = 13; // px between arrows
const SIZE = 4; // half-length of an arrow
const RADIUS = 190; // how far the pointer pushes
const PUSH = 34; // max px an arrow is pushed away
const SPRING = 0.14; // how fast arrows follow / return (0–1 per frame)
const RIPPLE_SPEED = 0.9; // px per ms
const RIPPLE_WIDTH = 80;
const RIPPLE_PUSH = 26;
const RIPPLE_LIFE = 1400; // ms

interface Ripple {
  x: number;
  y: number;
  t0: number;
}

/**
 * Field of tiny arrows over a navy-to-white sky. Arrows scatter out of the pointer's way,
 * turning to point away from it, and spring back when it leaves; a click sends a ripple
 * through them. Static for reduced motion.
 */
export function ArrowField({ className, flip = false }: { className?: string; /** White at the top, navy at the bottom. */ flip?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let cols = 0;
    let pointer: { x: number; y: number } | null = null;
    const ripples: Ripple[] = [];
    let frame = 0;
    let running = false;
    // Per arrow: current offset (ox, oy) and turn toward "away" (tx, ty), eased each frame.
    let state = new Float32Array(0);

    const resize = () => {
      const r = el.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      cols = Math.ceil(w / GAP) + 1;
      state = new Float32Array(cols * (Math.ceil(h / GAP) + 1) * 4);
      draw(performance.now());
    };

    /** Draws one frame; returns true while anything is still moving. */
    function draw(now: number): boolean {
      if (!ctx) return false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sky = flip ? ctx.createLinearGradient(0, h, 0, 0) : ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#0b2a8f");
      sky.addColorStop(0.35, "#2a55d6");
      sky.addColorStop(0.68, "#7c9cf0");
      sky.addColorStop(1, "#ffffff");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Soft light in the middle so the headline reads.
      const glow = ctx.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, Math.max(w, h) * 0.45);
      glow.addColorStop(0, "rgba(160,190,255,0.55)");
      glow.addColorStop(1, "rgba(160,190,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      ripples.splice(0, ripples.length, ...ripples.filter((r) => now - r.t0 < RIPPLE_LIFE));
      let moving = ripples.length > 0;
      ctx.lineWidth = 1.25;
      ctx.lineCap = "round";

      for (let gy = 0, row = 0; gy <= h; gy += GAP, row++) {
        const fy = flip ? 1 - gy / h : gy / h; // 0 = navy edge → 1 = white edge
        // Light arrows on the dark part, blue arrows on the light part.
        ctx.strokeStyle = fy < 0.6 ? `rgba(196,214,255,${0.62 - fy * 0.55})` : `rgba(42,85,214,${0.22 + (fy - 0.6) * 0.75})`;
        ctx.beginPath();
        for (let gx = 0, col = 0; gx <= w; gx += GAP, col++) {
          // Where the pointer and ripples want this arrow: pushed outward and turned away.
          let pushX = 0;
          let pushY = 0;
          let turn = 0;
          let awayX = 0;
          let awayY = 0;
          if (pointer) {
            const px = gx - pointer.x;
            const py = gy - pointer.y;
            const d = Math.hypot(px, py);
            if (d < RADIUS) {
              const f = (1 - d / RADIUS) ** 2;
              const nx = d > 0.01 ? px / d : 0;
              const ny = d > 0.01 ? py / d : -1;
              pushX += nx * f * PUSH;
              pushY += ny * f * PUSH;
              awayX += nx * f;
              awayY += ny * f;
              turn = Math.max(turn, f);
            }
          }
          for (const r of ripples) {
            const age = now - r.t0;
            const px = gx - r.x;
            const py = gy - r.y;
            const d = Math.hypot(px, py);
            const band = 1 - Math.abs(d - age * RIPPLE_SPEED) / RIPPLE_WIDTH;
            if (band > 0 && d > 0.01) {
              const f = band * (1 - age / RIPPLE_LIFE);
              pushX += (px / d) * f * RIPPLE_PUSH;
              pushY += (py / d) * f * RIPPLE_PUSH;
              awayX += (px / d) * f;
              awayY += (py / d) * f;
              turn = Math.max(turn, f);
            }
          }

          // Spring toward that target, so arrows glide out and settle back.
          const i = (row * cols + col) * 4;
          const ox = state[i]! + (pushX - state[i]!) * SPRING;
          const oy = state[i + 1]! + (pushY - state[i + 1]!) * SPRING;
          const al = Math.hypot(awayX, awayY);
          const tx = state[i + 2]! + ((al > 0 ? (awayX / al) * turn : 0) - state[i + 2]!) * SPRING;
          const ty = state[i + 3]! + ((al > 0 ? (awayY / al) * turn : 0) - state[i + 3]!) * SPRING;
          state[i] = ox;
          state[i + 1] = oy;
          state[i + 2] = tx;
          state[i + 3] = ty;
          if (Math.abs(ox - pushX) + Math.abs(oy - pushY) > 0.05 || Math.abs(ox) + Math.abs(oy) > 0.05) moving = true;

          // At rest the arrow points up-right (↗); pushed arrows turn to point away.
          const tl = Math.min(1, Math.hypot(tx, ty));
          let ax = 0.7071 * (1 - tl) + tx;
          let ay = -0.7071 * (1 - tl) + ty;
          const len = Math.hypot(ax, ay) || 1;
          ax /= len;
          ay /= len;
          const x = gx + ox;
          const y = gy + oy;
          const s = SIZE * (1 + tl * 0.5);
          const headX = x + ax * s;
          const headY = y + ay * s;
          ctx.moveTo(x - ax * s, y - ay * s);
          ctx.lineTo(headX, headY);
          const bx = -ax * 2.4;
          const by = -ay * 2.4;
          ctx.moveTo(headX, headY);
          ctx.lineTo(headX + bx * 0.7071 - by * 0.7071, headY + bx * 0.7071 + by * 0.7071);
          ctx.moveTo(headX, headY);
          ctx.lineTo(headX + bx * 0.7071 + by * 0.7071, headY - bx * 0.7071 + by * 0.7071);
        }
        ctx.stroke();
      }
      return moving;
    }

    const loop = (now: number) => {
      const moving = draw(now);
      if (moving || pointer) frame = requestAnimationFrame(loop);
      else running = false;
    };
    const kick = () => {
      if (reduced || running) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };

    const host = el.parentElement ?? el;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      kick();
    };
    const onLeave = () => {
      pointer = null;
      kick();
    };
    const onDown = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ripples.push({ x: e.clientX - r.left, y: e.clientY - r.top, t0: performance.now() });
      kick();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(el);
    if (!reduced) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
      host.addEventListener("pointerdown", onDown);
    }
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown);
    };
  }, [flip]);

  return <canvas ref={canvas} aria-hidden className={className} />;
}
