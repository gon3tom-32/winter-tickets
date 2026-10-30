import { NextResponse } from "next/server";
import { currentCart } from "@/lib/cart-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const cart = await currentCart();
  if (!cart) return NextResponse.json({ ok: false, reason: "no_database" }, { status: 503 });
  return NextResponse.json(cart, { headers: { "Cache-Control": "no-store" } });
}
