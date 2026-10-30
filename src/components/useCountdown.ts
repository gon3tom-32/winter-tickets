"use client";

import { useEffect, useRef, useState } from "react";

/** Seconds until `expiresAt` (null when there's nothing to count down). Calls onExpire once at zero. */
export function useCountdown(expiresAt: string | null, onExpire: () => void): number | null {
  const [now, setNow] = useState(() => Date.now());
  const cb = useRef(onExpire);
  cb.current = onExpire;

  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const secondsLeft = expiresAt ? Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000)) : null;
  useEffect(() => {
    if (secondsLeft === 0) cb.current();
  }, [secondsLeft]);
  return secondsLeft;
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
