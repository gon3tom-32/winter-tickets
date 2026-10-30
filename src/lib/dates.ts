/** "Thursday, December 10 · 6:30 PM" in Pacific time, or the placeholder label if there's no date yet. */
export function nightTitle(p: { label: string; startsAt: string | null }): string {
  if (!p.startsAt) return p.label;
  const d = new Date(p.startsAt);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  return `${day} · ${time}`;
}
