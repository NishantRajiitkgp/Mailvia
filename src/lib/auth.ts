import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export type Session = { loggedIn?: boolean };

const PASSWORD_KEY = "app_password_hash";

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

// Constant-time compare against the env-var password (the fallback / bootstrap).
export function checkPassword(input: string) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  if (input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// scrypt hashing for the in-app changeable password (stored in app_settings).
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyHashed(plain: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(plain, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// The login check: prefer the DB-stored (changeable) password; if none has been
// set yet, fall back to the APP_PASSWORD env var so existing installs keep working.
export async function verifyAppPassword(input: string): Promise<boolean> {
  if (!input) return false;
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", PASSWORD_KEY)
      .maybeSingle();
    if (data?.value) return verifyHashed(input, data.value);
  } catch {
    // DB unavailable — fall through to env check
  }
  return checkPassword(input);
}

export async function setAppPassword(plain: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("app_settings")
    .upsert({ key: PASSWORD_KEY, value: hashPassword(plain) }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// True once a custom password has been saved to the DB (vs still using the env default).
export async function hasCustomPassword(): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", PASSWORD_KEY)
      .maybeSingle();
    return !!data?.value;
  } catch {
    return false;
  }
}
