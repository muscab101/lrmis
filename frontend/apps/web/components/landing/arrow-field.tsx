"use client";

import { useEffect, useRef } from "react";

const GAP = 13; // px between arrows
const SIZE = 4; // half-length of an arrow
const LEAN_RADIUS = 170; // how far the pointer reaches
const RIPPLE_SPEED = 0.9; // px per ms
const RIPPLE_WIDTH = 70;
const RIPPLE_LIFE = 1400; // ms
const SWAY = 0.38; // radians of idle sway
const SWAY_SPEED = 0.0011; // per ms

interface Ripple {
  x: number;
  y: number;
  t0: number;
}

/**
 * Field of tiny arrows over a navy-to-white sky. Arrows lean away from the pointer
 * and a click sends a ripple through them. At rest a slow wave sways the field and the light
 * drifts. Static (no animation) for reduced motion; paused while off screen.
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
    let pointer: { x: number; y: number } | null = null;
    const ripples: Ripple[] = [];
    let frame = 0;
    let running = false;
    // Smoothed lean per arrow so movement eases instead of snapping.
    let lean = new Float32Array(0);

    const resize = () => {
      const r = el.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      lean = new Float32Array(Math.ceil(w / GAP + 1) * Math.ceil(h / GAP + 1) * 2);
      draw(performance.now());
    };

    function draw(now: number) {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sky = flip ? ctx.createLinearGradient(0, h, 0, 0) : ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#0b2a8f");
      sky.addColorStop(0.35, "#2a55d6");
      sky.addColorStop(0.68, "#7c9cf0");
      sky.addColorStop(1, "#ffffff");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Soft light in the middle so the headline reads.
      const gx0 = w / 2 + (reduced ? 0 : Math.sin(now * 0.00023) * w * 0.12);
      const gy0 = h * 0.5 + (reduced ? 0 : Math.cos(now * 0.00017) * h * 0.06);
      const glow = ctx.createRadialGradient(gx0, gy0, 0, gx0, gy0, Math.max(w, h) * 0.45);
      glow.addColorStop(0, "rgba(160,190,255,0.55)");
      glow.addColorStop(1, "rgba(160,190,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      ripples.splice(0, ripples.length, ...ripples.filter((r) => now - r.t0 < RIPPLE_LIFE));
      const cols = Math.ceil(w / GAP + 1);
      ctx.lineWidth = 1.25;
      ctx.lineCap = "round";

      for (let gy = 0, row = 0; gy <= h + GAP; gy += GAP, row++) {
        const fy = flip ? 1 - gy / h : gy / h; // 0 = navy edge → 1 = white edge
        // Light arrows on the dark top, blue arrows on the light bottom.
        const stroke = fy < 0.6 ? `rgba(196,214,255,${0.62 - fy * 0.55})` : `rgba(42,85,214,${0.22 + (fy - 0.6) * 0.75})`;
        ctx.strokeStyle = stroke;
        ctx.beginPath();
        for (let gx = 0, col = 0; gx <= w + GAP; gx += GAP, col++) {
          const x = gx + (row % 2 ? GAP / 2 : 0);
          const y = gy;
          let dx = 0;
          let dy = 0;
          let scale = 1;
          if (pointer) {
            const px = x - pointer.x;
            const py = y - pointer.y;
            const d = Math.hypot(px, py);
            if (d < LEAN_RADIUS && d > 0.01) {
              const f = (1 - d / LEAN_RADIUS) ** 2;
              dx += (px / d) * f * 1.6;
              dy += (py / d) * f * 1.6;
              scale += f * 0.6;
            }
          }
          for (const r of ripples) {
            const age = now - r.t0;
            const radius = age * RIPPLE_SPEED;
            const px = x - r.x;
            const py = y - r.y;
            const d = Math.hypot(px, py);
            const band = 1 - Math.abs(d - radius) / RIPPLE_WIDTH;
            if (band > 0 && d > 0.01) {
              const f = band * (1 - age / RIPPLE_LIFE);
              dx += (px / d) * f * 2.4;
              dy += (py / d) * f * 2.4;
              scale += f * 0.9;
            }
          }
          // Ease toward the target lean.
          const i = (row * cols + col) * 2;
          const lx = (lean[i] ?? 0) + (dx - (lean[i] ?? 0)) * 0.18;
          const ly = (lean[i + 1] ?? 0) + (dy - (lean[i + 1] ?? 0)) * 0.18;
          lean[i] = lx;
          lean[i + 1] = ly;

          // Resting arrow points up-right (↗), swayed by a slow travelling wave; the lean bends it.
          const sway = reduced ? 0 : Math.sin(now * SWAY_SPEED - x * 0.011 + y * 0.006) * SWAY;
          let ax = Math.cos(-Math.PI / 4 + sway) + lx;
          let ay = Math.sin(-Math.PI / 4 + sway) + ly;
          const len = Math.hypot(ax, ay) || 1;
          ax /= len;
          ay /= len;
          const s = SIZE * Math.min(scale, 2);
          const tx = x + ax * s;
          const ty = y + ay * s;
          ctx.moveTo(x - ax * s, y - ay * s);
          ctx.lineTo(tx, ty);
          // Head
          const hx = -ax * 2.4;
          const hy = -ay * 2.4;
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx + hx * 0.7071 - hy * 0.7071, ty + hx * 0.7071 + hy * 0.7071);
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx + hx * 0.7071 + hy * 0.7071, ty - hx * 0.7071 + hy * 0.7071);
        }
        ctx.stroke();
      }
    }

    let visible = true;
    const loop = (now: number) => {
      draw(now);
      // The idle wave keeps the field alive while it is on screen.
      if (visible && !document.hidden) frame = requestAnimationFrame(loop);
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
    const io = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) kick();
    });
    io.observe(el);
    const onVisibility = () => !document.hidden && kick();
    document.addEventListener("visibilitychange", onVisibility);
    if (!reduced) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
      host.addEventListener("pointerdown", onDown);
    }
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown);
    };
  }, [flip]);

  return <canvas ref={canvas} aria-hidden className={className} />;
}
