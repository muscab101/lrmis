"use client";

import type { Map as MlMap } from "maplibre-gl";
import { GripHorizontal } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

const PIN_HEAD = 22; // from the pin's point up to its round head
const LIFT = 56; // space between the box and the pin
const SWING = 64; // how far the line curls out past the box
const EDGE = 12; // keep the box this far inside the map

type Place = { x: number; y: number; left: number; top: number; w: number; h: number; out: -1 | 1 };

/**
 * A house's details in a box above its pin (below when there is no room), joined to the pin by a curly line in the
 * pin's colour: it leaves the box's outer side, swings round and runs into the pin. Follows the house while the map moves.
 * The box can be dragged (by its grip, or anywhere empty with a mouse); it then keeps that spot beside the house.
 */
export function HouseCallout({ map, at, colour, children }: { map: MlMap; at: [number, number]; colour: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  // Where the person dragged the box, from the pin's head; null = placed by itself.
  const moved = useRef<{ dx: number; dy: number } | null>(null);
  const updateRef = useRef<() => void>(() => {});
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const el = box.current;
      if (!el) return;
      const p = map.project(at);
      const { clientWidth: W, clientHeight: H } = map.getContainer();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const head = p.y - PIN_HEAD;
      if (moved.current) {
        const left = Math.min(Math.max(p.x + moved.current.dx, EDGE), W - w - EDGE);
        const top = Math.min(Math.max(head + moved.current.dy, EDGE), H - h - EDGE);
        setPlace({ x: p.x, y: head, left, top, w, h, out: 1 });
        return;
      }
      // Pin on the right half: the box reaches to the left and the line curls out on the left; and the other way round.
      const out = p.x > W / 2 ? -1 : 1;
      const left = Math.min(Math.max(out === -1 ? p.x - w * 0.75 : p.x - w * 0.25, EDGE + SWING), W - w - EDGE - SWING);
      const above = head - LIFT - h;
      const top = Math.min(Math.max(above >= EDGE ? above : p.y + LIFT, EDGE), H - h - EDGE);
      setPlace({ x: p.x, y: head, left, top, w, h, out });
    };
    moved.current = null;
    updateRef.current = update;
    update();
    map.on("move", update);
    map.on("resize", update);
    const ro = new ResizeObserver(update);
    if (box.current) ro.observe(box.current);
    return () => {
      map.off("move", update);
      map.off("resize", update);
      ro.disconnect();
    };
  }, [map, at]);

  let path = "";
  if (place) {
    const centre = place.left + place.w / 2;
    // Pin under the box: the line curls out from the far side; pin off to one side: it leaves the side facing it.
    const under = place.x >= place.left && place.x <= place.left + place.w;
    const out = under ? (place.x > centre ? -1 : 1) : place.x > centre ? 1 : -1;
    const sx = out === -1 ? place.left : place.left + place.w;
    const sy = place.top + Math.min(64, place.h / 3);
    const cx = sx + out * SWING;
    // Out of the box, round in a loop, then along into the pin.
    const ex = sx - out * 10;
    // The pin past the box's outer side (the box was kept inside the map): one plain bend straight to it.
    const beyond = !under || (place.x - ex) * out > 0;
    path = beyond
      ? `M ${sx} ${sy} C ${(sx + place.x) / 2} ${sy}, ${(sx + place.x) / 2} ${place.y}, ${place.x} ${place.y}`
      : `M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${place.y}, ${ex} ${place.y} L ${place.x} ${place.y}`;
  }

  return (
    <>
      {place && (
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" aria-hidden>
          <path d={path} fill="none" stroke="#f8fafc" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
          <path d={path} fill="none" stroke={colour} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={place.x} cy={place.y} r={5} fill={colour} stroke="#f8fafc" strokeWidth={2} />
        </svg>
      )}
      <div
        ref={box}
        className="absolute z-20 max-h-[min(60vh,32rem)] w-[min(20rem,calc(100%-1.5rem))] overflow-y-auto rounded-lg border bg-card-solid p-4 pt-2 shadow-lg"
        style={{ left: place?.left ?? -9999, top: place?.top ?? 0, borderColor: colour }}
        aria-live="polite"
        onPointerDown={(e) => {
          const grip = (e.target as HTMLElement).closest("[data-grip]");
          // A mouse can drag from any empty spot; a finger only from the grip (so the box still scrolls).
          if (!grip && (e.pointerType !== "mouse" || (e.target as HTMLElement).closest("a, button, input, select, textarea, [role=button]"))) return;
          if (!place) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, dx: place.left - place.x, dy: place.top - place.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          moved.current = { dx: d.dx + e.clientX - d.x, dy: d.dy + e.clientY - d.y };
          updateRef.current();
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <div data-grip className="-mx-4 mb-1 flex cursor-grab touch-none justify-center py-1 text-muted-foreground active:cursor-grabbing" aria-hidden>
          <GripHorizontal className="size-4" />
        </div>
        {children}
      </div>
    </>
  );
}
