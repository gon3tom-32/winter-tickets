import Link from "next/link";
import { getSource } from "@/lib/server-source";
import { nightTitle } from "@/lib/dates";
import { currentCart } from "@/lib/cart-server";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [nights, cart] = await Promise.all([getSource().performances(), currentCart()]);
  const inCart = cart?.nights.reduce((n, x) => n + x.seats.length, 0) ?? 0;
  return (
    <div className="wrap page">
      <h1>Winter Performance</h1>
      <p className="lede">
        Each night features different grades. Choose a night to pick reserved seats. Buying seats for 2 or more nights in
        one order takes 20% off.
      </p>
      {cart && inCart > 0 && (
        <p className="tip cart-reminder">
          <span>
            You have {inCart} {inCart === 1 ? "seat" : "seats"} held · {formatCents(cart.quote.totalCents)}
          </span>
          <Link href="/cart" className="button">Review cart</Link>
        </p>
      )}
      <ul className="nights">
        {nights.map((n) => (
          <li key={n.id} className="night">
            <h2>{nightTitle(n)}</h2>
            <span>Grades performing: {n.grades.join(", ")}</span>
            {n.onSale ? (
              <Link className="button" href={`/night/${n.id}`}>
                Choose seats
              </Link>
            ) : (
              <span className="status">Not on sale yet</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
