import nodemailer from "nodemailer";

type SenderCreds = {
  email: string;
  appPassword: string;
  fromName?: string | null;
};

function fallbackEnv(): SenderCreds {
  const email = process.env.GMAIL_ADDRESS;
  const appPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!email || !appPassword) throw new Error("No sender configured and GMAIL_ADDRESS/GMAIL_APP_PASSWORD not set");
  return { email, appPassword, fromName: process.env.GMAIL_FROM_NAME };
}

const cache = new Map<string, nodemailer.Transporter>();

function makeTransporter(creds: SenderCreds) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword.replace(/\s+/g, "") },
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    socketTimeout: 20_000,
    greetingTimeout: 10_000,
  });
}

function transporter(creds: SenderCreds) {
  const hit = cache.get(creds.email);
  if (hit) return hit;
  const t = makeTransporter(creds);
  cache.set(creds.email, t);
  return t;
}

function invalidate(email: string) {
  const hit = cache.get(email);
  if (hit) {
    try { hit.close(); } catch {}
    cache.delete(email);
  }
}

export async function sendMail(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  sender?: SenderCreds | null;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  headers?: Record<string, string>;
}) {
  const creds = args.sender ?? fallbackEnv();
  const from = creds.fromName ? `"${creds.fromName}" <${creds.email}>` : creds.email;
  try {
    const info = await transporter(creds).sendMail({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
      replyTo: creds.email,
      attachments: args.attachments,
      headers: args.headers,
    });
    return info.messageId;
  } catch (e) {
    // SMTP session might be stale/broken — drop the cached transporter so the
    // next send rebuilds a fresh connection instead of retrying a dead socket.
    invalidate(creds.email);
    throw e;
  }
}

export async function verifyCredentials(creds: SenderCreds): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await transporter(creds).verify();
    return { ok: true };
  } catch (e) {
    invalidate(creds.email);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
