import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb, getSource } from "@/lib/server-source";
import { requireStaff } from "@/lib/staff/session";
import { issueComp } from "@/lib/staff/comps";
import { buildMap } from "@/lib/layout";
import { venue } from "@/lib/config";
import { nightTitle } from "@/lib/dates";
import CompPicker from "@/components/CompPicker";

const PROBLEMS: Record<string, string> = {
  missing_recipient: "Enter who the tickets are for.",
  missing_reason: "Enter a reason for the comp.",
  missing_grades: "Choose at least one grade.",
  no_seats: "Choose at least one seat on the map.",
  seats_unavailable: "Some of those seats were just taken. Pick again.",
  unknown_night: "That night doesn't exist.",
};

async function comp(form: FormData) {
  "use server";
  const staff = await requireStaff();
  const night = String(form.get("night"));
  const result = await issueComp(getDb()!, staff, {
    performanceId: night,
    seatIds: String(form.get("seats") ?? "").split(",").filter(Boolean),
    recipient: String(form.get("recipient") ?? ""),
    grades: form.getAll("grades").map(String),
    reason: String(form.get("reason") ?? ""),
  });
  if (result.ok) redirect(`/staff/night/${night}?msg=comp_done`);
  redirect(`/staff/night/${night}/comp?error=${result.reason}`);
}

export default async function CompPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireStaff();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const source = getSource();
  const night = await source.performance(id);
  if (!night) notFound();
  const [{ seats, tiers }, statuses] = await Promise.all([source.venue(), source.seatStatuses(id, null)]);

  return (
    <div className="wrap page">
      <Link href={`/staff/night/${id}`} className="back">← Seat ledger</Link>
      <p className="eyebrow">{nightTitle(night)}</p>
      <h1>Comp seats</h1>
      <p className="lede">Pick the seats on the map, then say who they&apos;re for and why. Comped seats come off sale right away.</p>
      {error && PROBLEMS[error] && <p className="notice" role="alert">{PROBLEMS[error]}</p>}
      <CompPicker
        action={comp}
        night={{ id: night.id, grades: night.grades }}
        seats={buildMap(seats, venue, tiers)}
        sections={venue.sections}
        tiers={tiers}
        statuses={statuses}
      />
    </div>
  );
}
