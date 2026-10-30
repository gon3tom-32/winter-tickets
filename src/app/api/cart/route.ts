import { NextResponse } from "next/server";
import { currentCart } from "@/lib/cart-server";
import { normalizeCode } from "@/lib/promo";

export const dynamic = "force-dynamic";

// GET /api/cart?code=PROMO prices the cart with that promo code.
export async function GET(req: Request) {
  const cart = await currentCart(normalizeCode(new URL(req.url).searchParams.get("code")));
  if (!cart) return NextResponse.json({ ok: false, reason: "no_database" }, { status: 503 });
  return NextResponse.json(cart, { headers: { "Cache-Control": "no-store" } });
}
