import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type Session = { loggedIn?: boolean };

const THIRTY_DAYS = 60 * 60 * 24 * 30;

function options(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 chars");
  }
  return {
    password,
    cookieName: "mail_session",
    ttl: THIRTY_DAYS,
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: THIRTY_DAYS,
    },
  };
}

export async function getSession() {
  const store = await cookies();
  return getIronSession<Session>(store, options());
}

export async function requireAuth() {
  const s = await getSession();
  if (!s.loggedIn) throw new Response("unauthorized", { status: 401 });
  return s;
}

export function checkPassword(input: string) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  if (input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
