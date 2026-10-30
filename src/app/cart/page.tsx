import Link from "next/link";
import CartView from "@/components/CartView";
import { currentCart } from "@/lib/cart-server";
import { pricing } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function CartPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const [cart, { payment }] = await Promise.all([currentCart(), searchParams]);
  return (
    <div className="wrap page">
      <Link href="/" className="back">← All nights</Link>
      <h1>Your cart</h1>
      {cart ? (
        <CartView initial={cart} multiNightPercent={pricing.multiNightDiscountPercent} paymentCancelled={payment === "cancelled"} />
      ) : (
        <p className="notice">The cart needs the ticket database, which isn&apos;t connected in this preview.</p>
      )}
    </div>
  );
}
