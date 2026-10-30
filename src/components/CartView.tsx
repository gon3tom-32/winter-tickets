"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Cart } from "@/lib/cart";
import { gradeProblems } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { nightTitle } from "@/lib/dates";
import { asset } from "@/lib/asset";
import { clock, useCountdown } from "./useCountdown";

const GRADES_KEY = "grades-supported";

function loadGrades(): Record<string, string[]> {
  try {
    return JSON.parse(sessionStorage.getItem(GRADES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function CartView({ initial, multiNightPercent }: { initial: Cart; multiNightPercent: number }) {
  const [cart, setCart] = useState(initial);
  const [grades, setGrades] = useState<Record<string, string[]>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");
  const firstError = useRef<HTMLFieldSetElement>(null);

  // Remember grade choices for this visit, so they survive going back to the map.
  useEffect(() => setGrades(loadGrades()), []);
  useEffect(() => {
    try {
      sessionStorage.setItem(GRADES_KEY, JSON.stringify(grades));
    } catch {
      // Private browsing can block storage; choices just won't be remembered.
    }
  }, [grades]);

  async function refresh() {
    try {
      const res = await fetch(asset("api/cart"), { cache: "no-store" });
      if (res.ok) setCart(await res.json());
    } catch {
      // Try again on the next action.
    }
  }

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const secondsLeft = useCountdown(cart.expiresAt, () => {
    setNotice("Your hold ran out, so your seats were released. Choose them again if they're still open.");
    refresh();
  });

  async function remove(performanceId: string, seatId: string, label: string) {
    await fetch(asset("api/holds"), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ performanceId, seatIds: [seatId] }),
    }).catch(() => {});
    setMessage(`Removed ${label}.`);
    await refresh();
  }

  function toggleGrade(performanceId: string, grade: string, on: boolean) {
    setGrades((cur) => {
      const list = new Set(cur[performanceId] ?? []);
      if (on) list.add(grade);
      else list.delete(grade);
      return { ...cur, [performanceId]: [...list] };
    });
  }

  const problems = gradeProblems(cart.nights, grades);
  const q = cart.quote;

  function continueToPayment() {
    if (problems.length) {
      setShowErrors(true);
      setTimeout(() => firstError.current?.querySelector("input")?.focus(), 0);
      return;
    }
    setNotice("Payment is the next build step and isn't connected yet. Your seats stay held until the timer runs out.");
  }

  if (cart.nights.length === 0) {
    return (
      <>
        {notice && <p className="notice" role="alert">{notice}</p>}
        <p>Your cart is empty.</p>
        <Link href="/" className="button">Choose a night</Link>
      </>
    );
  }

  return (
    <div className="cart">
      <div className="cart-nights">
        {secondsLeft !== null && (
          <p className={`hold-timer${secondsLeft <= 120 ? " ending" : ""}`}>
            Your seats are held for <strong>{clock(secondsLeft)}</strong>
          </p>
        )}

        {cart.nights.map((n) => {
          const missing = showErrors && problems.includes(n.performance.id);
          const errorId = `grades-error-${n.performance.id}`;
          return (
            <section key={n.performance.id} className="cart-night" aria-labelledby={`night-${n.performance.id}`}>
              <h2 id={`night-${n.performance.id}`}>{nightTitle(n.performance)}</h2>

              <ul className="chosen">
                {n.seats.map((s) => (
                  <li key={s.seatId}>
                    <span>
                      <strong>{s.label}</strong>
                      <span className="muted">
                        {s.tierName} · {formatCents(s.priceCents)}
                      </span>
                    </span>
                    <button type="button" className="remove" onClick={() => remove(n.performance.id, s.seatId, s.label)} aria-label={`Remove ${s.label}`}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <Link href={`/night/${n.performance.id}`} className="text-link">Change seats for this night</Link>

              <fieldset
                className={`grades${missing ? " has-error" : ""}`}
                ref={missing && problems[0] === n.performance.id ? firstError : undefined}
                aria-describedby={missing ? errorId : undefined}
              >
                <legend>Which grade are you supporting? <span className="muted">(choose at least one)</span></legend>
                {missing && <p id={errorId} className="field-error">Please choose a grade for this night.</p>}
                <div className="grade-options">
                  {n.performance.grades.map((g) => (
                    <label key={g} className="grade-option">
                      <input
                        type="checkbox"
                        checked={(grades[n.performance.id] ?? []).includes(g)}
                        onChange={(e) => toggleGrade(n.performance.id, g, e.target.checked)}
                      />
                      {g}
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>
          );
        })}

        {q.nights < 2 && (
          <p className="tip">
            Add seats for another night in this same order and every seat is <strong>{multiNightPercent}% off</strong>.{" "}
            <Link href="/">See other nights</Link>
          </p>
        )}
      </div>

      <aside className="summary cart-summary" aria-labelledby="total-heading">
        <h2 id="total-heading">Total</h2>
        <dl className="totals">
          <div>
            <dt>Seats ({cart.nights.reduce((n, x) => n + x.seats.length, 0)})</dt>
            <dd>{formatCents(q.subtotalCents)}</dd>
          </div>
          {q.discount && (
            <div className="discount">
              <dt>{q.discount.label}</dt>
              <dd>−{formatCents(q.discount.amountCents)}</dd>
            </div>
          )}
          <div className="grand">
            <dt>Total</dt>
            <dd>{formatCents(q.totalCents)}</dd>
          </div>
        </dl>
        {q.problem === "below_minimum" && (
          <p className="field-error">This total is too small to charge to a card. Please add a seat or contact us.</p>
        )}
        <button type="button" className="button wide" onClick={continueToPayment} disabled={q.problem !== null}>
          Continue to payment
        </button>
        {notice && <p className="notice" role="status">{notice}</p>}
      </aside>

      <p className="sr-only" aria-live="polite">{message}</p>
    </div>
  );
}
