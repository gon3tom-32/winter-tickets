import { NextResponse } from "next/server";
import { getDb, getSource } from "@/lib/server-source";
import { myHolds, splitHolds } from "@/lib/holds";
import { readHoldToken } from "@/lib/hold-cookie";

export const dynamic = "force-dynamic";

// Current seat statuses for one night, plus the seats this buyer holds.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const token = await readHoldToken();
  const [statuses, mine] = await Promise.all([
    getSource().seatStatuses(id, token),
    db && token ? myHolds(db, token) : { seats: [], expiresAt: null },
  ]);
  return NextResponse.json(
    { statuses, ...splitHolds(mine, id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
