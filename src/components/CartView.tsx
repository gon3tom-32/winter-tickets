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
const BUYER_KEY = "buyer";

const CHECKOUT_PROBLEMS: Record<string, string> = {
  seats_changed: "Some of your seats were released before checkout. Please look over your cart and try again.",
  empty_cart: "Your cart is empty. Your seats may have been released.",
  below_minimum: "This total is too small to charge to a card. Please add a seat or contact us.",
  payments_not_configured: "Online payment isn't turned on yet. Your seats stay held until the timer runs out.",
  payment_error: "We couldn't open the payment page. Please try again in a moment.",
};

function loadGrades(): Record<string, string[]> {
  try {
    return JSON.parse(sessionStorage.getItem(GRADES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export default function CartView({
  initial,
  multiNightPercent,
  paymentCancelled,
}: {
  initial: Cart;
  multiNightPercent: number;
  paymentCancelled: boolean;
}) {
  const [cart, setCart] = useState(initial);
  const [grades, setGrades] = useState<Record<string, string[]>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState(paymentCancelled ? "Payment cancelled. No charge was made, and your seats are still held." : "");
  const [buyer, setBuyer] = useState({ name: "", email: "" });
  const [fieldErrors, setFieldErrors] = useState<{ name?: boolean; email?: boolean }>({});
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [message, setMessage] = useState("");
  const firstError = useRef<HTMLFieldSetElement>(null);

  // Remember choices for this visit, so they survive going back to the map.
  useEffect(() => {
    setGrades(loadGrades());
    try {
      const saved = JSON.parse(sessionStorage.getItem(BUYER_KEY) ?? "null");
      if (saved) setBuyer(saved);
    } catch {
      // Nothing saved.
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(GRADES_KEY, JSON.stringify(grades));
      sessionStorage.setItem(BUYER_KEY, JSON.stringify(buyer));
    } catch {
      // Private browsing can block storage; choices just won't be remembered.
    }
  }, [grades, buyer]);

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

  const nameOk = buyer.name.trim().length > 0;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim());

  async function continueToPayment() {
    setNotice("");
    setCheckoutError("");
    if (problems.length) {
      setShowErrors(true);
      setTimeout(() => firstError.current?.querySelector("input")?.focus(), 0);
      return;
    }
    if (!nameOk || !emailOk) {
      setFieldErrors({ name: !nameOk, email: !emailOk });
      document.getElementById(!nameOk ? "buyer-name" : "buyer-email")?.focus();
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await fetch(asset("api/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerName: buyer.name, buyerEmail: buyer.email, grades }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.assign(data.url);
        return;
      }
      if (data.reason === "invalid_name" || data.reason === "invalid_email") {
        setFieldErrors({ name: data.reason === "invalid_name", email: data.reason === "invalid_email" });
      } else if (data.reason === "missing_grades") {
        setShowErrors(true);
      } else {
        setCheckoutError(CHECKOUT_PROBLEMS[data.reason] ?? CHECKOUT_PROBLEMS.payment_error);
        if (data.reason === "seats_changed" || data.reason === "empty_cart") {
          // The cart may now be empty, which hides the button area, so show it at the top too.
          setNotice(CHECKOUT_PROBLEMS[data.reason]);
          setCheckoutError("");
          await refresh();
        }
      }
    } catch {
      setCheckoutError(CHECKOUT_PROBLEMS.payment_error);
    }
    setSubmitting(false);
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
        {notice && <p className="notice" role="status">{notice}</p>}
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
        <div className="buyer-fields">
          <label htmlFor="buyer-name">
            Your name
            <input
              id="buyer-name"
              autoComplete="name"
              value={buyer.name}
              maxLength={100}
              onChange={(e) => setBuyer({ ...buyer, name: e.target.value })}
              aria-invalid={fieldErrors.name || undefined}
              aria-describedby={fieldErrors.name ? "buyer-name-error" : undefined}
            />
          </label>
          {fieldErrors.name && <p id="buyer-name-error" className="field-error">Please enter your name.</p>}
          <label htmlFor="buyer-email">
            Email for your tickets
            <input
              id="buyer-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={buyer.email}
              maxLength={254}
              onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
              aria-invalid={fieldErrors.email || undefined}
              aria-describedby={fieldErrors.email ? "buyer-email-error" : undefined}
            />
          </label>
          {fieldErrors.email && <p id="buyer-email-error" className="field-error">Please enter a valid email address.</p>}
        </div>
        <button type="button" className="button wide" onClick={continueToPayment} disabled={q.problem !== null || submitting}>
          {submitting ? "One moment…" : q.totalCents === 0 ? "Confirm free tickets" : "Continue to payment"}
        </button>
        {checkoutError && <p className="notice checkout-error" role="alert">{checkoutError}</p>}
      </aside>

      <p className="sr-only" aria-live="polite">{message}</p>
    </div>
  );
}
