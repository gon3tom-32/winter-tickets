"use client";

// Keeps the buyer's chosen seats in step with the server's holds.
// With holds turned off (preview without a database), choices stay in the browser only.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SeatStatus } from "@/lib/types";
import { asset } from "@/lib/asset";

export type Statuses = Record<string, Exclude<SeatStatus, "available">>;

export type HoldState = {
  statuses: Statuses;
  mine: string[];
  otherNights: number;
  expiresAt: string | null;
};

export type AddResult = "ok" | "held" | "taken" | "limit" | "not_on_sale" | "error";

const REFRESH_MS = 15_000;

export function useHolds(opts: {
  enabled: boolean;
  performanceId: string;
  initial: HoldState;
  maxSeats: number;
  onExpire: () => void;
}) {
  const { enabled, performanceId, maxSeats } = opts;
  const [statuses, setStatuses] = useState<Statuses>(opts.initial.statuses);
  const [selected, setSelected] = useState<string[]>(opts.initial.mine);
  const [otherNights, setOtherNights] = useState(opts.initial.otherNights);
  const [expiresAt, setExpiresAt] = useState<string | null>(opts.initial.expiresAt);
  const [now, setNow] = useState(() => Date.now());
  // While a hold or release is on its way, skip refreshes so they can't undo it on screen.
  const pending = useRef(0);
  const onExpire = useRef(opts.onExpire);
  onExpire.current = opts.onExpire;

  const refresh = useCallback(async () => {
    if (!enabled || pending.current > 0) return;
    try {
      const res = await fetch(asset(`api/performances/${performanceId}/status`), { cache: "no-store" });
      if (!res.ok || pending.current > 0) return;
      const data = (await res.json()) as HoldState;
      setStatuses(data.statuses);
      setSelected(data.mine);
      setOtherNights(data.otherNights);
      setExpiresAt(data.expiresAt);
    } catch {
      // Offline for a moment; the next refresh will catch up.
    }
  }, [enabled, performanceId]);

  // Refresh every 15 seconds, and whenever the buyer comes back to the tab.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(refresh, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh]);

  // Countdown. When the hold runs out, the seats go back to everyone.
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const secondsLeft = expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000)) : null;

  useEffect(() => {
    if (secondsLeft !== 0) return;
    setSelected([]);
    setOtherNights(0);
    setExpiresAt(null);
    onExpire.current();
    refresh();
  }, [secondsLeft, refresh]);

  async function add(seatId: string): Promise<AddResult> {
    if (selected.length + otherNights >= maxSeats) return "limit";
    setSelected((cur) => [...cur, seatId]);
    if (!enabled) return "ok";

    pending.current++;
    try {
      const res = await fetch(asset("api/holds"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performanceId, seatId }),
      });
      const data = await res.json();
      if (data.ok) {
        setNow(Date.now());
        setExpiresAt(data.expiresAt);
        return "ok";
      }
      setSelected((cur) => cur.filter((id) => id !== seatId));
      if (data.reason === "held" || data.reason === "taken") {
        setStatuses((cur) => ({ ...cur, [seatId]: data.reason === "held" ? "held" : "sold" }));
      }
      return ["held", "taken", "limit", "not_on_sale"].includes(data.reason) ? data.reason : "error";
    } catch {
      setSelected((cur) => cur.filter((id) => id !== seatId));
      return "error";
    } finally {
      pending.current--;
    }
  }

  async function remove(seatIds?: string[]) {
    const removing = seatIds ?? selected;
    const left = selected.filter((id) => !removing.includes(id));
    setSelected(left);
    if (left.length === 0 && otherNights === 0) setExpiresAt(null);
    if (!enabled) return;

    pending.current++;
    try {
      await fetch(asset("api/holds"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ performanceId, seatIds }),
      });
    } catch {
      // If this fails, the hold simply runs out on its own.
    } finally {
      pending.current--;
    }
  }

  return { statuses, selected, otherNights, secondsLeft, add, remove, refresh };
}
