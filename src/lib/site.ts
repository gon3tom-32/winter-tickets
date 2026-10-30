// The site's public address. One setting (SITE_URL) drives Stripe's return
// links and the links in emails, so moving to a school address is one edit.
export function siteUrl(path = ""): string {
  const base = (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const prefix = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return `${base}${prefix}/${path.replace(/^\/+/, "")}`;
}
