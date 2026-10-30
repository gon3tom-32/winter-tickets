// The site's public address. One setting (SITE_URL, or Netlify's own URL) drives Stripe's return
// links and the links in emails, so moving to a school address is one edit.
export function siteUrl(path = ""): string {
  // SITE_URL wins. On Netlify, URL is set automatically to the site's main address.
  const base = (process.env.SITE_URL || process.env.URL || "http://localhost:3000").replace(/\/+$/, "");
  const prefix = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return `${base}${prefix}/${path.replace(/^\/+/, "")}`;
}
