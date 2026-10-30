import { NextResponse } from "next/server";
import { getDb } from "@/lib/server-source";
import { holdSeat, releaseSeats } from "@/lib/holds";
import { ensureHoldToken, readHoldToken } from "@/lib/hold-cookie";
import { pricing } from "@/lib/config";

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

// Hold one seat: { performanceId, seatId }
export async function POST(req: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, reason: "no_database" }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (!isId(body?.performanceId) || !isId(body?.seatId)) {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  const token = await ensureHoldToken();
  const result = await holdSeat(db, {
    performanceId: body.performanceId,
    seatId: body.seatId,
    token,
    holdMinutes: pricing.holdMinutes,
    maxSeats: pricing.maxSeatsPerOrder,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}

// Release seats: { performanceId, seatIds? } (no seatIds releases all of this buyer's seats for that night)
export async function DELETE(req: Request) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, reason: "no_database" }, { status: 503 });
  const body = await req.json().catch(() => null);
  const seatIds = body?.seatIds;
  if (!isId(body?.performanceId) || (seatIds !== undefined && !(Array.isArray(seatIds) && seatIds.every(isId)))) {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  const token = await readHoldToken();
  const released = token ? await releaseSeats(db, { performanceId: body.performanceId, token, seatIds }) : 0;
  return NextResponse.json({ ok: true, released });
}
