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

function transporter(creds: SenderCreds) {
  const hit = cache.get(creds.email);
  if (hit) return hit;
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword.replace(/\s+/g, "") },
  });
  cache.set(creds.email, t);
  return t;
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
}

export async function verifyCredentials(creds: SenderCreds): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await transporter(creds).verify();
    return { ok: true };
  } catch (e) {
    cache.delete(creds.email);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
