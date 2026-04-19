import crypto from "crypto";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET not set");
  return s;
}

// tokens are `<id>.<16-char-hmac>` so we don't need a lookup table
export function signToken(kind: "u" | "o" | "c", id: string) {
  const sig = crypto
    .createHmac("sha256", secret())
    .update(`${kind}:${id}`)
    .digest("base64url")
    .slice(0, 16);
  return `${id}.${sig}`;
}

export function verifyToken(kind: "u" | "o" | "c", token: string): string | null {
  if (!token || typeof token !== "string") return null;
  const idx = token.lastIndexOf(".");
  if (idx < 1 || idx >= token.length - 1) return null;
  const id = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", secret())
    .update(`${kind}:${id}`)
    .digest("base64url")
    .slice(0, 16);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    return crypto.timingSafeEqual(a, b) ? id : null;
  } catch {
    return null;
  }
}

export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
