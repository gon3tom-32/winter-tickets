// Orders: turning a buyer's held seats into a paid (or free) order.
//
// - Starting checkout creates a 'pending' order from the seats the buyer holds,
//   priced on the server, and keeps those seats held while they pay.
// - Seats are marked sold only when payment is confirmed (Stripe's webhook),
//   never when the buyer returns to the site. A $0 order is confirmed at once.
// - If payment arrives but a seat is gone (the hold ran out and someone else
//   bought it), nothing is sold, the order is flagged for staff, and the
//   caller refunds the payment.
import type { Db, Query } from "./db";
import type { Pricing, Venue } from "./types";
import { gradeProblems, loadCart } from "./cart";
import { releasePromoSeats, reservePromoSeats, retakePromoSeats, type PromoProblem } from "./promo";
import { nightTitle } from "./dates";
import { seatLabel } from "./layout";
import type { CheckoutLine } from "./payments";

export type CheckoutInput = {
  token: string;
  buyerName: string;
  buyerEmail: string;
  grades: Record<string, string[] | undefined>;
  promoCode?: string;
};

export type CheckoutProblem =
  | { reason: "empty_cart" }
  | { reason: "invalid_name" }
  | { reason: "invalid_email" }
  | { reason: "missing_grades"; nights: string[] }
  | { reason: "below_minimum" }
  | { reason: "seats_changed" }
  | { reason: "promo_invalid"; problem: PromoProblem };

export type CheckoutStarted = {
  orderId: string;
  accessKey: string;
  totalCents: number;
  free: boolean;
  lines: CheckoutLine[];
  /** Stripe sessions from earlier unfinished checkouts, to be closed so they can't be paid. */
  staleSessions: string[];
};

export type StartResult = { ok: true; started: CheckoutStarted } | ({ ok: false } & CheckoutProblem);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanBuyer(name: unknown, email: unknown) {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  return {
    name: n.length >= 1 && n.length <= 100 ? n : null,
    email: e.length <= 254 && EMAIL.test(e) ? e : null,
  };
}

export async function startCheckout(
  db: Db,
  input: CheckoutInput,
  config: { venue: Venue; pricing: Pricing },
): Promise<StartResult> {
  const buyer = cleanBuyer(input.buyerName, input.buyerEmail);
  if (!buyer.name) return { ok: false, reason: "invalid_name" };
  if (!buyer.email) return { ok: false, reason: "invalid_email" };
  const { venue, pricing } = config;

  // Any problem below undoes everything this checkout did (the transaction rolls back).
  const fail = (p: CheckoutProblem): never => {
    throw new CheckoutFailed(p);
  };

  return db.transaction(async (q): Promise<StartResult> => {
    await q(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.token]);

    // Close any earlier unfinished checkout by this buyer. Its seats move to the new
    // order, and any promo code seats it reserved go back to the code first.
    const stale = await q(
      `update orders set status = 'cancelled', cancelled_at = now()
        where hold_token = $1 and status = 'pending'
        returning id, stripe_session_id`,
      [input.token],
    );
    for (const o of stale) await releasePromoSeats(q, o.id as string);

    const cart = await loadCart(q, input.token, venue, {
      multiNightPercent: pricing.multiNightDiscountPercent,
      minChargeCents: pricing.minChargeCents,
      promoCode: input.promoCode,
      lockPromo: true,
    });
    if (cart.nights.length === 0) fail({ reason: "empty_cart" });
    if (cart.promo && !cart.promo.valid) fail({ reason: "promo_invalid", problem: cart.promo.problem! });
    const missing = gradeProblems(cart.nights, input.grades);
    if (missing.length) fail({ reason: "missing_grades", nights: missing });
    if (cart.quote.problem) fail({ reason: "below_minimum" });

    const free = cart.quote.totalCents === 0;
    const [order] = await q(
      `insert into orders (buyer_name, buyer_email, total_cents, status, hold_token, promo_code_id, promo_seats)
       values ($1, $2, $3, 'pending', $4, $5, $6)
       returning id, access_key`,
      [
        buyer.name,
        buyer.email,
        cart.quote.totalCents,
        input.token,
        cart.promoInternal?.promoId ?? null,
        cart.promoInternal?.seatsCovered ?? 0,
      ],
    );
    const orderId = order.id as string;

    // The code's seats are taken from its balance now, so two buyers can't both use the last one.
    if (cart.promoInternal && !(await reservePromoSeats(q, cart.promoInternal.promoId, cart.promoInternal.seatsCovered))) {
      fail({ reason: "promo_invalid", problem: "used_up" });
    }

    const items = cart.nights.flatMap((n) => n.seats.map((s) => ({ night: n, seat: s })));
    for (const { night, seat } of items) {
      await q(
        `insert into order_items (order_id, performance_id, seat_id, price_cents, grades_supported)
         values ($1, $2, $3, $4, $5::text[])`,
        [orderId, night.performance.id, seat.seatId, seat.paidCents, input.grades[night.performance.id]],
      );
    }

    // Keep the seats held while the buyer pays, linked to this order.
    const linked = await q(
      `update performance_seats ps
          set order_id = $2,
              hold_expires_at = greatest(ps.hold_expires_at, now() + make_interval(mins => $3)),
              updated_at = now()
         from order_items oi
        where oi.order_id = $2 and ps.performance_id = oi.performance_id and ps.seat_id = oi.seat_id
          and ps.hold_token = $1 and ps.status = 'held' and ps.hold_expires_at > now()
        returning ps.seat_id`,
      [input.token, orderId, pricing.checkoutMinutes],
    );
    if (linked.length !== items.length) fail({ reason: "seats_changed" });

    if (free) {
      const claimed = await claimSeats(q, orderId);
      if (!claimed) fail({ reason: "seats_changed" });
      await q(`update orders set status = 'free', paid_at = now() where id = $1`, [orderId]);
    }

    return {
      ok: true,
      started: {
        orderId,
        accessKey: order.access_key as string,
        totalCents: cart.quote.totalCents,
        free,
        lines: items.map(({ night, seat }) => ({
          name: `${nightTitle(night.performance)}: ${seat.label}`,
          amountCents: seat.paidCents,
        })),
        staleSessions: stale.map((r) => r.stripe_session_id as string | null).filter((s): s is string => !!s),
      },
    };
  }).catch((e): StartResult => {
    if (e instanceof CheckoutFailed) return { ok: false, ...e.problem };
    throw e;
  });
}

class CheckoutFailed extends Error {
  constructor(public problem: CheckoutProblem) {
    super(problem.reason);
  }
}

/**
 * Marks every seat in the order sold, or none of them. A seat can be claimed if
 * it's still held for this order, or open (its hold ran out and nobody else took it).
 */
async function claimSeats(q: Query, orderId: string): Promise<boolean> {
  const items = await q(`select performance_id, seat_id from order_items where order_id = $1`, [orderId]);
  const claimed = await q(
    `update performance_seats ps
        set status = 'sold', order_id = $1, hold_token = null, hold_expires_at = null, updated_at = now()
       from order_items oi
      where oi.order_id = $1 and ps.performance_id = oi.performance_id and ps.seat_id = oi.seat_id
        and (ps.status = 'available'
             or (ps.status = 'held' and (ps.order_id = $1 or ps.hold_expires_at <= now())))
      returning ps.seat_id`,
    [orderId],
  );
  return claimed.length === items.length;
}

export async function attachSession(db: Db, orderId: string, sessionId: string) {
  await db.query(`update orders set stripe_session_id = $2 where id = $1`, [orderId, sessionId]);
}

/** Undo a checkout that never reached the payment page (for example, Stripe was down). */
export async function abandonCheckout(db: Db, orderId: string) {
  await db.transaction(async (q) => {
    await q(`update orders set status = 'cancelled', cancelled_at = now() where id = $1 and status = 'pending'`, [orderId]);
    await q(`update performance_seats set order_id = null where order_id = $1 and status = 'held'`, [orderId]);
    await releasePromoSeats(q, orderId);
  });
}

export type FulfillResult = "paid" | "already_done" | "conflict" | "not_found";

/** Payment confirmed: sell the seats. Safe to call more than once for the same order. */
export async function fulfillOrder(db: Db, orderId: string, paymentIntent: string | null): Promise<FulfillResult> {
  return db.transaction(async (q) => {
    const [order] = await q(`select status from orders where id = $1 for update`, [orderId]);
    if (!order) return "not_found";
    if (order.status === "paid" || order.status === "free" || order.status === "refunded") return "already_done";

    if ((await retakePromoSeats(q, orderId)) && (await claimSeats(q, orderId))) {
      await q(`update orders set status = 'paid', paid_at = now(), stripe_payment_intent = $2 where id = $1`, [orderId, paymentIntent]);
      return "paid";
    }
    // Throwing rolls back any seats this order did manage to claim: all or nothing.
    throw new Conflict();
  }).catch(async (e) => {
    if (!(e instanceof Conflict)) throw e;
    await db.transaction(async (q) => {
      await q(
        `update orders set status = 'refunded', stripe_payment_intent = $2, needs_attention = true,
                attention_reason = 'Paid after a seat was no longer available. Payment refunded automatically.'
          where id = $1`,
        [orderId, paymentIntent],
      );
      await q(`update performance_seats set order_id = null where order_id = $1 and status = 'held'`, [orderId]);
      await releasePromoSeats(q, orderId);
    });
    return "conflict" as const;
  });
}

class Conflict extends Error {}

/** The payment page expired or was abandoned: cancel the order and free its seats. */
export async function cancelOrder(db: Db, orderId: string): Promise<boolean> {
  return db.transaction(async (q) => {
    const done = await q(`update orders set status = 'cancelled', cancelled_at = now() where id = $1 and status = 'pending' returning id`, [orderId]);
    await q(
      `update performance_seats set status = 'available', hold_token = null, hold_expires_at = null, order_id = null, updated_at = now()
        where order_id = $1 and status = 'held'`,
      [orderId],
    );
    if (done.length) await releasePromoSeats(q, orderId);
    return done.length > 0;
  });
}

export type OrderView = {
  id: string;
  accessKey: string;
  status: "pending" | "paid" | "free" | "refunded" | "cancelled";
  buyerName: string;
  buyerEmail: string;
  totalCents: number;
  needsAttention: boolean;
  confirmationSentAt: string | null;
  nights: {
    performanceId: string;
    title: string;
    grades: string[];
    seats: { seatId: string; label: string; paidCents: number }[];
  }[];
};

/** The order, if the access key matches. */
export async function getOrder(db: Db, id: string, accessKey: string, venue: Venue): Promise<OrderView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [o] = await db.query(`select * from orders where id = $1 and access_key = $2`, [id, accessKey]);
  if (!o) return null;
  const items = await db.query(
    `select oi.performance_id, oi.seat_id, oi.price_cents, oi.grades_supported,
            s.section, s.zone, s.row, s.number, p.label, p.starts_at
       from order_items oi
       join seats s on s.id = oi.seat_id
       join performances p on p.id = oi.performance_id
      where oi.order_id = $1
      order by p.sort, p.id, s.section, s.row, s.number`,
    [id],
  );
  const nights: OrderView["nights"] = [];
  for (const r of items) {
    let n = nights.at(-1);
    if (!n || n.performanceId !== r.performance_id) {
      n = {
        performanceId: r.performance_id as string,
        title: nightTitle({ label: r.label as string, startsAt: r.starts_at ? new Date(r.starts_at as string).toISOString() : null }),
        grades: r.grades_supported as string[],
        seats: [],
      };
      nights.push(n);
    }
    n.seats.push({
      seatId: r.seat_id as string,
      label: seatLabel({ section: r.section as string, zone: r.zone as string, row: r.row as string, number: r.number as number }, venue),
      paidCents: r.price_cents as number,
    });
  }
  return {
    id,
    accessKey,
    status: o.status as OrderView["status"],
    buyerName: o.buyer_name as string,
    buyerEmail: o.buyer_email as string,
    totalCents: o.total_cents as number,
    needsAttention: o.needs_attention as boolean,
    confirmationSentAt: o.confirmation_sent_at ? new Date(o.confirmation_sent_at as string).toISOString() : null,
    nights,
  };
}

/** Claims the right to send this order's email, once. Returns false if it was already sent. */
export async function claimConfirmationEmail(db: Db, orderId: string): Promise<boolean> {
  const rows = await db.query(
    `update orders set confirmation_sent_at = now() where id = $1 and confirmation_sent_at is null returning id`,
    [orderId],
  );
  return rows.length > 0;
}

export async function releaseConfirmationClaim(db: Db, orderId: string) {
  await db.query(`update orders set confirmation_sent_at = null where id = $1`, [orderId]);
}
