// The hold token identifies one buyer's browser, so only they can buy the seats they hold.
import { cookies } from "next/headers";
import { isToken } from "./holds";

const NAME = "hold_token";

export async function readHoldToken(): Promise<string | null> {
  const value = (await cookies()).get(NAME)?.value;
  return isToken(value) ? value : null;
}

/** Returns the existing token, or creates one and sets the cookie. Only call from a route handler. */
export async function ensureHoldToken(): Promise<string> {
  const existing = await readHoldToken();
  if (existing) return existing;
  const token = crypto.randomUUID();
  (await cookies()).set(NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return token;
}
