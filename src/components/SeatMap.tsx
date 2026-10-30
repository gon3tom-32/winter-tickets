"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { MapSeat, SeatStatus, Section, Tier } from "@/lib/types";
import { boundsOf, GEOMETRY, type Box } from "@/lib/layout";
import { formatCents } from "@/lib/money";

type Props = {
  seats: MapSeat[];
  sections: Section[];
  tiers: Tier[];
  maxSeats: number;
  /** Seats that can't be chosen. Seats not listed are available. */
  statuses: Record<string, Exclude<SeatStatus, "available">>;
};

const STATUS_TEXT = { held: "on hold for another buyer", sold: "taken" } as const;

type View = "all" | string;

const NARROW = "(max-width: 640px)";

export default function SeatMap({ seats, sections, tiers, maxSeats, statuses }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<View>("all");
  const [focusId, setFocusId] = useState<string>(() => seats[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [narrow, setNarrow] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const byId = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);
  const tierById = useMemo(() => new Map(tiers.map((t) => [t.id, t])), [tiers]);
  const sectionIndex = useMemo(() => new Map(sections.map((s, i) => [s.id, i])), [sections]);
  const visible = useMemo(() => (view === "all" ? seats : seats.filter((s) => s.section === view)), [seats, view]);

  // Seats grouped by section and row, sorted by seat number, for arrow-key moves.
  const rows = useMemo(() => {
    const m = new Map<string, MapSeat[]>();
    for (const s of visible) {
      const k = `${s.section}|${s.rowIndex}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    for (const list of m.values()) list.sort((a, b) => a.number - b.number);
    return m;
  }, [visible]);

  const box: Box = useMemo(() => {
    if (view === "all") {
      const b = boundsOf(visible, 20);
      const top = 40;
      return { x: b.x, y: top, w: b.w, h: b.y + b.h - top };
    }
    const b = boundsOf(visible, 22);
    return { x: b.x, y: b.y - 28, w: b.w, h: b.h + 28 };
  }, [visible, view]);

  // Keep the keyboard focus target inside the current view.
  useEffect(() => {
    if (!visible.some((s) => s.id === focusId) && visible[0]) setFocusId(visible[0].id);
  }, [visible, focusId]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(seat: MapSeat) {
    const status = statuses[seat.id];
    if (status && !selectedSet.has(seat.id)) {
      setMessage(`${seat.label} is ${STATUS_TEXT[status]}.`);
      return;
    }
    const tier = tierById.get(seat.tier)!;
    if (selectedSet.has(seat.id)) {
      setSelected((cur) => cur.filter((id) => id !== seat.id));
      setMessage(`Removed ${seat.label}.`);
      return;
    }
    if (selected.length >= maxSeats) {
      setMessage(`You can choose up to ${maxSeats} seats per order.`);
      return;
    }
    setSelected((cur) => [...cur, seat.id]);
    setMessage(`Added ${seat.label}, ${tier.name}, ${formatCents(seat.priceCents)}.`);
  }

  function onSeatClick(seat: MapSeat) {
    setFocusId(seat.id);
    // On a phone the whole room is too small to tap accurately, so a tap zooms in first.
    if (view === "all" && narrow) {
      setView(seat.section);
      const name = sections.find((s) => s.id === seat.section)?.name;
      setMessage(`Showing the ${name} section. Tap a seat to choose it.`);
      return;
    }
    toggle(seat);
  }

  function move(seat: MapSeat, key: string): MapSeat | undefined {
    const row = rows.get(`${seat.section}|${seat.rowIndex}`)!;
    const i = row.findIndex((s) => s.id === seat.id);
    const neighborSection = (dir: number) => {
      const idx = sectionIndex.get(seat.section)! + dir;
      return rows.get(`${sections[idx]?.id}|${seat.rowIndex}`);
    };
    switch (key) {
      case "ArrowLeft":
        if (i > 0) return row[i - 1];
        return neighborSection(-1)?.at(-1);
      case "ArrowRight":
        if (i < row.length - 1) return row[i + 1];
        return neighborSection(1)?.[0];
      case "ArrowUp":
      case "ArrowDown": {
        const target = rows.get(`${seat.section}|${seat.rowIndex + (key === "ArrowUp" ? -1 : 1)}`);
        if (!target) return undefined;
        // Keep the same relative position across rows of different lengths.
        const t = row.length === 1 ? 0.5 : i / (row.length - 1);
        return target[Math.round(t * (target.length - 1))];
      }
      case "Home":
        return row[0];
      case "End":
        return row.at(-1);
    }
    return undefined;
  }

  function onSeatKey(e: KeyboardEvent, seat: MapSeat) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(seat);
      return;
    }
    const next = move(seat, e.key);
    if (next) {
      e.preventDefault();
      setFocusId(next.id);
      svgRef.current?.querySelector<SVGGElement>(`[data-seat="${next.id}"]`)?.focus();
    }
  }

  const chosen = selected
    .map((id) => byId.get(id)!)
    .sort(
      (a, b) =>
        sectionIndex.get(a.section)! - sectionIndex.get(b.section)! ||
        a.rowIndex - b.rowIndex ||
        a.number - b.number,
    );
  const subtotal = chosen.reduce((sum, s) => sum + s.priceCents, 0);
  const r = GEOMETRY.seatRadius;

  return (
    <div className="seatmap">
      <div className="map-panel">
        <div className="view-buttons" role="group" aria-label="Zoom the seat map">
          <button type="button" aria-pressed={view === "all"} onClick={() => setView("all")}>
            Whole room
          </button>
          {sections.map((s) => (
            <button key={s.id} type="button" aria-pressed={view === s.id} onClick={() => setView(s.id)}>
              {s.name}
            </button>
          ))}
        </div>

        <ul className="legend" aria-label="Seat prices">
          {tiers.map((t) => (
            <li key={t.id}>
              <svg width="18" height="18" aria-hidden="true">
                <circle cx="9" cy="9" r="7" className="dot" data-tier={t.id} />
              </svg>
              {t.name} <strong>{formatCents(t.priceCents)}</strong>
            </li>
          ))}
          <li>
            <svg width="18" height="18" aria-hidden="true">
              <circle cx="9" cy="9" r="6.5" className="dot selected-dot" />
              <path d="M5.5 9.2l2.3 2.3 4.5-4.6" className="check" />
            </svg>
            Your seats
          </li>
          <li>
            <svg width="18" height="18" aria-hidden="true">
              <circle cx="9" cy="9" r="6" className="dot held" />
            </svg>
            On hold
          </li>
          <li>
            <svg width="18" height="18" aria-hidden="true">
              <circle cx="9" cy="9" r="7" className="dot sold" />
              <path d="M6 6l6 6M12 6l-6 6" className="cross" />
            </svg>
            Taken
          </li>
          {seats.some((s) => s.accessible) && (
            <li>
              <svg width="18" height="18" aria-hidden="true">
                <rect x="2" y="2" width="14" height="14" rx="3" className="dot accessible-dot" />
              </svg>
              Accessible seating
            </li>
          )}
        </ul>

        {view === "all" && narrow && <p className="hint">Tap a section to zoom in, then tap seats to choose them.</p>}

        <div className="map-frame">
          <svg
            ref={svgRef}
            viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
            className="map"
            role="group"
            aria-label="Seat map. Use the arrow keys to move between seats, and Enter or Space to choose one."
          >
            {view === "all" ? <Stage /> : <StageArrow x={box.x + box.w / 2} y={box.y + 16} />}
            {visible.map((seat) => {
              const isSel = selectedSet.has(seat.id);
              const tier = tierById.get(seat.tier)!;
              const status = statuses[seat.id];
              const dotClass = `dot${isSel ? " selected-dot" : ""}${status ? ` ${status}` : ""}`;
              return (
                <g
                  key={seat.id}
                  data-seat={seat.id}
                  className="seat"
                  transform={`translate(${seat.x} ${seat.y})`}
                  role="checkbox"
                  aria-checked={isSel}
                  aria-disabled={status ? true : undefined}
                  aria-label={`${seat.label}${seat.accessible ? ", accessible seating" : ""}, ${status ? STATUS_TEXT[status] : `${tier.name}, ${formatCents(seat.priceCents)}`}`}
                  tabIndex={seat.id === focusId ? 0 : -1}
                  onClick={() => onSeatClick(seat)}
                  onKeyDown={(e) => onSeatKey(e, seat)}
                >
                  <circle r={r + 4} className="hit" />
                  <circle r={r + 3.5} className="ring" />
                  {seat.accessible ? (
                    <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2} className={dotClass} data-tier={seat.tier} />
                  ) : (
                    <circle r={status === "held" ? r - 0.75 : r} className={dotClass} data-tier={seat.tier} />
                  )}
                  {isSel && <path d="M-3 0.2l2 2 4-4.1" className="check" />}
                  {status === "sold" && <path d="M-3 -3l6 6M3 -3l-6 6" className="cross" />}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <section className="summary" id="your-seats" aria-labelledby="your-seats-heading">
        <h2 id="your-seats-heading">Your seats</h2>
        {chosen.length === 0 ? (
          <p className="muted">No seats chosen yet. You can choose up to {maxSeats}.</p>
        ) : (
          <>
            <ul className="chosen">
              {chosen.map((s) => {
                const tier = tierById.get(s.tier)!;
                return (
                  <li key={s.id}>
                    <span>
                      <strong>{s.label}</strong>
                      <span className="muted">
                        {tier.name} · {formatCents(s.priceCents)}
                      </span>
                    </span>
                    <button type="button" className="remove" onClick={() => toggle(s)} aria-label={`Remove ${s.label}`}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="subtotal">
              <span>
                {chosen.length} {chosen.length === 1 ? "seat" : "seats"}
              </span>
              <strong>{formatCents(subtotal)}</strong>
            </p>
            <p className="muted small">Before discounts. Buying for 2 or more nights in one order takes 20% off.</p>
            <button type="button" className="button secondary" onClick={() => { setSelected([]); setMessage("Cleared all seats."); }}>
              Clear seats
            </button>
          </>
        )}
      </section>

      {chosen.length > 0 && (
        <div className="sticky-bar">
          <span>
            {chosen.length} {chosen.length === 1 ? "seat" : "seats"} · <strong>{formatCents(subtotal)}</strong>
          </span>
          <a href="#your-seats" className="button">Review</a>
        </div>
      )}

      <p className="sr-only" aria-live="polite">{message}</p>
      {message.startsWith("You can choose up to") && <p className="notice" role="alert">{message}</p>}
    </div>
  );
}

function Stage() {
  const R = GEOMETRY.stageRadius;
  const a = (40 * Math.PI) / 180;
  const x = Math.round(R * Math.sin(a));
  const y = Math.round(R * Math.cos(a));
  return (
    <g aria-hidden="true">
      <path d={`M ${-x} 60 L ${-x} ${y} A ${R} ${R} 0 0 0 ${x} ${y} L ${x} 60 Z`} className="stage" />
      <text x="0" y={y + 6} textAnchor="middle" className="stage-label">STAGE</text>
    </g>
  );
}

function StageArrow({ x, y }: { x: number; y: number }) {
  return (
    <text x={x} y={y} textAnchor="middle" className="stage-arrow" aria-hidden="true">
      ▲ Stage this way
    </text>
  );
}
